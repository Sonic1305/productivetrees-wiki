// Breeding planner, "what can I breed" and pair check.
import { $, $$, esc, fmt, store } from "./util.js";
import { db, node, nodeName, isVanilla, tierOf, waysFor, planFor, baseTreesOf, matchingCrosses, perDelivery } from "./db.js";
import { icon, treeChip, treeCell, setNav, pct } from "./ui.js";
import { wayHtml, lootName } from "./trees.js";

const allNodes = () => [
  ...Object.values(db.vanilla).map(v => v.id),
  ...db.trees.map(t => t.id),
];

// ---------- tree picker (dropdown with search) ----------
function picker(el, value, onPick, opts = {}) {
  const list = (opts.nodes || allNodes()).slice().sort((a, b) => nodeName(a).localeCompare(nodeName(b)));
  let open = false, sel = 0;
  const draw = () => {
    const cur = value ? `${icon(node[value].sapling)}<span>${esc(nodeName(value))}</span>` : `<span class="muted">${esc(opts.placeholder || "Pick a tree")}</span>`;
    el.innerHTML = `<div class="pick"><button type="button" class="picker-btn">${cur}<span class="caret">▾</span></button>${open ? `
      <div class="picker"><div class="picker-bar"><input type="search" placeholder="Search trees" aria-label="Search trees"></div><div class="picker-list"></div></div>` : ""}</div>`;
    $(".picker-btn", el).addEventListener("click", () => { open = !open; draw(); if (open) $("input", el).focus(); });
    if (!open) return;
    const input = $("input", el), box = $(".picker-list", el);
    const fill = () => {
      const q = input.value.trim().toLowerCase();
      const res = list.filter(n => !q || nodeName(n).toLowerCase().includes(q) || (node[n].latin || "").toLowerCase().includes(q));
      sel = Math.min(sel, Math.max(0, res.length - 1));
      box.innerHTML = res.map((n, i) => `<div class="picker-row${i === sel ? " sel" : ""}${n === value ? " cur" : ""}" data-n="${esc(n)}">
        <div class="picker-name">${icon(node[n].sapling)}${esc(nodeName(n))}${isVanilla(n) ? ' <span class="muted small">vanilla</span>' : tierOf(n) !== undefined ? ` <span class="muted small">gen ${tierOf(n)}</span>` : ""}</div>
        ${opts.fx ? `<div class="picker-fx small">${opts.fx(n)}</div>` : ""}</div>`).join("") || '<div class="muted" style="padding:6px">No trees</div>';
      $$(".picker-row", box).forEach(r => r.addEventListener("click", () => pick(r.dataset.n)));
    };
    const pick = n => { value = n; open = false; draw(); onPick(n); };
    input.addEventListener("input", () => { sel = 0; fill(); });
    input.addEventListener("keydown", e => {
      const rows = $$(".picker-row", box);
      if (e.key === "ArrowDown") { sel = Math.min(sel + 1, rows.length - 1); fill(); rows[sel]?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
      else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); fill(); e.preventDefault(); }
      else if (e.key === "Enter" && rows[sel]) pick(rows[sel].dataset.n);
      else if (e.key === "Escape") { open = false; draw(); }
    });
    fill();
  };
  const outside = e => { if (open && !el.contains(e.target)) { open = false; draw(); } };
  document.addEventListener("click", outside);
  draw();
}

// ---------- planner ----------
function stepHtml(s, i) {
  const w = s.way;
  let body;
  if (!w) body = `<span class="bad">No way to get ${esc(nodeName(s.node))}.</span>`;
  else if (w.kind === "cross") {
    const eff = perDelivery(w.recipe, [w.a, w.b]);
    const comp = matchingCrosses([w.a, w.b]).length;
    body = `<div class="items">${treeChip(w.a)}<span class="muted">×</span>${treeChip(w.b)}<span class="rarrow">→</span>${treeChip(s.node)}</div>
      <div class="small muted">${pct(Math.min(1, w.recipe.chance))} per roll${comp > 1 ? `, <span class="role">${comp} crosses compete</span>` : ""}, ${pct(eff, 1)} per honey delivery (about ${fmt(Math.ceil(1 / eff))} deliveries)</div>`;
  } else if (w.kind === "mutation") {
    body = `<div class="items">Grow ${treeChip(w.from)} saplings<span class="rarrow">→</span>${treeChip(s.node)}</div>
      <div class="small muted">${pct(w.chance)} of the grown trees mutate (about ${fmt(Math.ceil(1 / w.chance))} saplings)</div>`;
  } else {
    const l = node[s.node].loot;
    body = `<div class="items">Find ${treeChip(s.node)}</div><div class="small muted">${pct(l.chance)} in ${l.tables.map(lootName).join(", ")}</div>`;
  }
  const sz = node[s.node]?.sizes || [];
  if (sz.length && !sz.includes("1x1")) {
    const n = parseInt(sz[0], 10);
    body += `<div class="small role">Only grows from a ${sz[0].replace("x", "×")} square: you need ${n * n} saplings of it.</div>`;
  }
  return `<li>${body}${s.alternatives > 1 ? `<div class="small"><button class="chip" data-alt="${esc(s.node)}">Other way (${s.alternatives})</button></div>` : ""}</li>`;
}

