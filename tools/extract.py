"""Extract Productive Trees data from a modpack into data/ptdata.json and icons/.

Usage: python tools/extract.py "C:/Gameserver/TNP Limitless 8" [path/to/minecraft-client-1.21.1.jar] [--src path/to/productivetrees-source]

Reads every jar once: the tree definitions (data/productivetrees/trees.json), all
Productive Trees recipes (pollination, sawmill, crafting, cooking, compat types),
loot modifiers, item tags, en_us lang files, item models and textures. Pack changes
come from config/paxi/datapacks (datapack overrides), kubejs/server_scripts (removed
recipes, replaced inputs, tags) and the Productive Trees configs.
Food values are not data files, so they are read from the mod's source code (--src,
a checkout of github.com/JDKDigital/productivetrees at the commit matching the jar).
Without --src the values of the previous run are kept.
Recipes of other mods that use Productive Trees items (directly or through a tag)
are collected as "uses".
"""
import io
import json
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT_DATA = ROOT / "data"
OUT_ICONS = ROOT / "icons"
MOD = "productivetrees"
COOKING = {"minecraft:smelting", "minecraft:smoking", "minecraft:campfire_cooking", "minecraft:blasting"}
CRAFTING = {"minecraft:crafting_shaped", "minecraft:crafting_shapeless"}
# tags so broad that "used in" lists would be meaningless (every log, plank, leaf ...)
GENERIC_TAG = re.compile(r"^(minecraft|c|neoforge):(logs|logs_that_burn|planks|leaves|saplings|wooden_|stripped_|fences|fence_gates|"
                         r"doors|trapdoors|slabs|stairs|buttons|pressure_plates|signs|hanging_signs|bookshelves|barrels|"
                         r"storage_blocks|foods$|crops$|fruits$|nuts$|berries$|seeds$|player_workstations|chests|"
                         r"enchantment_power|mineable|campfires|flowers|small_flowers|wooden|non_flammable|"
                         r"completes_find_tree_tutorial|villager_plantable|compostable|animal_foods|edible_when_placed)")
VANILLA_TREES = {
    "minecraft:oak_leaves": ("oak", "minecraft:oak_sapling"),
    "minecraft:spruce_leaves": ("spruce", "minecraft:spruce_sapling"),
    "minecraft:birch_leaves": ("birch", "minecraft:birch_sapling"),
    "minecraft:jungle_leaves": ("jungle", "minecraft:jungle_sapling"),
    "minecraft:acacia_leaves": ("acacia", "minecraft:acacia_sapling"),
    "minecraft:dark_oak_leaves": ("dark_oak", "minecraft:dark_oak_sapling"),
    "minecraft:mangrove_leaves": ("mangrove", "minecraft:mangrove_propagule"),
    "minecraft:cherry_leaves": ("cherry", "minecraft:cherry_sapling"),
    "minecraft:azalea_leaves": ("azalea", "minecraft:azalea"),
    "minecraft:flowering_azalea_leaves": ("flowering_azalea", "minecraft:flowering_azalea"),
}
DEFAULT_FOLIAGE = "#48b518"
WOOD_BLOCK_FOLDERS = {"stairs", "slab", "fence", "fence_gate", "door", "trapdoor", "button", "pressure_plate", "sign",
                      "hanging_sign", "bookshelves", "wood"}


def strip_json(text):
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    text = re.sub(r",(\s*[}\]])", r"\1", text)
    return json.loads(text)


def parse_json(raw):
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        try:
            return strip_json(raw)
        except json.JSONDecodeError:
            return None


def read_json(zf, name):
    return parse_json(zf.read(name).decode("utf-8-sig", errors="replace"))


