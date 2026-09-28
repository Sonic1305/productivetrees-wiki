// Shared HTML bits: icons, item and tree chips, recipe cards.
import { $$, esc, fmt } from "./util.js";
import { db, node, itemName, nodeName, isVanilla, craftingFor, cookingFor } from "./db.js";

export function icon(id, cls = "sm") {
  const it = db.items[id];
  return it?.icon ? `<img class="ic ${cls}" src="icons/${esc(it.icon)}.png" alt="" loading="lazy">` : "";
}

const TREE_PART = /^productivetrees:(.+?)_(sapling|leaves|log|wood|stripped_log|stripped_wood|planks)$/;

// where an item links to: tree parts go to their tree, other mod items to the item page
export function itemHref(id) {
  const m = id.match(TREE_PART);
  if (m && node[m[1]]) return `#/tree/${m[1]}`;
  if (id.startsWith("productivetrees:") && db.items[id]) return `#/item/${id.split(":")[1]}`;
  return "";
}

export function itemChip(id, count) {
  const n = count && count !== "1" && count !== 1 ? `<span class="muted">${esc(count)}×</span> ` : "";
  const inner = `${icon(id)}${n}${esc(itemName(id))}`;
  const href = itemHref(id);
  return href
    ? `<a class="item" href="${href}" title="${esc(id)}">${inner}</a>`
    : `<span class="item" title="${esc(id)}">${inner}</span>`;
}

// a breeding parent or result, shown with its sapling
export function treeChip(n, extra = "") {
  const t = node[n];
  if (!t) return `<span class="item">${esc(n)}</span>`;
  const inner = `${icon(t.sapling)}${esc(t.name)}${extra}`;
  return isVanilla(n)
    ? `<span class="item" title="Vanilla tree">${inner}</span>`
    : `<a class="item" href="#/tree/${esc(n)}" title="${esc(t.latin || t.name)}">${inner}</a>`;
}

export function treeCell(n) {
  const t = node[n];
  return `<a class="namecell" href="#/tree/${esc(n)}">${icon(t.sapling)}<span>${esc(t.name)}</span></a>`;
}

export function setNav(key) {
  $$("#nav a").forEach(a => a.classList.toggle("active", a.dataset.nav === key));
}

export function pct(p, digits = 0) {
  const v = p * 100;
  return `${fmt(v, v < 1 ? 2 : v < 10 ? Math.max(digits, 1) : digits)}%`;
}

export function minutes(m) {
  if (m < 90) return `${fmt(m, 0)} min`;
  return `${fmt(m / 60, 1)} h`;
}

// ---------- recipe grids ----------
const PREFERRED_NS = ["minecraft", "productivetrees"];
function rank(id) {
  const i = PREFERRED_NS.indexOf(id.split(":")[0]);
  return (i < 0 ? 9 : i) + (db.items[id]?.icon ? 0 : 20);
}
export function pickItem(ing) {
  return ing?.items?.length ? ing.items.slice().sort((a, b) => rank(a) - rank(b))[0] : null;
}

export function slot(ing) {
  if (!ing) return '<span class="rslot"></span>';
  const it = pickItem(ing);
  const names = [...new Set((ing.items || []).map(itemName))];
  const title = (ing.label ? `Any ${ing.label}: ` : "") + names.slice(0, 8).join(", ") + (names.length > 8 || ing.more ? " and more" : "");
  if (!it) return `<span class="rslot" title="${esc(ing.label || "")}">?</span>`;
  const ic = db.items[it]?.icon;
  const img = ic ? `<img src="icons/${esc(ic)}.png" alt="${esc(itemName(it))}">` : `<small>${esc(itemName(it).slice(0, 6))}</small>`;
  const any = names.length > 1 ? '<i class="any">*</i>' : "";
  const href = itemHref(it);
  return href
    ? `<a class="rslot" href="${href}" title="${esc(title)}">${img}${any}</a>`
    : `<span class="rslot" title="${esc(title)}">${img}${any}</span>`;
}

export function resultSlot(id, count) {
  const ic = db.items[id]?.icon;
  const href = itemHref(id);
  const inner = `${ic ? `<img src="icons/${esc(ic)}.png" alt="">` : "?"}${count > 1 ? `<b class="cnt">${count}</b>` : ""}`;
  return href
    ? `<a class="rslot out" href="${href}" title="${esc(itemName(id))}">${inner}</a>`
    : `<span class="rslot out" title="${esc(itemName(id))}">${inner}</span>`;
}

