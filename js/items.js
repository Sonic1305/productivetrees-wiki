// Produce list (fruit, nuts, spices, crates, other items) and item pages.
import { $, $$, esc, fmt, store, debounce, idPath } from "./util.js";
import { db, node, itemName, food, groupOf, craftingFor, cookingFor, craftingUses, cookingUses, sawmillFor, waysFor } from "./db.js";
import { icon, itemChip, treeChip, setNav, sortTable, recipeCard, cookCard, sawCard, pickItem, treeOfItem } from "./ui.js";

const GROUPS = { berries: "Berry", fruits: "Fruit", nuts: "Nut", roasted_nuts: "Roasted" };
const TYPES = ["Fruit", "Berry", "Nut", "Roasted", "Spice & produce", "Dye", "Crate", "Other"];
const TREE_BLOCK = /_(sapling|leaves|log|wood|stripped_log|stripped_wood|planks|stairs|slab|fence|fence_gate|door|trapdoor|pressure_plate|button|sign|hanging_sign|bookshelf)$|^(advanced_\w+_beehive|expansion_box_\w+)$/;

export function typeOf(id) {
  const g = groupOf(id);
  if (g) return GROUPS[g] || "Fruit";
  if (id.endsWith("_crate")) return "Crate";
  if (db.produce.includes(id)) return "Spice & produce";
  if ((db.itemTags[id] || []).includes("c:dyes")) return "Dye";
  return "Other";
}

export function modItems() {
  return Object.keys(db.items).filter(id => id.startsWith("productivetrees:") && !TREE_BLOCK.test(idPath(id)));
}

// items without a recipe that still show up in survival
export const SPECIAL = {
  "productivetrees:pollen": 'Collected by bees with a Pollen Sieve Upgrade in an Advanced Beehive. <a href="#/guide?s=pollen">How</a>',
  "productivetrees:coconut_sprout": "Falls from a ripe Coconut.",
};

// every way to get an item in this pack; recipes only count when all their inputs can be had
const memo = {};
export function obtainable(id, seen = new Set()) {
  if (!id.startsWith("productivetrees:")) return true;
  if (id in memo) return memo[id];
  if (seen.has(id)) return false;
  seen.add(id);
  const ok = sources(id, seen).length > 0;
  if (seen.size === 1) memo[id] = ok;
  seen.delete(id);
  return ok;
}
const ingOk = (ing, seen) => !ing || !ing.items?.length || ing.items.some(i => obtainable(i, seen));

export function sources(id, seen = new Set([id])) {
  const out = [];
  if (SPECIAL[id]) out.push({ kind: "special" });
  for (const t of db.fruitOf[id] || []) {
    if (waysFor(t).length) out.push({ kind: node[t].fruit?.item === id ? "fruit" : "strip", tree: t });
  }
  const treePart = id.match(/^productivetrees:(.+?)_(sapling|leaves|log|wood|planks)$/);
  if (treePart && node[treePart[1]] && waysFor(treePart[1]).length) out.push({ kind: "tree" });
  if (sawmillFor(id).some(r => ingOk(r.input, seen))) out.push({ kind: "sawmill" });
  if (craftingFor(id).some(r => {
    const c = db.crafting[r];
    if (c.removed) return false;
    return (c.key ? c.pattern.join("").split("").filter(ch => ch !== " ").map(ch => c.key[ch]) : c.ingredients).every(i => ingOk(i, seen));
  })) out.push({ kind: "craft" });
  if (cookingFor(id).some(r => ingOk(db.cooking[r].input, seen))) out.push({ kind: "cook" });
  return out;
}

function unavailableFor(id) {
  const path = idPath(id);
  return Object.entries(db.unavailable).filter(([rid]) => rid.includes(path.replace(/_bucket$/, "")) && !rid.includes("/hives/") && !rid.includes("expansion"));
}

const recipeKind = t => {
  const path = t.split(":").pop();
  return path.replace(/^crafting_(shaped|shapeless)$/, "crafting").replace(/_/g, " ");
};

