// Tree list and tree detail pages.
import { $, esc, fmt, store, debounce } from "./util.js";
import { db, node, itemName, tierOf, waysFor, matchingCrosses, perDelivery, fruitMinutes, SAPLING_MINUTES } from "./db.js";
import { icon, itemChip, treeChip, treeCell, setNav, pct, minutes, sortTable } from "./ui.js";

const LOOT_NAMES = {
  "minecraft:chests/bastion_treasure": "Bastion treasure chests",
  "minecraft:chests/bastion_hoglin_stable": "Bastion hoglin stable chests",
  "minecraft:chests/shipwreck_treasure": "Shipwreck treasure chests",
  "minecraft:archaeology/ocean_ruin_cold": "Suspicious sand and gravel in cold ocean ruins",
  "minecraft:chests/ancient_city": "Ancient City chests",
  "minecraft:chests/desert_pyramid": "Desert Pyramid chests",
  "minecraft:chests/end_city_treasure": "End City treasure chests",
};
export const lootName = t => LOOT_NAMES[t] || t;

export const sizesText = t => t.sizes.map(s => s.replace("x", "×")).join(", ");

export function howShort(t) {
  const ways = waysFor(t.id);
  if (!ways.length) return "Not obtainable";
  const w = ways[0];
  if (w.kind === "loot") return "Loot";
  if (w.kind === "mutation") return "Mutation";
  return "Breeding";
}

function specials(t) {
  const out = [];
  if (t.light) out.push(`Glows (light ${t.light})`);
  if (t.fireproof) out.push("Fireproof wood");
  if (t.stripDrop) out.push(`Stripping drops ${itemName(t.stripDrop)}`);
  return out;
}

export function viewTrees(app) {
  setNav("trees");
  const st = store.get("trees", { q: "", how: "", fruit: false, sort: "name", dir: "asc" });
  app.innerHTML = `
    <h1>Trees</h1>
    <p class="muted">All ${db.trees.length} Productive Trees trees. Generation counts the breeding steps from vanilla trees. Click a column to sort.</p>
    <div class="toolbar">
      <input class="grow" id="tq" type="search" placeholder="Filter by name, Latin name or fruit" value="${esc(st.q)}">
      <select id="thow">
        <option value="">Any source</option>
        <option value="Breeding">Breeding</option>
        <option value="Mutation">Mutation</option>
        <option value="Loot">Loot</option>
        <option value="Not obtainable">Not obtainable</option>
      </select>
      <label class="chk"><input type="checkbox" id="tfruit"${st.fruit ? " checked" : ""}> Only trees with fruit</label>
    </div>
    <div id="ttable"></div>`;
  $("#thow").value = st.how;
  const cols = [
    { key: "name", label: "Tree", get: t => t.name, html: t => `${treeCell(t.id)}${t.latin ? `<div class="muted small" style="margin-left:28px"><i>${esc(t.latin)}</i></div>` : ""}` },
    { key: "fruit", label: "Fruit", get: t => t.fruit ? itemName(t.fruit.item) : "", html: t => t.fruit ? itemChip(t.fruit.item, t.fruit.count) : "" },
    { key: "gen", label: "Generation", num: true, get: t => tierOf(t.id) ?? 99, html: t => tierOf(t.id) === undefined ? "" : String(tierOf(t.id)) },
    { key: "how", label: "Source", get: t => howShort(t), html: t => esc(howShort(t)) },
    { key: "chance", label: "Best chance", num: true, get: t => waysFor(t.id)[0]?.chance ?? -1, html: t => { const w = waysFor(t.id)[0]; return w ? pct(Math.min(1, w.chance)) : ""; } },
    { key: "size", label: "Sapling layout", get: t => t.sizes.join(" "), html: t => esc(sizesText(t)) },
    { key: "kids", label: "Crosses into", num: true, get: t => new Set((db.crossesFrom[t.id] || []).map(r => r.result)).size, html: t => { const n = new Set((db.crossesFrom[t.id] || []).map(r => r.result)).size; return n ? String(n) : ""; } },
    { key: "special", label: "Special", get: t => specials(t).join(", "), html: t => specials(t).map(s => `<span class="chip cat">${esc(s)}</span>`).join(" ") },
  ];
  const render = () => {
    const q = st.q.trim().toLowerCase();
    const rows = db.trees.filter(t =>
      (!q || t.name.toLowerCase().includes(q) || (t.latin || "").toLowerCase().includes(q) || (t.fruit && itemName(t.fruit.item).toLowerCase().includes(q)))
      && (!st.how || howShort(t) === st.how) && (!st.fruit || t.fruit));
    store.set("trees", st);
    sortTable($("#ttable"), cols, rows, st, render);
  };
  $("#tq").addEventListener("input", debounce(e => { st.q = e.target.value; render(); }));
  $("#thow").addEventListener("change", e => { st.how = e.target.value; render(); });
  $("#tfruit").addEventListener("change", e => { st.fruit = e.target.checked; render(); });
  render();
}