export function recipeCard(rid, opts = {}) {
  const r = db.crafting[rid];
  if (!r) return "";
  let grid;
  if (r.type === "minecraft:crafting_shaped") {
    const w = Math.max(...r.pattern.map(p => p.length));
    const rows = r.pattern.map(p => p.padEnd(w, " "));
    grid = `<div class="rgrid" style="grid-template-columns:repeat(${w},34px)">${rows.flatMap(row => [...row].map(c => c === " " ? slot(null) : slot(r.key[c]))).join("")}</div>`;
  } else {
    const n = r.ingredients.length;
    const w = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    grid = `<div class="rgrid" style="grid-template-columns:repeat(${w},34px)">${r.ingredients.map(slot).join("")}</div>`;
  }
  return `<div class="rcard${r.removed ? " removed" : ""}">
    <div class="rtitle">${esc(opts.title || itemName(r.result))}${r.type === "minecraft:crafting_shapeless" ? ' <span class="muted small">(shapeless)</span>' : ""}</div>
    <div class="rbody">${grid}<span class="rarrow">→</span>${resultSlot(r.result, r.count)}</div>
    ${r.removed ? '<div class="small bad">Removed in this pack (KubeJS)</div>' : ""}
    ${opts.note ? `<div class="small muted">${opts.note}</div>` : ""}
  </div>`;
}

const COOK_NAMES = { "minecraft:smelting": "Furnace", "minecraft:smoking": "Smoker", "minecraft:campfire_cooking": "Campfire", "minecraft:blasting": "Blast Furnace" };

export function cookCard(itemId) {
  const ids = cookingFor(itemId);
  if (!ids.length) return "";
  const r0 = db.cooking[ids[0]];
  const ways = ids.map(id => db.cooking[id]).map(r => `${COOK_NAMES[r.type] || r.type} ${fmt(r.time / 20, 1)} s`).join(", ");
  return `<div class="rcard">
    <div class="rtitle">${esc(itemName(itemId))} <span class="muted small">(cooking)</span></div>
    <div class="rbody">${slot(r0.input)}<span class="rarrow">→</span>${resultSlot(itemId, r0.count)}</div>
    <div class="small muted">${esc(ways)}</div>
  </div>`;
}

export function sawCard(r, title = "Sawmill") {
  const outs = [r.output, r.secondary, r.tertiary].filter(Boolean);
  return `<div class="rcard">
    <div class="rtitle">${esc(title)}</div>
    <div class="rbody">${slot(r.input)}<span class="rarrow">→</span>${outs.map(o => resultSlot(o.item, o.count)).join("")}</div>
  </div>`;
}

export function cardsFor(itemId, opts = {}) {
  return craftingFor(itemId).map(id => recipeCard(id, opts[id])).join("") + cookCard(itemId);
}

export function recipesFor(itemId, opts = {}) {
  const cards = cardsFor(itemId, opts);
  return cards ? `<div class="rcards">${cards}</div>` : "";
}

// sortable table helper: cols = [{key, label, num, get(row) -> sort value, html(row)}]
export function sortTable(el, cols, rows, state, onSort) {
  const sorted = rows.slice();
  const c = cols.find(x => x.key === state.sort) || cols[0];
  sorted.sort((a, b) => {
    const x = c.get(a), y = c.get(b);
    const r = typeof x === "number" || typeof y === "number" ? (x ?? -Infinity) - (y ?? -Infinity) : String(x ?? "").localeCompare(String(y ?? ""));
    return state.dir === "desc" ? -r : r;
  });
  el.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>${cols.map(col =>
    `<th class="sortable${col.num ? " num" : ""}${col.key === c.key ? " sorted" : ""}" data-k="${col.key}">${col.label}${col.key === c.key ? (state.dir === "desc" ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead>
    <tbody>${sorted.map(r => `<tr>${cols.map(col => `<td${col.num ? ' class="num"' : ""}>${col.html(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  $$("th.sortable", el).forEach(th => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (state.sort === k) state.dir = state.dir === "desc" ? "asc" : "desc";
    else { state.sort = k; state.dir = cols.find(x => x.key === k).num ? "desc" : "asc"; }
    onSort();
  }));
}
