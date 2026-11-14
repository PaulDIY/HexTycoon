// Headless smoke test: run the simulation for a while with a scripted player.
import { newGame, S, C, tileAt } from '../js/state.js';
import { tick, computeStats } from '../js/sim.js';
import { zoneTile, buildRoad } from '../js/actions.js';
import { TICK, DAY } from '../js/config.js';

newGame(1234);
// zone along the starter road (row r=1): residential above (r=0/-1), others below
for (let q = -7; q <= 7; q++) { const t = tileAt(q, 4); if (t && t.terrain !== 'water') buildRoad(t, 1); }
for (let r = -3; r <= 6; r++) { const t = tileAt(-5, r); if (t && t.terrain !== 'water') buildRoad(t, 1); }
for (let q = -7; q <= 7; q++) {
  for (const [r, z] of [[0, 'res'], [2, 'res'], [-1, 'res'], [3, 'ind'], [5, 'agri']]) {
    const t = tileAt(q, r); if (t) zoneTile(t, z);
  }
}
// zone forestry / mining anywhere suitable within 7 tiles, with roads to reach them
let f = 0, m = 0;
for (const t of S.tiles) {
  const d = (Math.abs(t.q) + Math.abs(t.r) + Math.abs(t.q + t.r)) / 2;
  if (d > 7) continue;
  if (t.terrain === 'forest' && f < 3 && !t.b && !t.road) { if (zoneTile(t, 'forest').ok) f++; }
  if (t.terrain === 'hills' && m < 2 && !t.b && !t.road) { if (zoneTile(t, 'mine').ok) m++; }
}
import { hexLine } from '../js/hex.js';
for (const t of S.tiles) if (t.zone === 'mine' || t.zone === 'forest') {
  for (const [q, r] of hexLine(t.q, t.r, 0, 1).slice(1)) { const x = tileAt(q, r); if (x && !x.b && !x.road && x.terrain !== 'water') buildRoad(x, 1); }
}
import { roadNeighbors } from '../js/state.js';
let c = 0;
for (const t of S.tiles) if (c < 3 && !t.b && !t.road && roadNeighbors(t).length && t.zone === 'res' && t.r === 2) { zoneTile(t, 'com'); c++; }
console.log('zoned forest', f, 'mine', m, 'com', c);
const days = 150;
for (let i = 0; i < days * DAY / TICK; i++) {
  tick(TICK);
  if (i % Math.round(10 * DAY / TICK) === 0) {
    const s = computeStats();
    const hub = Object.values(S.buildings).find((b) => b.type === 'hub');
    console.log(`day ${Math.floor(S.time / DAY)} money ${S.money.toFixed(0)} pop ${s.pop} jobs ${s.jobs} sites ${s.sites} eco ${C.eco} hub ${JSON.stringify(hub.inv)} trucksBusy ${S.trucks.filter((t) => t.steps).length}`);
  }
}
const s = computeStats();
console.log('counts', JSON.stringify(s.count), 'goal', S.goal);
if (!(s.pop > 0)) { console.error('FAIL: no population'); process.exit(1); }

// ---------- balance systems ----------
import { placeCost, isCoastal } from '../js/actions.js';
import * as A from '../js/actions.js';
import { marketFactor } from '../js/sim.js';
import { createBuilding, serialize, deserialize } from '../js/state.js';
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

// harbor exports saturate the market, which recovers once shipping stops
{
  const t = S.tiles.find((x) => isCoastal(x) && !x.b && !x.road);
  const h = createBuilding('harbor', t.q, t.r, { built: true });
  h.exp = { g: 'furniture', amt: 25 }; h.inv = { furniture: 200 };
  // the harbor is the newest company, so give the city enough citizens to staff it
  const spare = S.tiles.filter((x) => !x.b && !x.road && x.terrain !== 'water' && x !== t).slice(0, 4);
  for (const ht of spare) { const home = createBuilding('house', ht.q, ht.r, { built: true }); home.level = 3; home.residents = 24; home.happy = 90; }
  const f0 = marketFactor('furniture');
  for (let i = 0; i < 3 * DAY / TICK; i++) tick(TICK);
  const f1 = marketFactor('furniture');
  expect(h.sold > 0, 'harbor sold nothing');
  expect(f0 === 1 && f1 < 0.9, `market factor should drop: ${f0} -> ${f1}`);
  h.exp.amt = 0;
  for (let i = 0; i < 5 * DAY / TICK; i++) tick(TICK);
  expect(marketFactor('furniture') > f1 + 0.1, `market should recover: ${f1} -> ${marketFactor('furniture')}`);
}

