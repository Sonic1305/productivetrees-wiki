import { $, $$, esc } from "./util.js";
import { db, node, loadDb, itemName, waysFor, fruitMinutes } from "./db.js";
import { icon, treeChip, setNav, pct, minutes } from "./ui.js";
import { viewGuide, SECTIONS } from "./guide.js";
import { viewTrees, viewTree } from "./trees.js";
import { viewBreeding } from "./breeding.js";
import { viewItems, viewItem, modItems } from "./items.js";

const app = $("#app");

// ---------- home ----------
function viewHome() {
  setNav("");
  const fruit = db.trees.filter(t => t.fruit).length;
  const bred = db.trees.filter(t => waysFor(t.id)[0]?.kind === "cross").length;
  const maxGen = Math.max(...db.trees.map(t => db.tier[t.id] ?? 0));
  const tiles = [
    ["#/guide", "Guide", "Breeding with bees and pollen, saplings and big trees, fruit, Sawmill and Stripper, and what this pack changes."],
    ["#/trees", "Trees", `All ${db.trees.length} trees, how to get each one, its fruit, sapling layouts and what it crosses into.`],
    ["#/breeding", "Breeding planner", `Pick any tree and get every step from vanilla trees. ${db.crosses.length} crosses, up to ${maxGen} generations deep.`],
    ["#/produce", "Produce", `${modItems().length} items: fruit, nuts, spices, crates and machines, with food values and the recipes of other mods that use them.`],
  ];
  const fastest = db.trees.filter(t => t.fruit).sort((a, b) => b.fruit.growthSpeed - a.fruit.growthSpeed)[0];
  app.innerHTML = `
    <h1>Productive Trees Wiki</h1>
    <p class="muted">A guide to Productive Trees, read straight from the modpack's files and the mod's code, so the numbers match the game.</p>
    <div class="grid" style="margin-top:18px">
      ${tiles.map(([href, t, d]) => `<a class="card" href="${href}"><h3>${esc(t)}</h3><p class="muted">${esc(d)}</p></a>`).join("")}
    </div>
    <h2>How Productive Trees works (short version)</h2>
    <div class="cols">
      <div class="card">
        <ol style="margin:0;padding-left:20px">
          <li>Put a bee nest or hive next to two different trees. Their leaves must be within 4 blocks of the hive.</li>
          <li>When bees come home with nectar, they sometimes pollinate a leaf. Break it to get the sapling of a new tree.</li>
          <li>Use the new trees as parents for the next cross. ${bred} trees are bred this way, starting from vanilla trees.</li>
          <li>Pick fruit from ripe fruit leaves with right-click, and cut the wood in the Sawmill.</li>
        </ol>
        <p style="margin-bottom:0"><a class="btn" href="#/guide">Read the full guide</a></p>
      </div>
      <div class="card">
        <div class="items" style="margin-bottom:10px">${["cacao", "banana", "coconut", "almond", "sugar_maple", "sequoia"].filter(n => node[n]).map(n => treeChip(n)).join("")}</div>
        <dl class="kv">
          <dt>Trees</dt><dd>${db.trees.length}, ${fruit} of them with fruit, nuts or spices</dd>
          <dt>Watch out</dt><dd>Other leaves near the hive steal attempts. <a href="#/guide?s=bees">Why</a></dd>
          <dt>Fruit</dt><dd>Slow: a fruit leaf needs about ${minutes(fruitMinutes(fastest?.fruit.growthSpeed || 1))} at best. Bone meal adds a stage</dd>
          <dt>Version</dt><dd>Productive Trees ${esc(db.versions.productivetrees || "")}</dd>
        </dl>
      </div>
    </div>`;
}

function notFound() {
  app.innerHTML = `<h1>Not found</h1><p><a href="#/">Back to start</a></p>`;
}

