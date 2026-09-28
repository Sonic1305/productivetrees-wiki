// Loads ptdata.json and exposes lookups plus the breeding logic.
import { idPath, titleCase } from "./util.js";

export const db = {
  items: {}, trees: [], vanilla: {}, pollination: [], crafting: {}, cooking: {}, sawmill: {}, sawing: {},
  uses: {}, itemTags: {}, produce: [], code: {}, config: {}, lang: {}, versions: {}, mods: [],
};

// A "node" is anything that can be a breeding parent: a Productive Trees tree ("alder")
// or a vanilla tree ("minecraft:oak").
export const node = {};
const leafToNode = {};
const saplingToNode = {};

export async function loadDb() {
  const res = await fetch("data/ptdata.json");
  Object.assign(db, await res.json());
  for (const t of db.trees) {
    node[t.id] = { ...t, kind: "tree" };
    leafToNode[t.leaves] = t.id;
    saplingToNode[t.sapling] = t.id;
  }
  for (const [leaf, v] of Object.entries(db.vanilla)) {
    node[v.id] = { ...v, kind: "vanilla" };
    leafToNode[leaf] = v.id;
  }
  // recipes as node ids: a and b are lists of alternatives
  db.crosses = db.pollination.map(r => ({
    id: r.id, chance: r.chance, result: saplingToNode[r.result],
    a: r.a.map(i => leafToNode[i]).filter(Boolean), b: r.b.map(i => leafToNode[i]).filter(Boolean),
  })).filter(r => r.result);
  db.crossesFor = {};
  db.crossesFrom = {};
  for (const r of db.crosses) {
    (db.crossesFor[r.result] ||= []).push(r);
    for (const n of new Set([...r.a, ...r.b])) (db.crossesFrom[n] ||= []).push(r);
  }
  db.mutationFrom = {};
  for (const t of db.trees) if (t.mutation) (db.mutationFrom[t.mutation.target] ||= []).push(t.id);
  computeTiers();
  db.fruitOf = {};
  for (const t of db.trees) {
    if (t.fruit) (db.fruitOf[t.fruit.item] ||= []).push(t.id);
    if (t.stripDrop) (db.fruitOf[t.stripDrop] ||= []).push(t.id);
  }
  return db;
}

export function itemName(id) {
  return db.items[id]?.name || titleCase(idPath(id));
}

export function nodeName(n) {
  return node[n]?.name || titleCase(idPath(n));
}

export function isVanilla(n) {
  return n?.startsWith("minecraft:");
}

export function treeHref(n) {
  return isVanilla(n) ? "" : `#/tree/${n}`;
}

// recipes whose result is this item
export function craftingFor(itemId) {
  return Object.keys(db.crafting).filter(k => db.crafting[k].result === itemId);
}
export function cookingFor(itemId) {
  return Object.keys(db.cooking).filter(k => db.cooking[k].result === itemId);
}
export function craftingUses(itemId) {
  return Object.keys(db.crafting).filter(k => {
    const r = db.crafting[k];
    const ings = r.key ? Object.values(r.key) : r.ingredients;
    return ings.some(i => i.items.includes(itemId));
  });
}
export function cookingUses(itemId) {
  return Object.keys(db.cooking).filter(k => db.cooking[k].input.items.includes(itemId));
}
export function sawmillFor(itemId) {
  return Object.values(db.sawmill).filter(r => [r.output, r.secondary, r.tertiary].some(o => o?.item === itemId));
}