// one line per way to get a tree
export function wayHtml(n, w) {
  if (w.kind === "cross") {
    const r = w.recipe;
    const alt = list => list.length > 1 ? list.map(x => treeChip(x)).join(' <span class="muted">or</span> ') : treeChip(list[0]);
    const eff = perDelivery(r, [w.a, w.b]);
    const comp = matchingCrosses([w.a, w.b]).length;
    return `<div class="effect">
      <div class="items">${alt(r.a)}<span class="muted">×</span>${alt(r.b)}</div>
      <div class="small" style="margin-top:6px">Chance ${pct(Math.min(1, r.chance))} per pollination roll${r.chance > 1 ? ` <span class="muted">(recipe value ${fmt(r.chance)})</span>` : ""}.
      ${comp > 1 ? `<span class="role">These two trees also match ${comp - 1} other cross${comp > 2 ? "es" : ""}</span>, so with only them near a hive one honey delivery gives ${pct(eff, 1)}.` : `With only these two near a hive: ${pct(eff, 1)} per honey delivery, ${pct(perDelivery(r, [w.a, w.b], true), 1)} with an Allergy Bee.`}
      Hand pollination with pollen always works.</div>
    </div>`;
  }
  if (w.kind === "mutation") {
    return `<div class="effect">Grow a ${treeChip(w.from)} sapling: each time it grows there is a <b>${pct(w.chance)}</b> chance it becomes a ${esc(node[n].name)} tree instead. <a href="#/guide?s=mutations">How mutations work</a></div>`;
  }
  const l = node[n].loot;
  return `<div class="effect">${pct(l.chance)} chance to find one in: ${l.tables.map(t => esc(lootName(t))).join(", ")}.
    ${node[n].lootText ? `<div class="muted small" style="margin-top:4px"><i>"${esc(node[n].lootText)}"</i></div>` : ""}</div>`;
}

