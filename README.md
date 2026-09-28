# Productive Trees Wiki (TNP Limitless 8)

Made by [Sonic1305](https://github.com/Sonic1305).

A small static guide for **Productive Trees**: every tree, a breeding planner that starts from vanilla trees, fruit and nuts with food values, the Sawmill and Stripper, and the Productive Bees hives.
Trees, crosses, recipes, loot and tags are read directly from the modpack's jar files, datapacks and KubeJS scripts, and the mechanics (pollination, pollen, sapling growth, fruit growth, machines) were checked against the mod's source code, so they match the versions on the server.

## Pages
- **Guide**: how cross-breeding works, your first new tree, bees and the hive range, pollen and hand pollination, the Allergy Bee, saplings and big trees (2×2 to 9×9), mutations, loot saplings, fruit growth, Sawmill and Stripper, hives and expansion boxes, crates and roasting, pack specifics and a FAQ.
- **Trees**: sortable table of all trees (fruit, generation, source, best chance, sapling layout, specials) and a page per tree with every way to get it, what it crosses into, fruit, wood and hive recipes.
- **Breeding**: a planner that lists every step from vanilla trees to any tree, "What can I breed?" for the trees you already have, and a pair check that shows the real chance per honey delivery when several crosses compete.
- **Produce**: every fruit, nut, spice, crate and other item with food values, where it comes from, its recipes and the recipes of other mods that use it.
- **Search** (top right): trees, items and guide sections.

## Updating the data (after mod updates)
Needs Python 3 with Pillow (`pip install pillow`).

```
git clone https://github.com/JDKDigital/productivetrees <src> && cd <src> && git checkout <commit of the jar's version>
python tools/extract.py "C:/Gameserver/TNP Limitless 8" "<path to the Minecraft 1.21.1 client jar>" --src <src>
```

The client jar supplies vanilla names, textures and tags (e.g. CurseForge: `curseforge/minecraft/Install/versions/1.21.1/1.21.1.jar`).
For Productive Trees 1.21.1-1.1.1 that is commit `ca29ad4` on the `dev-1.21.0` branch.
`--src` is only needed for the food values and the list of long-frond trees, which live in the mod's code. Without it the values from the last run are kept.
This rewrites `data/ptdata.json` and `icons/`. Delete `icons/i` first if you want all icons redrawn. Commit and push to publish.

## Local preview
```
python tools/serve.py 8769
```
then open http://localhost:8769.

Unofficial fan page. Productive Trees is by JDKDigital; textures and names are theirs and the respective mod authors'.
