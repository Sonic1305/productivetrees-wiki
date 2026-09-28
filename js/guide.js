// The guide: how Productive Trees works, checked against the mod's code and the pack's files.
import { $, esc, fmt } from "./util.js";
import { db, node, itemName, fruitMinutes, SAPLING_MINUTES, waysFor, matchingCrosses } from "./db.js";
import { icon, itemChip, treeChip, setNav, pct, minutes, recipeCard, cookCard, sawCard } from "./ui.js";
import { lootName, sizesText } from "./trees.js";

export const SECTIONS = [
  ["basics", "How it works"],
  ["start", "Your first new tree"],
  ["bees", "Breeding with bees"],
  ["pollen", "Pollen and hand pollination"],
  ["allergy", "Allergy Bee"],
  ["saplings", "Saplings and big trees"],
  ["mutations", "Mutations"],
  ["loot", "Loot saplings"],
  ["fruit", "Fruit"],
  ["wood", "Wood, Sawmill and Stripper"],
  ["hives", "Hives and Expansion Boxes"],
  ["crates", "Crates and roasting"],
  ["pack", "In this pack"],
  ["faq", "FAQ"],
];

const R = id => (db.crafting[id] ? recipeCard(id) : "");

export function viewGuide(app, params) {
  setNav("guide");
  const cfg = db.config;
  const sieve = cfg["General.pollenChanceFromSieve"] ?? 2;
  const lootTrees = db.trees.filter(t => t.loot);
  const mutTrees = db.trees.filter(t => t.mutation);
  const noWay = db.trees.filter(t => !waysFor(t.id).length);
  const fruitTrees = db.trees.filter(t => t.fruit);
  const speeds = [...new Set(fruitTrees.map(t => t.fruit.growthSpeed))].sort((a, b) => b - a);
  const vanillaParents = Object.values(db.vanilla).filter(v => db.crossesFrom[v.id]);
  const firstCrosses = db.crosses.filter(r => r.a.every(x => x.startsWith("minecraft:")) && r.b.every(x => x.startsWith("minecraft:")));
  const saw = Object.values(db.sawmill).find(r => r.input.label === "#minecraft:oak_logs") || Object.values(db.sawmill)[0];
  const fustic = Object.values(db.sawmill).find(r => r.tertiary);
  const crateEx = Object.keys(db.crafting).find(k => k.endsWith("crates/almond_crate"));
  const unpackEx = Object.keys(db.crafting).find(k => k.includes("almond") && k.includes("unpack"));
  const hiveEx = Object.keys(db.crafting).find(k => db.crafting[k].result === "productivetrees:advanced_alder_beehive");
  const boxEx = Object.keys(db.crafting).find(k => db.crafting[k].result === "productivetrees:expansion_box_alder");
  const roastEx = db.items["productivetrees:roasted_almond"] ? cookCard("productivetrees:roasted_almond") : "";
  const hasBees = db.mods.includes("productivebees");
  const removedPT = (db.removedRecipes || []).filter(r => r.startsWith("productivetrees:"));

  app.innerHTML = `
    <h1>Guide</h1>
    <p class="muted">How Productive Trees works in TNP Limitless 8. Numbers come from the mod's code (version ${esc(db.versions.productivetrees || "")}) and the pack's files.</p>
    <nav class="toc">${SECTIONS.map(([id, t]) => `<a href="#/guide?s=${id}">${esc(t)}</a>`).join("")}</nav>

    <section id="g-basics"><h2>How it works</h2>
      <p>Productive Trees adds ${db.trees.length} trees: real ones from all over the world and a few magic ones. None of them grow in the world on their own. You get them by <b>cross-breeding</b>: when two kinds of leaves are close to a bee hive, bees pollinate a leaf. That leaf turns into a <b>pollinated leaf</b>, and when you break it, it drops the sapling of a new tree.</p>
      <p>Every new tree starts from the vanilla trees: ${vanillaParents.map(v => treeChip(v.id)).join(" ")}. The first crosses only need vanilla leaves, later ones need the trees you bred before. The <a href="#/breeding">Breeding planner</a> lists every step for any tree.</p>
      <p>${fruitTrees.length} trees grow fruit, nuts or spices that you pick from the leaves. Every tree also has its own logs, planks and wood blocks${hasBees ? ", plus an Advanced Beehive and Expansion Box from Productive Bees" : ""}.</p>
    </section>

    <section id="g-start"><h2>Your first new tree</h2>
      <ol class="steps">
        <li>Place a bee nest or beehive with bees in it. A vanilla bee nest works. The bees need flowers nearby to collect nectar.</li>
        <li>Grow two vanilla trees whose leaves cross, for example ${firstCrosses.slice(0, 1).map(r => `${treeChip(r.a[0])} and ${treeChip(r.b[0])} (gives ${treeChip(r.result)})`).join("")}. Their leaves must be within <b>4 blocks</b> of the hive (a 9×9×9 cube around it).</li>
        <li>Wait. Every time a bee comes home with nectar, the mod tries to pollinate one of the leaves nearby.</li>
        <li>Look for pollinated leaves: they have the mixed color of both parents. Hold a <b>Spyglass</b> in your hand and they show green sparkles.</li>
        <li>Break the pollinated leaf with anything. It always drops the new sapling.</li>
      </ol>
      <p>${firstCrosses.length} crosses only need vanilla trees, for example ${firstCrosses.slice(1, 6).map(r => treeChip(r.result)).join(" ")}.</p>
    </section>

    <section id="g-bees"><h2>Breeding with bees</h2>
      <p>What happens each time a bee delivers nectar to a hive:</p>
      <ol class="steps">
        <li>The mod looks at every block in a cube around the hive: 4 blocks in each direction, plus 2 per Range Upgrade in a Productive Bees Advanced Beehive.</li>
        <li>It collects all leaf types in there (any block in <code>#minecraft:leaves</code>, plus Nether and Warped Wart Blocks). Fruit-bearing leaves and leaves that are already pollinated do not count.</li>
        <li>It finds every cross whose two parents are both among those leaf types, and <b>picks one of them at random</b>.</li>
        <li>It rolls that cross's chance (most are 10%, some 5%, a few higher). On success one leaf of the two parents turns into a pollinated leaf that holds the new sapling.</li>
      </ol>
      <div class="note"><b>Keep other leaves away.</b> If the hive sees leaves of more tree types, more crosses can match, and each delivery then goes to one of them at random. Oak and Birch, for example, match ${matchingCrosses(["minecraft:oak", "minecraft:birch"]).length} crosses at once. The planner and the pair check show the real chance per delivery.</div>
      <p>Pollinated leaves never decay, even without a log nearby, and are drawn in the mixed color of both parents. Breaking one drops its sapling.</p>
    </section>

    <section id="g-pollen"><h2>Pollen and hand pollination</h2>
      <p>${itemChip("productivetrees:pollen")} carries the leaf type it came from. Right-click any leaf with it: the leaf becomes a pollinated leaf <b>every time</b>, no chance roll. If the two leaf types have a cross, the sapling is one of their results. If not, you get a sapling of one of the two parents.</p>
      ${hasBees ? `<p>In this pack pollen comes from the <b>Pollen Sieve Upgrade</b> in a Productive Bees Advanced Beehive. Each nectar delivery with leaves in range has a <b>${sieve}%</b> chance (${sieve * 5}% for an Allergy Bee) to put one pollen of a random leaf type in range into the hive. More than one sieve does not help.</p>
      <div class="rcards">${R("productivetrees:pollen_sieve")}</div>
      <div class="note">The Pollen Sifter (a machine that turns leaves into pollen) is switched off by the mod when Productive Bees is installed, so it cannot be crafted here.</div>` : ""}
    </section>

    <section id="g-allergy"><h2>Allergy Bee</h2>
      ${hasBees ? `<p>The Allergy Bee is a Productive Bees bee added by Productive Trees. Use ${itemChip("productivetrees:pollen")} on a normal bee: 10% chance to turn it into an Allergy Bee.</p>
      <ul>
        <li>Pollination chance is <b>5×</b> higher (a 10% cross becomes 50%).</li>
        <li>Pollen chance from the sieve is also 5× higher.</li>
        <li>It uses <b>leaves as flowers</b>, so it needs no flowers near the trees.</li>
        <li>It makes no honeycomb.</li>
      </ul>` : `<p class="muted">Needs Productive Bees.</p>`}
    </section>

    <section id="g-saplings"><h2>Saplings and big trees</h2>
      <ul>
        <li>Saplings grow on dirt blocks (grass, podzol, moss, mud and so on) and farmland. They grow like vanilla saplings (1 in 7 random ticks, two steps), about ${minutes(SAPLING_MINUTES)} on average. Unlike vanilla saplings they do not check the light level.</li>
        <li>Bone meal works (45% per use, like vanilla).</li>
        <li>The sapling tooltip shows its layouts. Some trees also grow big from a <b>square of saplings</b>: 2×2, 3×3 or 5×5, and a few even 9×9. Plant the full square of the same sapling and use bone meal on any of them.</li>
        <li>${db.trees.filter(t => !t.sizes.includes("1x1")).length} trees only grow from a square, a single sapling of them never grows: ${db.trees.filter(t => !t.sizes.includes("1x1")).map(t => treeChip(t.id, ` <span class="muted small">${esc(sizesText(t))}</span>`)).join(" ")}</li>
        <li>Leaves drop their sapling like oak leaves: 5% (10% with Fortune III). Shears or Silk Touch give the leaf block.</li>
      </ul>
    </section>

    <section id="g-mutations"><h2>Mutations</h2>
      <p>${mutTrees.length} trees can mutate. When their sapling grows, there is a small chance it grows into a different tree instead. That is the only way to get these color variants:</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Plant</th><th>Can grow into</th><th class="num">Chance</th></tr></thead><tbody>
        ${mutTrees.map(t => `<tr><td>${treeChip(t.id)}</td><td>${treeChip(t.mutation.target)}</td><td class="num">${pct(t.mutation.chance)}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="small muted">Plant many saplings and chop the normal trees. With bone meal it goes fast.</p>
    </section>

    <section id="g-loot"><h2>Loot saplings</h2>
      <p>${lootTrees.length} magic trees cannot be bred. Their saplings are found in structure loot:</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Sapling</th><th>Where</th><th class="num">Chance</th></tr></thead><tbody>
        ${lootTrees.map(t => `<tr><td>${treeChip(t.id)}</td><td>${t.loot.tables.map(x => esc(lootName(x))).join(", ")}</td><td class="num">${pct(t.loot.chance)}</td></tr>`).join("")}
      </tbody></table></div>
      ${noWay.length ? `<div class="note">${noWay.map(t => treeChip(t.id)).join(" ")} ${noWay.length > 1 ? "have" : "has"} no cross, mutation or loot source in this pack, so ${noWay.length > 1 ? "they are" : "it is"} creative only.</div>` : ""}
    </section>

    <section id="g-fruit"><h2>Fruit</h2>
      <p>Fruit trees grow some leaves as <b>fruit leaves</b>. These ripen in 7 stages. A ripe fruit leaf shows its fruit.</p>
      <ul>
        <li><b>Right-click</b> a ripe fruit leaf to pick the fruit (${Math.min(...fruitTrees.map(t => t.fruit.count))} to ${Math.max(...fruitTrees.map(t => t.fruit.count))} at once, depending on the tree). The leaf stays and starts over.</li>
        <li>Breaking a ripe fruit leaf drops 1 fruit, so picking is better.</li>
        <li><b>Bone meal</b> on a fruit leaf adds one stage per use, always.</li>
        <li>Fruit only grows when the light level at the leaf is 9 or more.</li>
        <li>Each random tick a fruit leaf grows one stage with a chance of 1 in (25 ÷ growth speed + 1). That is slow: the average time for one fruit leaf to ripen, at the default random tick speed:
          <div class="table-wrap" style="margin-top:6px;max-width:520px"><table class="data"><thead><tr><th class="num">Growth speed</th><th class="num">Average ripening</th><th class="num">Trees</th></tr></thead><tbody>
            ${speeds.map(s => `<tr><td class="num">${fmt(s)}</td><td class="num">${minutes(fruitMinutes(s))}</td><td class="num">${fruitTrees.filter(t => t.fruit.growthSpeed === s).length}</td></tr>`).join("")}
          </tbody></table></div>
        </li>
        <li>Special fruit: ripe ${treeChip("coconut")} coconuts fall down as Coconut Sprouts (they hurt when they land on you). ${treeChip("brown_amber")} drips amber puddles instead of being picked.</li>
      </ul>
      <p>A grown tree has many fruit leaves, so plant several trees and pick them all in one round. See <a href="#/produce">Produce</a> for what each fruit is good for.</p>
    </section>

    <section id="g-wood"><h2>Wood, Sawmill and Stripper</h2>
      <p>Every tree has logs, wood, stripped logs, planks and (in this pack) stairs, slabs, fences, doors, trapdoors, buttons, pressure plates, signs, hanging signs and bookshelves. Planks craft as usual (1 log to 4 planks).</p>
      <p><b>Sawmill</b>: turns a log into 6 planks and 2 ${itemChip("productivetrees:sawdust")}. It takes 10 s per log. Time Upgrades speed it up (each upgrade +1×, Time Upgrade II +2×, 4 upgrade slots). Some woods give an extra dye material.</p>
      <div class="rcards">${R("productivetrees:sawmill")}${saw ? sawCard(saw, `Sawmill: ${itemName(saw.input.items[0])}`) : ""}${fustic ? sawCard(fustic, `Sawmill: ${itemName(fustic.input.items[0])}`) : ""}</div>
      <p><b>Stripper</b>: strips logs and wood. Put an axe in its axe slot. It strips 1 log every 0.5 s, or 4 per Time Upgrade and 8 per Time Upgrade II. Each operation costs the axe that much durability. ${db.trees.filter(t => t.stripDrop).map(t => treeChip(t.id)).join(" ")} drop ${db.trees.filter(t => t.stripDrop).map(t => itemName(t.stripDrop)).join(", ")} when stripped, by hand or in the Stripper.</p>
      <div class="rcards">${R("productivetrees:stripper")}</div>
      ${Object.keys(db.sawing).length ? `<p>Mekanism's Precision Sawmill also cuts every Productive Trees log into 6 planks.</p>` : ""}
      <p>Sawdust makes paper:</p>
      <div class="rcards">${R("productivetrees:sawdust_to_paper")}${R("productivetrees:sawdust_to_paper_water_bottle")}</div>
    </section>

    <section id="g-hives"><h2>Hives and Expansion Boxes</h2>
      ${hasBees ? `<p>With Productive Bees installed, every tree adds an <b>Advanced Beehive</b> and an <b>Expansion Box</b> in its own wood. They work exactly like the Productive Bees ones, only the look is different.</p>
      <div class="rcards">${hiveEx ? recipeCard(hiveEx) : ""}${boxEx ? recipeCard(boxEx) : ""}</div>
      <p>An Advanced Beehive is the best hive for tree breeding: Range Upgrades make the area bigger (+2 blocks each) and the Pollen Sieve Upgrade collects pollen. The in-game book says it also works with a simulated hive.</p>` : ""}
    </section>

    <section id="g-crates"><h2>Crates and roasting</h2>
      <p>Most fruits, nuts and spices pack into crates (9 to 1) for storage, and unpack again.</p>
      <div class="rcards">${crateEx ? recipeCard(crateEx) : ""}${unpackEx ? recipeCard(unpackEx) : ""}</div>
      <p>Nuts and coffee beans can be roasted in a furnace or smoker. Roasted nuts restore more saturation. Whole crates can be roasted too (9 times the time).</p>
      <div class="rcards">${roastEx}</div>
    </section>

    <section id="g-pack"><h2>In this pack</h2>
      <ul>
        ${!db.mods.includes("treetap") ? `<li class="note">Tree Tap is <b>not installed</b>. So Maple Sap, Maple Syrup, Date Palm Juice, Dracaena Sap, Sandalwood Oil and Rubber (and Cured Rubber) cannot be made.</li>` : ""}
        ${hasBees ? `<li>Productive Bees is installed: pollen comes from the Pollen Sieve Upgrade, the Pollen Sifter is disabled, and every tree has a hive and an expansion box.</li>` : ""}
        ${removedPT.length ? `<li>Removed by the pack (KubeJS): ${removedPT.map(r => `<code>${esc(r)}</code>`).join(", ")}. The Red Delicious Apple Crate is also hidden from JEI/EMI.</li>` : ""}
        ${(db.replacedInputs || []).length ? `<li>Juniper Berries from Productive Trees and from Cocktails Delight are the same in recipes: both are in <code>#c:berries/juniperberry</code>, and recipes that asked for one of them take either (not the crates).</li>` : ""}
        <li>${itemChip("productivetrees:cured_rubber")} is added to <code>#c:rubbers</code>, but it has no source here (see Tree Tap above).</li>
        <li>The Farming for Blockheads market is disabled in this pack. (Productive Trees saplings were not sold there by default anyway.)</li>
        <li>Config: pollen chance from the sieve ${sieve}% (default 2), minimal mode ${cfg["General.minimal"] ? "on" : "off"} (all wood blocks exist).</li>
      </ul>
    </section>

    <section id="g-faq"><h2>FAQ</h2>
      <dl class="faq">
        <dt>My bees do nothing.</dt>
        <dd>Bees only try when they come home with nectar, so they need flowers (the Allergy Bee uses leaves). Both parent leaves must be within 4 blocks of the hive. Check that no fruit leaves are the only leaves of a parent in range, fruit leaves do not count.</dd>
        <dt>I get the wrong trees.</dt>
        <dd>Other leaves near the hive add more crosses. Remove every tree that is not a parent, or check the <a href="#/breeding?tab=pair">pair check</a>.</dd>
        <dt>How do I find the pollinated leaf?</dt>
        <dd>It has the mixed color of both parents. With a Spyglass in either hand it shows green particles.</dd>
        <dt>My big tree sapling does not grow.</dt>
        <dd>Some trees only grow from a full 2×2, 3×3 or 5×5 square of the same sapling, and need room to grow. The sapling tooltip and the tree page show the layouts.</dd>
        <dt>Can I get these trees in other ways?</dt>
        <dd>No tree spawns in the world. Only breeding, mutation and the loot saplings listed above.</dd>
        <dt>Why are some items marked "No source"?</dt>
        <dd>Their recipes need a mod that is not in the pack, mostly Tree Tap.</dd>
      </dl>
    </section>`;

  const s = params.get("s");
  if (s) {
    const el = $(`#g-${CSS.escape(s)}`);
    if (el) requestAnimationFrame(() => el.scrollIntoView());
  }
}