function foodText(id) {
  const f = food(id);
  if (!f) return "";
  return `${f.nutrition} <span class="muted">(${fmt(f.nutrition * f.saturationMod * 2, 1)} sat.)</span>`;
}

export function viewItems(app) {
  setNav("produce");
  const st = store.get("items", { q: "", type: "", sort: "name", dir: "asc" });
  const all = modItems();
  app.innerHTML = `
    <h1>Produce and items</h1>
    <p class="muted">Everything Productive Trees adds apart from the wood blocks of each tree: ${all.filter(i => ["Fruit", "Berry", "Nut"].includes(typeOf(i))).length} fruits, berries and nuts, spices, crates, machines and materials. Food shows hunger points and saturation.</p>
    <div class="toolbar">
      <input class="grow" id="iq" type="search" placeholder="Filter items" value="${esc(st.q)}">
      <select id="itype"><option value="">All types</option>${TYPES.map(t => `<option>${t}</option>`).join("")}</select>
    </div>
    <div id="itable"></div>`;
  $("#itype").value = st.type;
  const cols = [
    { key: "name", label: "Item", get: i => itemName(i), html: i => `<a class="namecell" href="#/item/${esc(idPath(i))}">${icon(i)}<span>${esc(itemName(i))}</span></a>` },
    { key: "type", label: "Type", get: i => typeOf(i), html: i => esc(typeOf(i)) },
    { key: "from", label: "From", get: i => (db.fruitOf[i] || []).map(t => node[t].name).join(", "), html: i => {
      const trees = db.fruitOf[i] || [];
      if (trees.length) return `<div class="items">${trees.map(t => treeChip(t)).join("")}</div>`;
      return obtainable(i) ? "" : '<span class="bad small">No source</span>';
    } },
    { key: "food", label: "Food", num: true, get: i => food(i)?.nutrition ?? -1, html: i => foodText(i) },
    { key: "uses", label: "Used in", num: true, get: i => (db.usesTotal?.[i] || 0) + craftingUses(i).length + cookingUses(i).length,
      html: i => { const n = (db.usesTotal?.[i] || 0) + craftingUses(i).length + cookingUses(i).length; return n ? `${n} <span class="muted">recipes</span>` : ""; } },
  ];
  const render = () => {
    const q = st.q.trim().toLowerCase();
    const rows = all.filter(i => (!q || itemName(i).toLowerCase().includes(q) || i.includes(q)) && (!st.type || typeOf(i) === st.type));
    store.set("items", st);
    sortTable($("#itable"), cols, rows, st, render);
  };
  $("#iq").addEventListener("input", debounce(e => { st.q = e.target.value; render(); }));
  $("#itype").addEventListener("change", e => { st.type = e.target.value; render(); });
  render();
}