export function viewTree(app, id) {
  const t = node[id];
  if (!t || t.kind !== "tree") {
    app.innerHTML = `<h1>Unknown tree</h1><p><a href="#/trees">← Trees</a></p>`;
    return;
  }
  setNav("trees");
  const ways = waysFor(id);
  const kids = {};
  for (const r of db.crossesFrom[id] || []) {
    const partners = [...new Set([...r.a, ...r.b])].filter(x => x !== id);
    const self = r.a.includes(id) && r.b.includes(id);
    (kids[r.result] ||= []).push({ r, partners: self ? [id] : partners.filter(p => (r.a.includes(id) ? r.b : r.a).includes(p)) });
  }
  const f = t.fruit;
  // wood recipes are the same for every tree, only the Sawmill extras differ
  const sawExtra = Object.values(db.sawmill).filter(r => r.input.items.includes(t.log) && r.tertiary);
  const tier = tierOf(id);
  const connected = (db.code.connectedLeaves || []).includes(id);

  app.innerHTML = `
    <p><a href="#/trees">← Trees</a></p>
    <div class="hero">
      ${icon(t.sapling, "lg")}
      <div style="flex:1;min-width:220px">
        <h1 style="margin:0">${esc(t.name)}</h1>
        ${t.latin ? `<div class="muted"><i>${esc(t.latin)}</i></div>` : ""}
        <div class="meta">
          <span class="chip">${esc(howShort(t))}</span>
          ${tier !== undefined ? `<span class="chip">Generation <span class="lvl">${tier}</span></span>` : ""}
          ${t.sizes.map(s => `<span class="chip cat">${esc(s.replace("x", "×"))}</span>`).join("")}
          ${specials(t).map(s => `<span class="chip cat">${esc(s)}</span>`).join("")}
          <span class="chip cat">${esc(t.sapling)}</span>
        </div>
      </div>
      ${ways.some(w => w.kind !== "loot") ? `<a class="btn" href="#/breeding?t=${esc(id)}">Breeding plan</a>` : ""}
    </div>
    <div class="cols">
      <div class="card">
        <h3>How to get it</h3>
        ${ways.length ? ways.map(w => wayHtml(id, w)).join("") : `<p class="bad">No way to get this tree in survival in this pack: no cross, mutation or loot gives its sapling.</p>`}
        <p class="small muted" style="margin-bottom:0">A pollinated leaf drops the new sapling when you break it. <a href="#/guide?s=bees">How breeding works</a></p>
      </div>
      <div class="card">
        <h3>Tree</h3>
        <div class="items" style="margin-bottom:10px">${[t.sapling, t.leaves, t.log, t.planks].map(i => itemChip(i)).join("")}</div>
        <dl class="kv">
          <dt>Sapling layout</dt><dd>${t.sizes.length ? esc(sizesText(t)) : ""}${t.sizes.length && !t.sizes.includes("1x1") ? ' <span class="role">(a single sapling does not grow)</span>' : ""}</dd>
          <dt>Grows on</dt><dd>${t.soil ? `<code>#${esc(t.soil)}</code>` : "Dirt blocks (grass, podzol, moss, mud and so on) and farmland"}</dd>
          <dt>Growth</dt><dd>About ${minutes(SAPLING_MINUTES)} on average, bone meal works</dd>
          ${t.mutation ? `<dt>Mutation</dt><dd>${pct(t.mutation.chance)} to grow into ${treeChip(t.mutation.target)}</dd>` : ""}
          ${t.light ? `<dt>Light</dt><dd>Logs, planks and leaves glow with light level ${t.light}</dd>` : ""}
          ${t.fireproof ? `<dt>Fire</dt><dd>Wood does not burn (like Warped Stems)</dd>` : ""}
          ${connected ? `<dt>Leaves</dt><dd>Stay alive up to 10 leaf blocks away from a log (long fronds)</dd>` : ""}
          ${t.vine ? `<dt>Decoration</dt><dd>Grows with ${esc(itemName(t.vine))}</dd>` : ""}
          <dt>Colors</dt><dd>${["leafColor", "logColor", "plankColor"].filter(k => t.colors[k]).map(k => `<span class="swatch" style="background:${esc(t.colors[k])}" title="${esc(k)} ${esc(t.colors[k])}"></span>`).join(" ")}</dd>
        </dl>
      </div>
      ${f ? `<div class="card">
        <h3>Fruit</h3>
        <div class="items" style="margin-bottom:10px">${itemChip(f.item)}</div>
        <dl class="kv">
          <dt>Harvest</dt><dd>Right-click a ripe fruit leaf: ${f.count}× ${esc(itemName(f.item))}</dd>
          <dt>Growth speed</dt><dd>${fmt(f.growthSpeed)}</dd>
          <dt>Ripening</dt><dd>About ${minutes(fruitMinutes(f.growthSpeed))} on average (7 stages)</dd>
          ${f.style !== "default" ? `<dt>Shape</dt><dd>${id === "coconut" ? "Ripe coconuts fall down as Coconut Sprouts" : id === "brown_amber" ? "Ripe fruit drips amber puddles onto the ground" : "Hangs below the leaves"}</dd>` : ""}
        </dl>
        <p class="small muted" style="margin-bottom:0"><a href="#/item/${esc(f.item.split(":")[1])}">What to do with it</a>, <a href="#/guide?s=fruit">how fruit grows</a></p>
      </div>` : ""}
      <div class="card">
        <h3>Wood</h3>
        ${sawExtra.map(r => `<p>The Sawmill also gives ${itemChip(r.tertiary.item, r.tertiary.count)} per log.</p>`).join("")}
        ${t.stripDrop ? `<p>Stripping a log (axe or Stripper) also drops ${itemChip(t.stripDrop)}.</p>` : ""}
        ${t.woodBlocks ? `<details><summary>${t.woodBlocks.length} wood blocks</summary><div class="items">${t.woodBlocks.map(i => itemChip(i)).join("")}</div></details>` : ""}
        ${t.hive || t.box ? `<div class="items" style="margin-top:10px">${[t.hive, t.box].filter(Boolean).map(i => itemChip(i)).join("")}</div>` : ""}
        <p class="small muted" style="margin-bottom:0">Planks, wood blocks, Sawmill and hives work the same for every tree. <a href="#/guide?s=wood">Wood recipes</a>, <a href="#/guide?s=hives">hive recipes</a></p>
      </div>
    </div>
    ${Object.keys(kids).length ? `
    <h2>Crosses into</h2>
    <p class="muted">Trees you can breed with ${esc(t.name)} as one parent.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Result</th><th>Other parent</th><th class="num">Chance</th></tr></thead><tbody>
      ${Object.entries(kids).sort((a, b) => node[a[0]].name.localeCompare(node[b[0]].name)).map(([res, list]) => list.map(({ r, partners }) =>
        `<tr><td>${treeCell(res)}</td><td><div class="items">${partners.map(p => treeChip(p)).join('<span class="muted">or</span>')}</div></td><td class="num">${pct(Math.min(1, r.chance))}</td></tr>`).join("")).join("")}
    </tbody></table></div>` : ""}`;
}