class Pack:
    def __init__(self, mods_dir, extra_data_dirs, base_jars=()):
        self.lang = {}
        self.tags = {}  # item tags
        self.block_tags = {}
        self.textures = {}
        self.models = {}
        self.recipes = {}  # id -> (source, json)   recipes of the mod, or mentioning it
        self.all_recipes = {}  # id -> (source, raw) every recipe, filtered later for tag uses
        self.data = {}  # "ns:folder/path" -> (source, json) for productivetrees data files
        self.overrides = {}  # recipe ids replaced by a datapack -> datapack name
        self.mod_versions = {}
        self.mod_names = {}
        self.mods = set()
        self.trees_json = None
        self.global_modifiers = []
        self._zips = {}
        jars = list(base_jars) + sorted(Path(mods_dir).glob("*.jar"))
        for jar in jars:
            try:
                zf = zipfile.ZipFile(jar)
            except zipfile.BadZipFile:
                continue
            names = zf.namelist()
            # libraries shipped inside a jar (e.g. ProductiveLib inside Productive Bees)
            for inner in names:
                if inner.startswith("META-INF/jarjar/") and inner.endswith(".jar") and zf.getinfo(inner).file_size < 20_000_000:
                    try:
                        izf = zipfile.ZipFile(io.BytesIO(zf.read(inner)))
                    except zipfile.BadZipFile:
                        continue
                    key = f"{jar}!{inner}"
                    self._zips[key] = izf
                    inames = izf.namelist()
                    self._scan(key, izf, inames, self._mod_id(izf, inames))
            modid = self._mod_id(zf, names)
            self._scan(jar, zf, names, modid)
            if f"data/{MOD}/trees.json" in names:
                self.trees_json = read_json(zf, f"data/{MOD}/trees.json")
            self._zips[jar] = zf
        # datapacks load after mod data, so they override it
        for d in extra_data_dirs:
            self._scan_dir(Path(d))

    def zip(self, jar):
        return self._zips[jar]

    def _mod_id(self, zf, names):
        if "META-INF/neoforge.mods.toml" in names:
            toml = zf.read("META-INF/neoforge.mods.toml").decode("utf-8", "replace")
            ids = re.findall(r'modId\s*=\s*"([^"]+)"', toml)
            v = re.search(r'^\s*version\s*=\s*"([^"]+)"', toml, re.M)
            if ids:
                ver = v.group(1) if v else "?"
                if ver.startswith("${"):
                    mf = zf.read("META-INF/MANIFEST.MF").decode("utf-8", "replace") if "META-INF/MANIFEST.MF" in names else ""
                    mv = re.search(r"Implementation-Version:\s*(\S+)", mf)
                    ver = mv.group(1) if mv else "?"
                own = re.search(r'\[\[mods\]\][^\[]*?modId\s*=\s*"([^"]+)"', toml, re.S)
                mid = own.group(1) if own else ids[0]
                dn = re.search(r'displayName\s*=\s*"([^"]+)"', toml)
                self.mod_versions[mid] = ver
                self.mod_names[mid] = dn.group(1) if dn else mid
                self.mods.add(mid)
                # jars with several mods (e.g. Mekanism modules) list them all
                for extra in re.findall(r'\[\[mods\]\][^\[]*?modId\s*=\s*"([^"]+)"', toml, re.S):
                    self.mods.add(extra)
                return mid
        if "version.json" in names and "pack.mcmeta" not in names:
            self.mod_versions["minecraft"] = (read_json(zf, "version.json") or {}).get("id")
            self.mods.add("minecraft")
            return "minecraft"
        return None

    def _data_entry(self, source, rel, raw_reader, datapack=False):
        """rel = path below data/, e.g. 'productivetrees/recipe/sawmill.json'."""
        parts = rel.split("/")
        if len(parts) < 3 or not rel.endswith(".json"):
            return
        ns, folder = parts[0], parts[1]
        if folder == "tags" and len(parts) > 3:
            kind = parts[2]
            store = {"item": self.tags, "block": self.block_tags}.get(kind)
            if store is not None:
                d = parse_json(raw_reader())
                if isinstance(d, dict):
                    self._add_tag(store, f"{ns}:{'/'.join(parts[3:])[:-5]}", d)
        elif folder == "recipe":
            raw = raw_reader()
            rid = f"{ns}:{'/'.join(parts[2:])[:-5]}"
            if datapack and rid in self.recipes:
                self.overrides[rid] = source
            self.all_recipes[rid] = (source, raw)
            if ns != MOD and f"{MOD}:" not in raw:
                return
            d = parse_json(raw)
            if isinstance(d, dict):
                self.recipes[rid] = (source, d)
        elif ns == "neoforge" and folder == "loot_modifiers":
            # NeoForge merges the global list of every jar and datapack
            d = parse_json(raw_reader())
            if isinstance(d, dict):
                if d.get("replace"):
                    self.global_modifiers.clear()
                self.global_modifiers += [e for e in d.get("entries", []) if e not in self.global_modifiers]
        elif ns == MOD:
            d = parse_json(raw_reader())
            if isinstance(d, (dict, list)):
                self.data[f"{ns}:{'/'.join(parts[1:])[:-5]}"] = (source, d)

    def _scan(self, jar, zf, names, modid):
        for n in names:
            if n.endswith("/lang/en_us.json") and n.startswith("assets/"):
                d = read_json(zf, n)
                if isinstance(d, dict):
                    self.lang.update({k: v for k, v in d.items() if isinstance(v, str)})
            elif n.startswith("data/"):
                self._data_entry(modid or jar.name, n[5:], lambda n=n: zf.read(n).decode("utf-8-sig", errors="replace"))
            elif n.startswith("assets/") and n.endswith(".png") and "/textures/" in n:
                parts = n.split("/")
                self.textures[f"{parts[1]}:{'/'.join(parts[3:])[:-4]}"] = (jar, n)
            elif n.startswith("assets/") and "/models/" in n and n.endswith(".json"):
                parts = n.split("/")
                self.models[f"{parts[1]}:{'/'.join(parts[3:])[:-5]}"] = (jar, n)

    def _scan_dir(self, base):
        for p in sorted(base.glob("**/data/**/*.json")):
            parts = p.relative_to(base).parts
            rel = "/".join(parts[parts.index("data") + 1:])
            self._data_entry("datapack:" + parts[0], rel, lambda p=p: p.read_text("utf-8-sig"), datapack=True)

    @staticmethod
    def _add_tag(store, tag, d):
        s = store.setdefault(tag, [])
        if d.get("replace"):
            s.clear()
        for v in d.get("values", []):
            if isinstance(v, dict):
                v = v.get("id")
            if isinstance(v, str) and v not in s:
                s.append(v)

    def resolve_tag(self, tag, store=None, seen=None):
        store = self.tags if store is None else store
        seen = seen or set()
        if tag in seen:
            return []
        seen.add(tag)
        out = []
        for v in store.get(tag, []):
            if v.startswith("#"):
                out += [x for x in self.resolve_tag(v[1:], store, seen) if x not in out]
            elif v not in out:
                out.append(v)
        return out

    def item_exists(self, item):
        ns, path = item.split(":", 1)
        return (f"item.{ns}.{path}" in self.lang or f"block.{ns}.{path}" in self.lang
                or f"{ns}:item/{path}" in self.models)

    def item_name(self, item):
        ns, path = item.split(":", 1)
        for k in (f"item.{ns}.{path}", f"block.{ns}.{path}"):
            if k in self.lang:
                return re.sub(r"\s*%s\s*", " ", self.lang[k]).strip()
        return path.replace("_", " ").replace("/", " ").title()

    def _model(self, mid, depth=0):
        if depth > 8 or mid not in self.models:
            return {}, []
        jar, entry = self.models[mid]
        d = read_json(self.zip(jar), entry) or {}
        tex, parents = {}, []
        parent = d.get("parent")
        if isinstance(parent, str):
            pid = parent if ":" in parent else f"minecraft:{parent}"
            parents.append(pid)
            ptex, pp = self._model(pid, depth + 1)
            tex.update(ptex)
            parents += pp
        tex.update({k: v for k, v in (d.get("textures") or {}).items() if isinstance(v, str)})
        return tex, parents

    def item_texture(self, item):
        """A texture id, or a list of layer texture ids (index = tint index)."""
        ns, path = item.split(":", 1)
        tex, _ = self._model(f"{ns}:item/{path}")
        if not tex:
            tex, _ = self._model(f"{ns}:block/{path}")

        def res(v, n=0):
            while v.startswith("#") and n < 10:
                v = tex.get(v[1:], "")
                n += 1
            return v if ":" in v else (f"minecraft:{v}" if v else "")

        layers = [res(tex[f"layer{i}"]) for i in range(4) if f"layer{i}" in tex]
        if len(layers) > 1 and all(t in self.textures for t in layers):
            return layers
        for key in ("layer0", "all", "side", "front", "texture", "top", "end", "cross", "crop", "particle"):
            if key in tex:
                t = res(tex[key])
                if t in self.textures:
                    return t
        for guess in (f"{ns}:item/{path}", f"{ns}:block/{path}"):
            if guess in self.textures:
                return guess
        return None