// ---------- global search ----------
function setupSearch() {
  const input = $("#global-search");
  const box = $("#search-results");
  let idx = [];
  const build = () => {
    idx = [
      ...db.trees.map(t => ({ kind: "tree", name: t.name, href: `#/tree/${t.id}`, icon: icon(t.sapling), extra: `${t.latin || ""} ${t.id}` })),
      ...modItems().map(id => ({ kind: "item", name: itemName(id), href: `#/item/${id.split(":")[1]}`, icon: icon(id), extra: id })),
      ...SECTIONS.map(([id, t]) => ({ kind: "guide", name: t, href: `#/guide?s=${id}`, icon: "", extra: "" })),
      { kind: "page", name: "Breeding planner", href: "#/breeding?tab=plan", icon: "", extra: "breed cross pollinate" },
      { kind: "page", name: "What can I breed?", href: "#/breeding?tab=have", icon: "", extra: "breed cross" },
      { kind: "page", name: "Pair check", href: "#/breeding?tab=pair", icon: "", extra: "breed cross" },
    ];
  };
  let sel = 0;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const res = idx.map(e => {
      const n = e.name.toLowerCase();
      const score = n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : e.extra.toLowerCase().includes(q) ? 3 : 9;
      return [score, e];
    }).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 14).map(x => x[1]);
    sel = Math.min(sel, Math.max(res.length - 1, 0));
    box.innerHTML = res.length ? res.map((e, i) => `<a href="${esc(e.href)}" class="${i === sel ? "sel" : ""}">${e.icon}<span>${esc(e.name)}</span><span class="kind">${esc(e.kind)}</span></a>`).join("") : '<div class="muted" style="padding:8px 10px">No results</div>';
    box.hidden = false;
  };
  input.addEventListener("focus", () => { if (!idx.length) build(); render(); });
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", e => {
    const links = $$("a", box);
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, links.length - 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === "Enter" && links[sel]) { go(links[sel].getAttribute("href")); }
    else if (e.key === "Escape") { input.blur(); box.hidden = true; }
  });
  const go = href => {
    input.blur(); box.hidden = true; input.value = "";
    if (location.hash === href) route(); else location.hash = href;
  };
  document.addEventListener("click", e => { if (!e.target.closest(".search-wrap")) box.hidden = true; });
  box.addEventListener("click", e => {
    const a = e.target.closest("a");
    if (a) { e.preventDefault(); go(a.getAttribute("href")); }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

// ---------- router ----------
function route() {
  const hash = location.hash.slice(1) || "/";
  const [path, query] = hash.split("?");
  const params = new URLSearchParams(query || "");
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "guide" && params.get("s"))) window.scrollTo(0, 0);
  switch (seg[0]) {
    case undefined: return viewHome();
    case "guide": return viewGuide(app, params);
    case "trees": return viewTrees(app);
    case "tree": return viewTree(app, seg[1]);
    case "breeding": return viewBreeding(app, params);
    case "produce": return viewItems(app);
    case "item": return viewItem(app, seg[1]);
    default: return notFound();
  }
}

async function main() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  try {
    await loadDb();
  } catch (e) {
    app.innerHTML = `<h1>Could not load data</h1><p class="muted">${esc(e.message)}</p><p>If you opened the file directly, serve the folder over HTTP (e.g. <code>python tools/serve.py</code>).</p>`;
    return;
  }
  $("#foot").innerHTML = `Made by <a href="https://github.com/Sonic1305">Sonic1305</a> for TNP Limitless 8. See <a href="https://sonic1305.github.io/">all guides</a> or <a id="feedback-link" href="https://sonic1305.github.io/#/feedback?guide=productivetrees-wiki">send feedback</a>.<br>
    <span class="small">Data generated ${esc(db.generated)} from the modpack (Productive Trees ${esc(db.versions.productivetrees || "")}, Productive Bees ${esc(db.versions.productivebees || "")}, Minecraft ${esc(db.versions.minecraft || "1.21.1")}). Unofficial fan page, Productive Trees by JDKDigital.</span>`;
  $("#feedback-link").addEventListener("click", e => {
    e.currentTarget.href = `https://sonic1305.github.io/#/feedback?guide=productivetrees-wiki&page=${encodeURIComponent(location.href)}`;
  });
  setupSearch();
  window.addEventListener("hashchange", route);
  route();
}

main();