function viewPlanner(el, params) {
  const saved = store.get("plan", { t: "cocoa", choice: {} });
  let target = params.get("t") && node[params.get("t")] ? params.get("t") : (node[saved.t] ? saved.t : db.trees[0].id);
  const choice = saved.t === target ? saved.choice || {} : {};
  el.innerHTML = `
    <p class="muted">Pick the tree you want. The plan starts from vanilla trees and lists every tree you need to breed first, oldest first. It uses the cheapest way for every tree, click "Other way" to switch.</p>
    <div style="max-width:420px" id="ptarget"></div>
    <div id="pout" style="margin-top:14px"></div>`;
  const draw = () => {
    store.set("plan", { t: target, choice });
    history.replaceState(null, "", `#/breeding?t=${encodeURIComponent(target)}`);
    const steps = planFor(target, choice);
    const bases = baseTreesOf(steps);
    const t = node[target];
    const ways = waysFor(target);
    $("#pout").innerHTML = `
      <div class="cols">
        <div class="card">
          <h3>${icon(t.sapling)} ${esc(t.name)}</h3>
          <dl class="kv">
            <dt>Generation</dt><dd>${tierOf(target) ?? ""}</dd>
            <dt>Steps</dt><dd>${steps.length}</dd>
            <dt>Start with</dt><dd><div class="items">${bases.map(b => treeChip(b)).join("") || '<span class="muted">nothing (loot or mutation only)</span>'}</div></dd>
          </dl>
          <p class="small" style="margin-bottom:0"><a href="#/tree/${esc(target)}">Tree page</a></p>
        </div>
        <div class="card">
          <h3>Ways to get it</h3>
          ${ways.map(w => wayHtml(target, w)).join("") || '<p class="bad">Not obtainable in this pack.</p>'}
        </div>
      </div>
      <h2>Plan</h2>
      ${steps.length ? `<ol class="steps">${steps.map(stepHtml).join("")}</ol>` : '<p class="muted">Nothing to breed.</p>'}
      <div class="note info">Chances per honey delivery assume only the two parent trees are in range of the hive (4 blocks, +2 per Range Upgrade). Every other leaf type nearby can add competing crosses. Pollen used by hand always works. <a href="#/guide?s=bees">Details</a></div>`;
    $$("[data-alt]", $("#pout")).forEach(b => b.addEventListener("click", () => {
      const n = b.dataset.alt;
      choice[n] = ((choice[n] ?? 0) + 1) % waysFor(n).length;
      draw();
    }));
  };
  picker($("#ptarget"), target, n => { target = n; for (const k in choice) delete choice[k]; draw(); },
    { nodes: db.trees.map(t => t.id), placeholder: "Pick a target tree" });
  draw();
}

