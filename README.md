# Hexaverde: Eco City Tycoon

Hexaverde is a browser tycoon game about building a sustainable city economy on a hex map. It's built mobile-first, uses no libraries and has no build step.

You zone land, connect it with roads and Storage Hubs, and run the truck fleet that moves every good. Citizens buy what they need at stores and pay taxes. Industry and trucks pollute, while forests, parks and level-3 eco upgrades clean the air.

## Run it

```bash
npm start          # node server.js → http://localhost:8080 (also prints a LAN URL for your phone)
```

ES modules need an HTTP server, so opening `index.html` straight from disk won't work. Any static server will do.

```bash
npm test                 # headless economy smoke test
node test/bot.test.js    # 400-day balance run with a bot player (env: SEED, DAYS)
```

## How to play

| Step | What to do |
|---|---|
| 1. Zone | **Zones** menu: paint Residential, Commercial, Farmland, Forestry (forest), Mining (hills = stone, sand = clay) and Industry. Companies only move in on tiles **next to a road that reaches a Storage Hub**, and only when there's demand (the R/C/I bars at the top). |
| 2. Build | New buildings and upgrades are **construction sites**. Trucks deliver wood, stone, planks or bricks from a hub. |
| 3. Logistics | Trucks collect output from producers, supply factories and stores, and deliver **directly** from producer to consumer when that's shorter. On a hub you can buy or sell trucks and set a priority (Balanced / Construction / Supply / Collection). |
| 4. Grow | Citizens need food, then clothes (level 2), then furniture (level 3), all bought at stores within walking range. Happy citizens pay more tax. Companies pay tax on what they produce. |
| 5. Upgrade | Everything has **3 levels**: houses, stores, farms, mines, factories, hubs (and their trucks), parks and roads. Level 2 unlocks at 40 citizens, level 3 at 200. |
| 6. Stay green | The ☁️ button shows the pollution overlay. Parks and forests absorb pollution. Level-3 buildings and E-Trucks are close to emission-free. |

**Controls.** On touch: with the Select tool, one finger pans. With zone, road or remove tools, one finger paints. Two fingers pan, pinch-zoom and rotate. On desktop: right-drag pans, the wheel zooms, Q/E rotates, WASD/arrows pan, Space pauses and Esc cancels.

## Production chains

```
Grain Field ─┐                 Vegetable Patch → Cannery ─┐
             └→ Bakery → Food ───────────────────────────┴→ Stores → Citizens
Lumber Camp → Wood → Sawmill → Planks → Carpentry → Furniture ─→ Stores
Quarry → Stone          Clay Pit → Clay → Brickworks → Bricks
Cotton Field → Cotton → Textile Mill → Clothes ─→ Stores
Wood / Stone / Planks / Bricks → construction sites (via trucks)
```

## Code map

| File | Role |
|---|---|
| `js/config.js` | Data for terrain, goods, zones, all buildings with 3 levels, roads, trucks, goals. Balance lives here. |
| `js/state.js` | Saved game state `S`, derived caches `C`, map generation (value noise) and building/truck creation |
| `js/sim.js` | Economy tick: construction, production, citizens and stores, taxes, zone growth, pollution and eco score, goals |
| `js/logistics.js` | Per-hub Dijkstra distance fields over roads, A* for direct trips, job scoring and dispatch, reservations, truck movement |
| `js/actions.js` | Validated player actions: zone, road, place, upgrade, demolish, trucks |
| `js/stack.js` | Sprite-stacking rasteriser: shapes are sliced and stacked per camera angle, with an LRU cache per (model, angle, resolution) |
| `js/models.js` | Procedural sprite-stack models for every building and level, plus trees, hills and trucks |
| `js/render.js` | Camera (pan/zoom/rotate), batched affine ground pass, depth-sorted sprites, overlays, smoke, status icons |
| `js/input.js` | Pointer, touch and keyboard handling |
| `js/ui.js`, `js/inspector.js` | Left build menu and flyouts, HUD, toasts, modals, and the bottom-sheet property inspector (tap its header to minimise) |
| `js/main.js` | Boot, fixed-step game loop, autosave (localStorage) |

The simulation modules have no DOM access, so they run under Node for tests.

## Roadmap: power grid

The **Eco** menu already has *Solar Farm* and *Power Line* entries marked "coming soon". Suggested design:

- Add `power: [..]` demand per level to `BUILDINGS` entries, and power producers (solar, wind, biomass) as new `kind: 'power'` buildings.
- Power lines as a tile layer like `t.road`. Build connected components (BFS) in a cache that is rebuilt only when lines change.
- In `sim.js`, scale `efficiency(b)` by the supply/demand ratio of the building's grid component. Show it in the inspector and as an overlay.