def hex_rgb(h):
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def tint(img, color):
    r, g, b = hex_rgb(color)
    px = img.load()
    for y in range(img.size[1]):
        for x in range(img.size[0]):
            pr, pg, pb, pa = px[x, y]
            px[x, y] = (pr * r // 255, pg * g // 255, pb * b // 255, pa)
    return img


def save_icon(pack, tex_id, out_name, tints=None):
    """tints: one color (or None) per layer, like the game's color handlers."""
    dest = OUT_ICONS / (out_name + ".png")
    if dest.exists():
        return
    img = None
    for i, tid in enumerate(tex_id if isinstance(tex_id, list) else [tex_id]):
        jar, entry = pack.textures[tid]
        layer = Image.open(io.BytesIO(pack.zip(jar).read(entry))).convert("RGBA")
        w, h = layer.size
        if h > w:  # animated strip: first frame
            layer = layer.crop((0, 0, w, w))
        if tints and i < len(tints) and tints[i]:
            layer = tint(layer, tints[i])
        if img is None:
            img = layer
        else:
            if layer.size != img.size:
                layer = layer.resize(img.size, Image.NEAREST)
            img = Image.alpha_composite(img, layer)
    dest.parent.mkdir(parents=True, exist_ok=True)
    img.save(dest, optimize=True)


# ---------- values that only exist in the mod's code ----------
VANILLA_FOODS = {"HONEY_BOTTLE": {"nutrition": 6, "saturationMod": 0.1}, "GOLDEN_CARROT": {"nutrition": 6, "saturationMod": 1.2}}


def read_source(src):
    base = Path(src) / "src/main/java/cy/jdkdigital/productivetrees"
    uncomment = lambda s: re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", s, flags=re.S))
    text = uncomment((base / "registry/TreeRegistrator.java").read_text("utf-8"))
    consts = {}
    for m in re.finditer(r"FoodProperties\s+(\w+)\s*=(.*?)\.build\(\)\s*;", text, re.S):
        body = m.group(2)
        nut = re.search(r"nutrition\((\d+)\)", body)
        sat = re.search(r"saturationModifier\(([\d.]+)F?\)", body)
        consts[m.group(1)] = {"nutrition": int(nut.group(1)) if nut else 0, "saturationMod": float(sat.group(1)) if sat else 0.0,
                              "fast": ".fast()" in body, "alwaysEdible": ".alwaysEdible()" in body}
    foods, groups = {}, {}
    for m in re.finditer(r"List<CropConfig>\s+(\w+)\s*=.*?\}\};", text, re.S):
        for c in re.finditer(r'new CropConfig\("(\w+)",\s*(\w+)\)', m.group(0)):
            groups[f"{MOD}:{c.group(1)}"] = m.group(1).lower()
            if c.group(2) in consts:
                foods[f"{MOD}:{c.group(1)}"] = consts[c.group(2)]
    for m in re.finditer(r'registerItem\("(\w+)",\s*Foods\.(\w+)\)', text):
        if m.group(2) in VANILLA_FOODS:
            foods[f"{MOD}:{m.group(1)}"] = VANILLA_FOODS[m.group(2)]
    for m in re.finditer(r'registerItem\("(\w+)",.*?\.food\(Foods\.(\w+)\)', text):
        if m.group(2) in VANILLA_FOODS:
            foods[f"{MOD}:{m.group(1)}"] = VANILLA_FOODS[m.group(2)]
    # leaves that are kept alive through connected leaves instead of the vanilla distance
    lt = uncomment((base / "common/block/ProductiveLeavesBlock.java").read_text("utf-8"))
    connected = re.search(r"CONNECTED_LEAF_TREES\s*=\s*Set\.of\((.*?)\);", lt, re.S)
    return {"foods": foods, "groups": groups,
            "connectedLeaves": re.findall(r'"(\w+)"', connected.group(1)) if connected else []}


def read_config(path):
    out, section = {}, ""
    if not path.exists():
        return out
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1]
        elif "=" in line and not line.startswith("#"):
            k, v = [x.strip() for x in line.split("=", 1)]
            try:
                out[f"{section}.{k}"] = float(v) if "." in v else int(v)
            except ValueError:
                out[f"{section}.{k}"] = {"true": True, "false": False}.get(v, v.strip('"'))
    return out