// ---------- breeding ----------
// Generation: vanilla trees are 0, a cross is one more than its older parent,
// a mutation one more than the tree it grows from, loot saplings count as 0.
function computeTiers() {
  const tier = {};
  const how = {};
  for (const n of Object.keys(node)) if (isVanilla(n)) tier[n] = 0;
  for (const t of db.trees) if (t.loot) { tier[t.id] = 0; how[t.id] = { kind: "loot" }; }
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of db.crosses) {
      const ta = Math.min(...r.a.map(x => tier[x] ?? Infinity));
      const tb = Math.min(...r.b.map(x => tier[x] ?? Infinity));
      const t = Math.max(ta, tb) + 1;
      if (t < (tier[r.result] ?? Infinity)) { tier[r.result] = t; changed = true; }
    }
    for (const t of db.trees) {
      if (!t.mutation || tier[t.id] === undefined) continue;
      const m = tier[t.id] + 1;
      if (m < (tier[t.mutation.target] ?? Infinity)) { tier[t.mutation.target] = m; changed = true; }
    }
  }
  db.tier = tier;
  db.lootTier = how;
}

export function tierOf(n) {
  return db.tier[n];
}

// best way to get a tree: cheapest generation first, then highest chance
export function waysFor(n) {
  const ways = [];
  for (const r of db.crossesFor[n] || []) {
    const pick = list => list.slice().sort((x, y) => (db.tier[x] ?? 99) - (db.tier[y] ?? 99))[0];
    const a = pick(r.a), b = pick(r.b);
    ways.push({ kind: "cross", recipe: r, a, b, tier: Math.max(db.tier[a] ?? 99, db.tier[b] ?? 99) + 1, chance: r.chance });
  }
  for (const from of db.mutationFrom[n] || []) {
    ways.push({ kind: "mutation", from, tier: (db.tier[from] ?? 99) + 1, chance: node[from].mutation.chance });
  }
  if (node[n]?.loot) ways.push({ kind: "loot", tier: 0, chance: node[n].loot.chance });
  return ways.sort((x, y) => x.tier - y.tier || y.chance - x.chance);
}

// crosses that compete when exactly these leaf types are in range of a hive
export function matchingCrosses(nodes) {
  const set = new Set(nodes);
  return db.crosses.filter(r => r.a.some(x => set.has(x)) && r.b.some(x => set.has(x)));
}

// Each honey delivery picks one of the matching crosses at random, then rolls its chance
// (5x for an Allergy Bee, capped at 100%).
export function perDelivery(recipe, nodes, allergy = false) {
  const n = matchingCrosses(nodes).length || 1;
  return Math.min(1, recipe.chance * (allergy ? 5 : 1)) / n;
}

// step list to breed a target from vanilla trees, parents first
export function planFor(target, choice = {}) {
  const steps = [];
  const seen = new Set();
  const visiting = new Set();
  const visit = n => {
    if (seen.has(n) || isVanilla(n) || visiting.has(n)) return;
    visiting.add(n);
    const ways = waysFor(n);
    const way = ways[choice[n] ?? 0] || ways[0];
    if (way?.kind === "cross") { visit(way.a); visit(way.b); }
    else if (way?.kind === "mutation") visit(way.from);
    visiting.delete(n);
    seen.add(n);
    steps.push({ node: n, way, alternatives: ways.length });
  };
  visit(target);
  return steps;
}

export function baseTreesOf(steps) {
  const out = new Set();
  for (const s of steps) {
    if (s.way?.kind === "cross") for (const p of [s.way.a, s.way.b]) if (isVanilla(p)) out.add(p);
  }
  return [...out];
}

// ---------- fruit ----------
// A fruit leaf ages 0 to 7. Each random tick it grows one stage with chance 1 / (floor(25 / growthSpeed) + 1),
// if the light level is in the tree's range (9 to 15 by default). With randomTickSpeed 3 a block gets a
// random tick every 4096 / 3 ticks on average.
export const RANDOM_TICK_SECONDS = 4096 / 3 / 20;
export function fruitMinutes(growthSpeed) {
  const odds = Math.floor(25 / growthSpeed) + 1;
  return (7 * odds * RANDOM_TICK_SECONDS) / 60;
}
// saplings: 1 in 7 per random tick, two successful ticks (stage 0 to 1, then grow)
export const SAPLING_MINUTES = (2 * 7 * RANDOM_TICK_SECONDS) / 60;

export function food(id) {
  return db.code.foods?.[id];
}
export function groupOf(id) {
  return db.code.groups?.[id];
}
