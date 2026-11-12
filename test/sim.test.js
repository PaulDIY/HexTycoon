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
import { marketFactor } from '../js/sim.js';
import { createBuilding, serialize, deserialize } from '../js/state.js';
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

// harbor exports saturate the market, which recovers once shipping stops
{
  const t = S.tiles.find((x) => isCoastal(x) && !x.b && !x.road);
  const h = createBuilding('harbor', t.q, t.r, { built: true });
  h.exp = { g: 'furniture', amt: 25 }; h.inv = { furniture: 200 };
  const f0 = marketFactor('furniture');
  for (let i = 0; i < 3 * DAY / TICK; i++) tick(TICK);
  const f1 = marketFactor('furniture');
  expect(h.sold > 0, 'harbor sold nothing');
  expect(f0 === 1 && f1 < 0.9, `market factor should drop: ${f0} -> ${f1}`);
  h.exp.amt = 0;
  for (let i = 0; i < 5 * DAY / TICK; i++) tick(TICK);
  expect(marketFactor('furniture') > f1 + 0.1, `market should recover: ${f1} -> ${marketFactor('furniture')}`);
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