# ---------- generic recipe reading for "uses" ----------
OUT_KEYS = {"result", "results", "output", "outputs", "main_output", "secondary_output", "secondary", "tertiary",
            "byproduct", "byproducts", "extra_output", "outputitems", "outputfluids", "result_fluid"}


def _refs(node, out_side, ins, outs):
    """Collect {item|tag} references, split into inputs and outputs by the key they sit under."""
    if isinstance(node, list):
        for x in node:
            _refs(x, out_side, ins, outs)
    elif isinstance(node, dict):
        ref = None
        if isinstance(node.get("item"), str):
            ref = node["item"]
        elif isinstance(node.get("tag"), str):
            ref = "#" + node["tag"]
        elif isinstance(node.get("id"), str) and ":" in node["id"] and ("count" in node or out_side):
            ref = node["id"]
        if ref:
            (outs if out_side else ins).append((ref, node.get("count", node.get("amount", 1))))
        for k, v in node.items():
            if k in ("item", "tag", "id", "neoforge:conditions", "conditions"):
                continue
            _refs(v, out_side or k.lower() in OUT_KEYS, ins, outs)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--src")]
    src = None
    if "--src" in sys.argv:
        i = sys.argv.index("--src")
        src = sys.argv[i + 1]
        args = [a for a in args if a != src]
    if not args:
        sys.exit(__doc__)
    pack_dir = Path(args[0])
    base = [Path(a) for a in args[1:]]
    base += sorted((pack_dir / "libraries/net/neoforged/neoforge").glob("*/neoforge-*-universal.jar"))
    extra = [d for d in (pack_dir / "config/paxi/datapacks", pack_dir / "kubejs/data") if d.exists()]
    print("Scanning jars ...", [b.name for b in base])
    pack = Pack(pack_dir / "mods", extra, base)
    print(f"  lang keys {len(pack.lang)}, tags {len(pack.tags)}, textures {len(pack.textures)}, "
          f"mod recipes {len(pack.recipes)}, all recipes {len(pack.all_recipes)}")
    OUT_DATA.mkdir(exist_ok=True)
    OUT_ICONS.mkdir(exist_ok=True)

    trees_json = pack.trees_json or {}
    tree_by_item = {}  # sapling/leaves/log/... item -> tree id
    for tid in trees_json:
        for suffix in ("_sapling", "_leaves", "_log", "_wood", "_stripped_log", "_stripped_wood", "_planks", "_fruit"):
            tree_by_item[f"{MOD}:{tid}{suffix}"] = tid

    items_out, icon_cache = {}, {}

    def tints_for(item):
        ns, path = item.split(":", 1)
        if ns == MOD and path.endswith("_sapling") and path[:-8] in trees_json:
            t = trees_json[path[:-8]]
            c = t.get("colors", {})
            fruit = t.get("fruit")
            return [c.get("leafColor"), c.get("logColor"), (fruit or {}).get("ripeColor", "#ff9d00") if fruit else c.get("logColor")]
        if item == f"{MOD}:pollen":
            return [DEFAULT_FOLIAGE]
        m = re.match(r"^(advanced_(\w+)_beehive|expansion_box_(\w+))$", path) if ns == MOD else None
        if m:
            tid = m.group(2) or m.group(3)
            if tid in trees_json:
                return [trees_json[tid].get("colors", {}).get("plankColor")] * 4
        if ns == "minecraft" and path.endswith("_leaves") and path not in ("cherry_leaves", "azalea_leaves", "flowering_azalea_leaves"):
            return [{"spruce_leaves": "#619961", "birch_leaves": "#80a755"}.get(path, DEFAULT_FOLIAGE)]
        return None

    def ref_item(item):
        if item not in items_out:
            if item not in icon_cache:
                tex = pack.item_texture(item)
                rel = None
                if tex:
                    rel = "i/" + item.replace(":", "/")
                    save_icon(pack, tex, rel, tints_for(item))
                    if not (OUT_ICONS / (rel + ".png")).exists():
                        rel = None
                icon_cache[item] = rel
            items_out[item] = {"name": pack.item_name(item), "icon": icon_cache[item]}
        return item

    def ref_ing(ing):
        if isinstance(ing, list):
            items, labels = [], []
            for sub in ing:
                r = ref_ing(sub)
                labels.append(r["label"] or "")
                items += [i for i in r["items"] if i not in items]
            return {"label": " / ".join(l for l in labels if l), "items": items}
        if not isinstance(ing, dict):
            return {"label": None, "items": []}
        if "item" in ing:
            return {"label": None, "items": [ref_item(ing["item"])]}
        if "tag" in ing:
            items = [i for i in pack.resolve_tag(ing["tag"]) if pack.item_exists(i)]
            return {"label": "#" + ing["tag"], "items": [ref_item(i) for i in items[:10]], "more": max(0, len(items) - 10)}
        return {"label": None, "items": []}

    def res_of(r):
        if not isinstance(r, dict) or not r:
            return None
        iid = r.get("id") or r.get("item")
        return {"item": ref_item(iid), "count": r.get("count", 1)} if iid else None

    # ---------- KubeJS ----------
    removed, replaced = set(), []
    for js in (pack_dir / "kubejs/server_scripts").glob("**/*.js"):
        text = js.read_text("utf-8", errors="replace")
        for line in text.splitlines():
            if line.strip().startswith("//"):
                continue
            removed.update(re.findall(r"event\.remove\(\{\s*id:\s*['\"]([^'\"]+)['\"]", line))
            for a, b in re.findall(r"replaceInput\([^,]+,\s*['\"]([^'\"]+)['\"],\s*['\"]([^'\"]+)['\"]\)", line):
                if MOD in a or MOD in b:
                    replaced.append({"from": a, "to": b, "file": js.name})
        if re.search(r"event\.remove\(\{\s*type:\s*['\"]farmingforblockheads:market['\"]", text):
            removed.add("*farmingforblockheads:market")

    def conditions_ok(d):
        def ok(c):
            t = c.get("type")
            if t == "neoforge:mod_loaded":
                return c.get("modid") in pack.mods
            if t == "neoforge:not":
                return not ok(c.get("value", {}))
            if t == "neoforge:and":
                return all(ok(x) for x in c.get("values", []))
            if t == "neoforge:or":
                return any(ok(x) for x in c.get("values", []))
            return True
        return all(ok(c) for c in d.get("neoforge:conditions", []))

    # ---------- the mod's recipes ----------
    crafting, cooking, sawmill, sawing, pollination, other = {}, {}, {}, {}, [], {}
    unavailable = {}
    for rid, (source, d) in sorted(pack.recipes.items()):
        t = d.get("type", "")
        if not conditions_ok(d):
            mods_needed = [c.get("modid") for c in d.get("neoforge:conditions", []) if c.get("type") == "neoforge:mod_loaded"]
            unavailable[rid] = {"type": t, "needs": [m for m in mods_needed if m not in pack.mods]}
            continue
        base_rec = {"source": source, "removed": rid in removed}
        if rid in pack.overrides:
            base_rec["datapack"] = pack.overrides[rid]
        res = d.get("result") or {}
        rout = (res.get("id") or res.get("item")) if isinstance(res, dict) else None
        if t in CRAFTING and rout and rid.split(":")[1].split("/")[0] in WOOD_BLOCK_FOLDERS:
            continue  # the same vanilla shapes for every tree, only listed as blocks on the tree pages
        if t in CRAFTING and rout:
            rec = dict(base_rec, type=t, result=ref_item(rout), count=res.get("count", 1))
            if t == "minecraft:crafting_shaped":
                rec["pattern"] = d.get("pattern", [])
                rec["key"] = {k: ref_ing(v) for k, v in d.get("key", {}).items()}
            else:
                rec["ingredients"] = [ref_ing(i) for i in d.get("ingredients", [])]
            crafting[rid] = rec
        elif t in COOKING and rout:
            cooking[rid] = dict(base_rec, type=t, input=ref_ing(d.get("ingredient")), result=ref_item(rout),
                                count=res.get("count", 1), time=d.get("cookingtime"), xp=d.get("experience", 0))
        elif t == f"{MOD}:tree_pollination":
            pollination.append(dict(base_rec, id=rid, a=ref_ing(d.get("leafA"))["items"], b=ref_ing(d.get("leafB"))["items"],
                                    result=ref_item(d["result"]["id"]), chance=d.get("chance", 0.1)))
        elif t == f"{MOD}:sawmill":
            sawmill[rid] = dict(base_rec, input=ref_ing(d.get("input")), output=res_of(d.get("output")),
                                secondary=res_of(d.get("secondary")), tertiary=res_of(d.get("tertiary")))
        elif t == "mekanism:sawing":
            sawing[rid] = dict(base_rec, input=ref_ing(d.get("input")), output=res_of(d.get("main_output")),
                               secondary=res_of(d.get("secondary_output")), chance=d.get("secondary_chance"))
        else:
            other[rid] = dict(base_rec, type=t)

    # ---------- trees ----------
    lang = pack.lang

    def tree_name(tid):
        return lang.get(f"block.{MOD}.{tid}", lang.get(f"block.{MOD}.{tid}_sapling", tid.replace("_", " ").title()).replace(" Sapling", ""))

    loot_saplings = {}
    for key, (source, d) in pack.data.items():
        if key.startswith(f"{MOD}:loot_modifiers/") and isinstance(d, dict):
            add = d.get("addition") or {}
            iid = add.get("id") or add.get("item")
            tables = []
            for c in d.get("conditions", []):
                terms = c.get("terms", [c]) if c.get("condition") == "minecraft:any_of" else [c]
                tables += [x.get("loot_table_id") for x in terms if x.get("loot_table_id")]
            if iid:
                loot_saplings[iid] = {"chance": d.get("chance"), "tables": tables, "archaeology": d.get("type", "").endswith("ingredient_modifier")}
    active_modifiers = pack.global_modifiers

    trees = []
    for tid, t in trees_json.items():
        fruit = t.get("fruit")
        mega = t.get("megaFeature")
        cfg = t.get("megaConfiguration", 2)
        # a tree without "feature" gets one named after it (TreeFinder); mega-only trees point it at productivetrees:null
        sizes = [] if t.get("feature") == f"{MOD}:null" else ["1x1"]
        if mega:
            sizes.append({5: "5x5", 3: "3x3"}.get(cfg, "2x2"))
        if t.get("largeMegaFeature"):
            w = 2 * (cfg - 1) + 1
            sizes.append(f"{w}x{w}")
        sap = ref_item(f"{MOD}:{tid}_sapling")
        rec = {
            "id": tid, "name": tree_name(tid), "latin": lang.get(f"block.{MOD}.{tid}.latin"),
            "sapling": sap, "leaves": ref_item(f"{MOD}:{tid}_leaves"), "log": ref_item(f"{MOD}:{tid}_log"),
            "planks": ref_item(f"{MOD}:{tid}_planks"),
            "colors": t.get("colors", {}), "sizes": sizes,
            "fireproof": t.get("fireproof", False), "light": (t.get("decoration") or {}).get("lightLevel", 0),
            "vine": (t.get("decoration") or {}).get("vine") or None, "fallingLeaves": t.get("fallingLeaves", False),
        }
        if t.get("feature") and t["feature"] != f"{MOD}:{tid}":
            rec["feature"] = t["feature"]
        if fruit:
            rec["fruit"] = {"item": ref_item(fruit["item"]), "count": fruit.get("count", 1),
                            "growthSpeed": fruit.get("growthSpeed", 1.0), "style": fruit.get("style", "default"),
                            "ripeColor": fruit.get("ripeColor", "#ff9d00")}
        if t.get("stripDrop"):
            rec["stripDrop"] = ref_item(t["stripDrop"])
        if t.get("mutation_info"):
            rec["mutation"] = {"target": t["mutation_info"]["target"].split(":")[1], "chance": t["mutation_info"].get("chance", 1.0)}
        gc = t.get("growthConditions")
        if gc:
            rec["growth"] = gc
        if t.get("soil"):
            rec["soil"] = t["soil"]
        ls = loot_saplings.get(sap)
        if ls and any(e.endswith("/" + sap.split(":")[1]) or e.endswith(":" + sap.split(":")[1]) for e in active_modifiers):
            rec["loot"] = ls
        desc = lang.get(f"{MOD}.sapling_description.{tid}")
        if desc:
            rec["lootText"] = desc
        for kind, iid in (("hive", f"{MOD}:advanced_{tid}_beehive"), ("box", f"{MOD}:expansion_box_{tid}")):
            if pack.item_exists(iid):
                rec[kind] = ref_item(iid)
        if pack.item_exists(f"{MOD}:{tid}_stairs"):
            rec["woodBlocks"] = [ref_item(f"{MOD}:{tid}_{s}") for s in ("stairs", "slab", "fence", "fence_gate", "door", "trapdoor",
                                                                        "pressure_plate", "button", "sign", "hanging_sign", "bookshelf")
                                 if pack.item_exists(f"{MOD}:{tid}_{s}")]
        trees.append(rec)
    trees.sort(key=lambda r: r["name"])

    vanilla = {}
    for leaf, (vid, sap) in VANILLA_TREES.items():
        vanilla[leaf] = {"id": "minecraft:" + vid, "name": pack.item_name(sap).replace(" Sapling", "").replace(" Propagule", ""),
                         "sapling": ref_item(sap), "leaves": ref_item(leaf)}

    # ---------- tags that hold our items, and recipes of any mod that use them ----------
    our_items = {i for i in items_out if i.startswith(MOD + ":")}
    for k in list(lang):
        m = re.match(rf"^(item|block)\.{MOD}\.([a-z0-9_]+)$", k)
        if m and f"{MOD}:item/{m.group(2)}" in pack.models:
            our_items.add(f"{MOD}:{m.group(2)}")
    produce = set()
    for t in trees:
        if t.get("fruit"):
            produce.add(t["fruit"]["item"])
        if t.get("stripDrop"):
            produce.add(t["stripDrop"])
    tag_members = {}
    for tag in pack.tags:
        if GENERIC_TAG.match(tag):
            continue
        members = pack.resolve_tag(tag)
        mine = [m for m in members if m.startswith(MOD + ":")]
        if mine and len(members) <= 60:
            tag_members[tag] = mine
    item_tags = {}
    for tag, mine in tag_members.items():
        for m in mine:
            item_tags.setdefault(m, []).append(tag)

    tag_re = re.compile('"#?(?:' + "|".join(re.escape(t) for t in sorted(tag_members, key=len, reverse=True)) + ')"')
    uses = {}
    skip_types = {f"{MOD}:tree_pollination"}
    for rid, (source, raw) in pack.all_recipes.items():
        if rid.startswith(MOD + ":") or rid in removed:
            continue
        # cheap prefilter: the recipe must mention one of our items or tags
        if f"{MOD}:" not in raw and not tag_re.search(raw):
            continue
        d = parse_json(raw)
        if not isinstance(d, dict) or d.get("type") in skip_types or not conditions_ok(d):
            continue
        ins, outs = [], []
        _refs({k: v for k, v in d.items() if k != "type"}, False, ins, outs)
        used = set()
        via = {}
        for ref, _ in ins:
            if ref.startswith("#"):
                for m in tag_members.get(ref[1:], []):
                    used.add(m)
                    via.setdefault(m, ref)
            elif ref.startswith(MOD + ":"):
                used.add(ref)
        if not used:
            continue
        out_items = []
        for ref, cnt in outs:
            if ref.startswith("#"):
                continue
            if isinstance(cnt, dict):
                cnt = 1
            if ref not in [o["item"] for o in out_items] and (pack.item_exists(ref) or ref.startswith("minecraft:")):
                out_items.append({"item": ref_item(ref), "count": cnt})
        if not out_items:
            continue
        t = d.get("type", "?")
        # the mod that adds the recipe (a Croptopia recipe of type minecraft:crafting_shaped counts as Croptopia)
        rns = source.split(":")[1] if source.startswith("datapack:") else rid.split(":")[0]
        entry = {"id": rid, "type": t, "mod": pack.mod_names.get(rns, pack.mod_names.get(t.split(":")[0], rns)),
                 "out": out_items[:4], "ins": len(ins)}
        for m in used:
            e = dict(entry)
            if m in via:
                e["via"] = via[m]
            uses.setdefault(m, []).append(e)
    uses_total = {}
    for m in uses:
        uses[m].sort(key=lambda e: (e["mod"], items_out[e["out"][0]["item"]]["name"]))
        uses_total[m] = len(uses[m])
        uses[m] = uses[m][:150]  # dye materials match hundreds of dye recipes

    # everything the mod adds that is not a per-tree wood block, so the item pages can show it
    wood_suffix = re.compile(r"_(sapling|leaves|log|wood|stripped_log|stripped_wood|planks|stairs|slab|fence|fence_gate|door|trapdoor|"
                             r"pressure_plate|button|sign|hanging_sign|bookshelf|potted_sapling)$|^(advanced_\w+_beehive|expansion_box_\w+)$")
    for iid in sorted(our_items):
        if not wood_suffix.search(iid.split(":")[1]):
            ref_item(iid)
    for extra_item in ["minecraft:bone_meal", "minecraft:spyglass", "minecraft:bee_nest", "minecraft:beehive", "minecraft:bee_spawn_egg",
                       "productivebees:advanced_oak_beehive", "productivebees:upgrade_range", "productivebees:upgrade_simulator",
                       "productivelib:upgrade_pollen_sieve", "productivelib:upgrade_time", "productivelib:upgrade_time_2",
                       "productivelib:upgrade_base", "minecraft:iron_axe", "minecraft:glass_bottle", "minecraft:bucket",
                       "minecraft:furnace", "minecraft:smoker", "minecraft:campfire", "mekanism:precision_sawmill",
                       "minecraft:brush", "minecraft:grass_block", "minecraft:oak_log", "minecraft:oak_planks", "productivebees:allergy_bee"]:
        if pack.item_exists(extra_item):
            ref_item(extra_item)

    prev_path = OUT_DATA / "ptdata.json"
    prev = json.loads(prev_path.read_text("utf-8")) if prev_path.exists() else {}
    code = read_source(src) if src else prev.get("code", {})

    lang_keep = {k: v for k, v in lang.items() if k.startswith(f"{MOD}.") and not k.startswith(f"{MOD}.jei")}
    for k in ("entity.productivebees.allergy_bee",):
        if k in lang:
            lang_keep[k] = lang[k]

    tags_out = {}
    for tag in ["c:ingots/iron", "minecraft:planks", "minecraft:logs", "c:honeycombs", "c:hives", "c:campfires", "c:tools/shear",
                "minecraft:saplings", f"{MOD}:stripper_tools", "minecraft:axes"]:
        tags_out[tag] = [ref_item(i) for i in pack.resolve_tag(tag) if pack.item_exists(i)][:40]
    pollinatable = pack.block_tags.get(f"{MOD}:pollinatable", [])

    out = {
        "generated": date.today().isoformat(),
        "versions": {m: pack.mod_versions.get(m) for m in (MOD, "productivebees", "productivelib", "neoforge", "minecraft", "mekanism")},
        "mods": sorted(m for m in ("productivebees", "mekanism", "treetap", "botanypots", "thermal", "farmingforblockheads",
                                   "patchouli", "jei", "emi", "almostunified") if m in pack.mods),
        "config": {**read_config(pack_dir / f"config/{MOD}-server.toml"), **read_config(pack_dir / f"config/{MOD}-startup.toml")},
        "trees": trees,
        "vanilla": vanilla,
        "pollination": pollination,
        "crafting": crafting,
        "cooking": cooking,
        "sawmill": sawmill,
        "sawing": sawing,
        "other": other,
        "unavailable": unavailable,
        "uses": uses,
        "usesTotal": uses_total,
        "itemTags": item_tags,
        "produce": sorted(produce),
        "code": code,
        "tagLists": tags_out,
        "pollinatable": pollinatable,
        "removedRecipes": sorted(r for r in removed if MOD in r or r.startswith("*")),
        "replacedInputs": replaced,
        "overrides": {k: v for k, v in pack.overrides.items() if k.startswith(MOD)},
        "items": items_out,
        "lang": lang_keep,
    }
    prev_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"trees {len(trees)}, pollination {len(pollination)}, crafting {len(crafting)}, cooking {len(cooking)}, "
          f"sawmill {len(sawmill)}, sawing {len(sawing)}, other {len(other)}, unavailable {len(unavailable)}, "
          f"items {len(items_out)}, missing icons {sum(1 for i in items_out.values() if not i['icon'])}, "
          f"items with uses {len(uses)}")
    print("versions", out["versions"], "mods", out["mods"])
    print("other types", sorted({v['type'] for v in other.values()}))
    print("overrides", out["overrides"], "removed", out["removedRecipes"])


if __name__ == "__main__":
    main()