// companies need workers: with no citizens nothing is produced, staffing fills hubs and stores first
{
  newGame(5);
  const free = S.tiles.filter((x) => !x.b && !x.road && x.terrain !== 'water');
  const farm = createBuilding('farm_grain', free[0].q, free[0].r, { built: true });
  const store = createBuilding('store', free[1].q, free[1].r, { built: true });
  for (let i = 0; i < 2 * DAY / TICK; i++) tick(TICK);
  expect(farm.status === 'nostaff' && !(farm.inv.grain > 0), `unstaffed farm produced: ${farm.status} ${JSON.stringify(farm.inv)}`);
  const home = createBuilding('house', free[2].q, free[2].r, { built: true }); home.residents = 4; home.happy = 90;
  computeStats();
  const hub = Object.values(S.buildings).find((b) => b.type === 'hub');
  expect(hub.staff === 2 && store.staff === 2 && farm.staff === 0, `staff order hub ${hub.staff} store ${store.staff} farm ${farm.staff}`);
  expect(C.stats.workers === 4 && C.stats.vacant === 2, `workers ${C.stats.workers} vacant ${C.stats.vacant}`);
}

// player routes: a farm → bakery route moves grain; free trucks leave that link alone
{
  newGame(11);
  const hub = Object.values(S.buildings).find((b) => b.type === 'hub');
  const farm = createBuilding('farm_grain', -3, 2, { built: true });
  const bakery = createBuilding('bakery', 3, 2, { built: true });
  const stoneQ = createBuilding('quarry', -1, 2, { built: true });
  for (const t of [tileAt(-3, 2), tileAt(3, 2), tileAt(-1, 2)]) t.terrain = 'grass';
  farm.inv.grain = 12; stoneQ.inv.stone = 12;
  const { r } = A.createRoute(hub);
  expect(A.addStop(r, farm).ok && A.addStop(r, bakery).ok, 'stops not added');
  expect(r.stops[0].load.includes('grain') && r.stops[1].unload.includes('grain'), `default stop goods ${JSON.stringify(r.stops)}`);
  expect(!A.addStop(r, bakery).ok, 'same stop twice in a row should fail');
  expect(A.routeTruckDelta(r, 1).ok && A.routeTrucks(r).length === 1, 'truck not assigned');
  // depot rules: this hub only keeps wood, so the quarry's stone stays put
  A.setKeepMode(hub, true); hub.keep = { wood: 40 };
  const stone0 = hub.inv.stone || 0;
  for (let i = 0; i < 4 * DAY / TICK; i++) { farm.inv.grain = Math.max(farm.inv.grain || 0, 12); stoneQ.inv.stone = 12; tick(TICK); }
  // the bakery's grain can only have come by route: free trucks don't supply links a route covers
  expect((bakery.inv.grain || 0) >= 8, `route moved nothing: bakery ${JSON.stringify(bakery.inv)}`);
  expect((hub.inv.stone || 0) <= stone0, `hub took stone despite rules: ${stone0} -> ${hub.inv.stone}`);
  expect(!S.trucks.some((t) => !t.route && t.steps && t.steps.some((st) => st.from === farm.id)), 'free truck collects from a route stop');
  // demolishing a stop removes it from the route; deleting the route frees its truck
  A.demolish(tileAt(3, 2));
  expect(r.stops.length === 1, `stop not removed: ${r.stops.length}`);
  A.deleteRoute(r);
  expect(!S.routes.length && !S.trucks.some((t) => t.route), 'route not deleted');
  const j = JSON.parse(serialize()); delete j.routes; deserialize(JSON.stringify(j));
  expect(Array.isArray(S.routes), 'old save: routes missing');
}

// an old save without market data still loads
{
  const j = JSON.parse(serialize()); delete j.market;
  deserialize(JSON.stringify(j));
  expect(S.market && typeof S.market === 'object' && marketFactor('food') === 1, 'old save: market missing');
}

// hubs and parks get pricier with each one owned (linear)
{
  newGame(99);
  expect(placeCost('hub') === 300 && placeCost('park') === 60, `base costs ${placeCost('hub')} / ${placeCost('park')}`);
  const free = S.tiles.filter((x) => !x.b && !x.road && x.terrain !== 'water');
  createBuilding('hub', free[0].q, free[0].r);
  expect(placeCost('hub') === 450, `3rd hub should cost 450, got ${placeCost('hub')}`);
  for (let i = 1; i <= 10; i++) createBuilding('park', free[i].q, free[i].r);
  expect(placeCost('park') === 120, `11th park should cost 120, got ${placeCost('park')}`);
}

if (fails.length) { console.error('FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('OK');
import { access, activeHubs } from '../js/logistics.js';
if (process.env.DUMP) {
  const hub = activeHubs()[0];
  for (const b of Object.values(S.buildings)) console.log(b.type, b.q, b.r, 'built', b.built, 'site', JSON.stringify(b.site && b.site.need), JSON.stringify(b.site && b.site.got), 'inv', JSON.stringify(b.inv), 'res', JSON.stringify(b.resOut), b.status, 'acc', !!access(hub.id, b), b.residents ?? '', b.happy?.toFixed?.(0) ?? '');
  console.log('com tiles', S.tiles.filter(t => t.zone === 'com').map(t => [t.q, t.r, t.b, t.terrain]));
  console.log(JSON.stringify(C.stats));
}