// ---------- what can I breed ----------
function viewHave(el) {
  const have = new Set(store.get("have", Object.values(db.vanilla).map(v => v.id)));
  el.innerHTML = `
    <p class="muted">Mark the trees you already have. Vanilla trees are marked from the start. The list shows every cross you can do right now that gives a tree you do not have yet.</p>
    <div class="toolbar"><input class="grow" id="hq" type="search" placeholder="Filter trees"><button id="hreset">Reset to vanilla</button><button id="hall">Mark all</button></div>
    <div class="chips" id="hchips"></div>
    <h2>Crosses you can do now</h2>
    <div id="hout"></div>`;
  let q = "";
  const draw = () => {
    store.set("have", [...have]);
    const nodes = allNodes().filter(n => !q || nodeName(n).toLowerCase().includes(q));
    $("#hchips").innerHTML = nodes.map(n => `<button class="chip${have.has(n) ? " on" : ""}" data-n="${esc(n)}">${icon(node[n].sapling)}${esc(nodeName(n))}</button>`).join("");
    $$("#hchips button").forEach(b => b.addEventListener("click", () => { const n = b.dataset.n; have.has(n) ? have.delete(n) : have.add(n); draw(); }));
    const rows = [];
    for (const r of db.crosses) {
      if (have.has(r.result)) continue;
      const a = r.a.find(x => have.has(x)), b = r.b.find(x => have.has(x));
      if (a && b) rows.push({ r, a, b });
    }
    rows.sort((x, y) => y.r.chance - x.r.chance || nodeName(x.r.result).localeCompare(nodeName(y.r.result)));
    const missing = db.trees.filter(t => !have.has(t.id)).length;
    $("#hout").innerHTML = rows.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>New tree</th><th>Parents</th><th class="num">Chance</th><th class="num">Per delivery</th><th></th></tr></thead><tbody>
      ${rows.map(({ r, a, b }) => `<tr><td>${treeCell(r.result)}</td><td><div class="items">${treeChip(a)}<span class="muted">×</span>${treeChip(b)}</div></td>
        <td class="num">${pct(Math.min(1, r.chance))}</td><td class="num">${pct(perDelivery(r, [a, b]), 1)}</td>
        <td><button class="icon-btn" data-got="${esc(r.result)}" title="Mark as owned">Got it</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">${missing ? "No cross possible with these trees." : "You have every tree."}</p>`;
    $$("[data-got]").forEach(b => b.addEventListener("click", () => { have.add(b.dataset.got); draw(); }));
  };
  $("#hq").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); draw(); });
  $("#hreset").addEventListener("click", () => { have.clear(); Object.values(db.vanilla).forEach(v => have.add(v.id)); draw(); });
  $("#hall").addEventListener("click", () => { allNodes().forEach(n => have.add(n)); draw(); });
  draw();
}

// ---------- pair check ----------
function viewPair(el) {
  const saved = store.get("pair", { a: "minecraft:oak", b: "minecraft:birch", allergy: false });
  el.innerHTML = `
    <p class="muted">Pick the leaf types that are in range of your hive. Each honey delivery picks one of the matching crosses at random and then rolls its chance.</p>
    <div class="cols" style="max-width:860px"><div id="pa"></div><div id="pb"></div></div>
    <div class="toolbar"><label class="chk"><input type="checkbox" id="pallergy"${saved.allergy ? " checked" : ""}> Allergy Bee (5× chance)</label></div>
    <div id="pout"></div>`;
  const draw = () => {
    store.set("pair", saved);
    const nodes = [saved.a, saved.b].filter(Boolean);
    const list = matchingCrosses(nodes);
    $("#pout").innerHTML = list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Result</th><th class="num">Chance per roll</th><th class="num">Per honey delivery</th></tr></thead><tbody>
      ${list.map(r => `<tr><td>${treeCell(r.result)}</td><td class="num">${pct(Math.min(1, r.chance * (saved.allergy ? 5 : 1)))}</td><td class="num">${pct(perDelivery(r, nodes, saved.allergy), 1)}</td></tr>`).join("")}
      </tbody></table></div>
      ${list.length > 1 ? `<p class="small muted">${list.length} crosses match, so each one is picked in 1 of ${list.length} deliveries.</p>` : ""}
      <p class="small muted">Hand pollination: pollen of one of these trees used on a leaf of the other always gives one of the results above, picked at random.</p>`
      : `<p class="muted">These trees do not cross into anything. Hand pollination would just give a sapling of one of the two parents.</p>`;
  };
  picker($("#pa"), saved.a, n => { saved.a = n; draw(); });
  picker($("#pb"), saved.b, n => { saved.b = n; draw(); });
  $("#pallergy").addEventListener("change", e => { saved.allergy = e.target.checked; draw(); });
  draw();
}

const TABS = [["plan", "Planner"], ["have", "What can I breed?"], ["pair", "Pair check"]];

export function viewBreeding(app, params) {
  setNav("breeding");
  let tab = params.get("tab") || (params.get("t") ? "plan" : store.get("btab", "plan"));
  app.innerHTML = `
    <h1>Breeding</h1>
    <p class="muted">${db.crosses.length} crosses, read from the pack's pollination recipes. New trees come from pollinated leaves: bees near a hive or pollen used by hand.</p>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
    <div id="btab"></div>`;
  const show = () => {
    store.set("btab", tab);
    $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
    const el = $("#btab");
    if (tab === "have") viewHave(el);
    else if (tab === "pair") viewPair(el);
    else viewPlanner(el, params);
  };
  $$(".tabs button").forEach(b => b.addEventListener("click", () => {
    tab = b.dataset.tab;
    if (tab !== "plan") history.replaceState(null, "", "#/breeding");
    show();
  }));
  show();
}