export function viewItem(app, path) {
  const id = `productivetrees:${path}`;
  // wood blocks and hives have no page of their own, they belong to their tree
  const tree = treeOfItem(id);
  if (tree) {
    location.replace(`#/tree/${tree}`);
    return;
  }
  if (!db.items[id]) {
    app.innerHTML = `<h1>Unknown item</h1><p><a href="#/produce">← Produce</a></p>`;
    return;
  }
  setNav("produce");
  const trees = db.fruitOf[id] || [];
  const f = food(id);
  const saw = sawmillFor(id);
  // the same Sawmill recipe exists for every log: show one card instead of a hundred
  const sawCards = saw.length > 3
    ? sawCard(saw[0], `Sawmill: any log (${saw.length} kinds)`)
    : saw.map(r => sawCard(r, `Sawmill: ${itemName(pickItem(r.input))}`)).join("");
  const made = craftingFor(id).map(r => recipeCard(r)).join("") + cookCard(id) + sawCards;
  const usedCraft = craftingUses(id).filter(r => db.crafting[r].result !== id).map(r => recipeCard(r)).join("")
    + [...new Set(cookingUses(id).map(r => db.cooking[r].result))].map(cookCard).join("");
  const uses = db.uses[id] || [];
  const total = db.usesTotal?.[id] || uses.length;
  const tags = db.itemTags[id] || [];
  const unav = unavailableFor(id);
  const src = obtainable(id) ? [1] : [];
  const needs = [...new Set(unav.flatMap(([, u]) => u.needs))];

  app.innerHTML = `
    <p><a href="#/produce">← Produce</a></p>
    <div class="hero">
      ${icon(id, "lg")}
      <div>
        <h1 style="margin:0">${esc(itemName(id))}</h1>
        <div class="meta"><span class="chip">${esc(typeOf(id))}</span><span class="chip cat">${esc(id)}</span>${tags.slice(0, 4).map(t => `<span class="chip cat">#${esc(t)}</span>`).join("")}</div>
      </div>
    </div>
    ${SPECIAL[id] ? `<div class="note info">${SPECIAL[id]}</div>` : ""}
    ${!src.length ? `<div class="note">No way to get this item in this pack.${needs.length ? ` Its recipes need ${needs.map(m => `<b>${esc(m)}</b>`).join(", ")}, which is not installed.` : ""}</div>` : ""}
    <div class="cols">
      ${trees.length || f ? `<div class="card">
        ${trees.length ? `<h3>Comes from</h3><div class="items">${trees.map(t => treeChip(t)).join("")}</div>
          <p class="small muted">${trees.some(t => node[t].fruit?.item === id)
            ? `Right-click a ripe fruit leaf to pick ${trees.map(t => `${node[t].fruit.count}`).filter((v, i, a) => a.indexOf(v) === i).join(" or ")} at once. Breaking a ripe fruit leaf drops 1. <a href="#/guide?s=fruit">How fruit grows</a>`
            : "Dropped when you strip a log of this tree with an axe or the Stripper."}</p>` : ""}
        ${f ? `<h3>Food</h3><dl class="kv"><dt>Hunger</dt><dd>${f.nutrition}</dd><dt>Saturation</dt><dd>${fmt(f.nutrition * f.saturationMod * 2, 1)}</dd>
          ${f.fast ? "<dt>Eating</dt><dd>Fast, like dried kelp</dd>" : ""}${f.alwaysEdible ? "<dt>Full</dt><dd>Can be eaten when not hungry</dd>" : ""}</dl>` : ""}
      </div>` : ""}
      ${made ? `<div class="card"><h3>Made with</h3><div class="rcards">${made}</div></div>` : ""}
      ${usedCraft ? `<div class="card"><h3>Used in</h3><div class="rcards">${usedCraft}</div></div>` : ""}
    </div>
    ${uses.length ? `
      <h2>Used by other mods</h2>
      <p class="muted">${total} recipes from other mods in the pack accept this item${tags.length ? ", mostly through a tag" : ""}.${total > uses.length ? ` The first ${uses.length} are listed.` : ""}</p>
      <div class="toolbar"><input class="grow" id="uq" type="search" placeholder="Filter by result or mod"></div>
      <div id="utable"></div>` : ""}
    ${tags.length ? `<details class="raw"><summary>Tags (${tags.length})</summary><div class="chips" style="margin-top:6px">${tags.map(t => `<code>#${esc(t)}</code>`).join(" ")}</div></details>` : ""}`;

  if (uses.length) {
    const st = { sort: "out", dir: "asc", q: "" };
    const cols = [
      { key: "out", label: "Result", get: u => itemName(u.out[0].item), html: u => `<div class="items">${u.out.map(o => itemChip(o.item, o.count)).join("")}</div>` },
      { key: "mod", label: "Recipe", get: u => u.mod, html: u => `${esc(u.mod)} <span class="muted small">${esc(recipeKind(u.type))}</span>` },
      { key: "via", label: "Accepts", get: u => u.via || "", html: u => u.via ? `<code>${esc(u.via)}</code>` : '<span class="muted">this item</span>' },
    ];
    const render = () => {
      const q = st.q.toLowerCase();
      sortTable($("#utable"), cols, uses.filter(u => !q || u.mod.toLowerCase().includes(q) || u.out.some(o => itemName(o.item).toLowerCase().includes(q))), st, render);
    };
    $("#uq").addEventListener("input", debounce(e => { st.q = e.target.value; render(); }));
    render();
  }
}
