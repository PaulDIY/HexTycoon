// Long-run balance test: a simple bot player grows a city on a road grid.
// Usage: node test/bot.test.js   (env: SEED, DAYS)
import { newGame, S, C, roadNeighbors } from '../js/state.js';
import { tick, computeStats } from '../js/sim.js';
import * as A from '../js/actions.js';
import { TICK, DAY } from '../js/config.js';
import { hexDist } from '../js/hex.js';

newGame(+process.env.SEED || 4242);
const days = +process.env.DAYS || 400;
const hd = (t) => hexDist(0, 0, t.q, t.r);
// road grid: every third row plus a few columns
function roads(radius) {
  for (const t of S.tiles) {
    if (hd(t) > radius || t.terrain === 'water' || t.b) continue;
    const col = t.q + Math.floor(t.r / 2);
    if (((t.r % 3) + 3) % 3 === 1 || col === 3 || col === -6 || col === 10 || col === -13) A.buildRoad(t, 1);
  }
}
function zone(radius) {
  for (const t of S.tiles) {
    if (hd(t) > radius || t.b || t.road || t.zone || !roadNeighbors(t).length) continue;
    let z;
    if (t.terrain === 'forest') z = 'forest';
    else if (t.terrain === 'hills' || t.terrain === 'sand') z = 'mine';
    else if (t.terrain === 'fertile') z = 'agri';
    else { const k = ((t.q * 7 + t.r * 3) % 10 + 10) % 10; z = k < 5 ? 'res' : k < 6 ? 'com' : k < 8 ? 'ind' : 'agri'; }
    A.zoneTile(t, z);
  }
}
let radius = 5;
roads(radius); zone(radius);
for (let d = 0; d < days; d++) {
  for (let i = 0; i < DAY / TICK; i++) tick(TICK);
  const st = computeStats();
  const hubs = Object.values(S.buildings).filter((b) => b.type === 'hub' && b.built);
  if (d % 2 === 0) {
    for (const h of hubs) { if (S.money > 600) A.buyTruck(h); if (S.money > 1500) A.upgrade(h); }
    for (const b of Object.values(S.buildings)) if (b.built && !b.site && S.money > 1200 && b.type !== 'hub') A.upgrade(b);
    const free = S.tiles.filter((t) => t.zone === 'res' && !t.b && roadNeighbors(t).length).length;
    if (free < 3 && radius < 14 && S.money > 300) { radius++; roads(radius); zone(radius); }
    if (st.pop > 60 * hubs.length && S.money > 800) {
      const t = S.tiles.find((x) => hd(x) === radius - 1 && !x.b && !x.road && x.terrain !== 'water' && roadNeighbors(x).length);
      if (t) A.place('hub', t);
    }
    if (C.eco < 55 && S.money > 400) { const t = S.tiles.find((x) => x.zone === 'res' && !x.b); if (t) { t.zone = null; A.place('park', t); } }
  }
  if (d % 25 === 0 || d === days - 1) {
    const lv = [0, 0, 0]; for (const b of Object.values(S.buildings)) if (b.built) lv[b.level - 1]++;
    console.log(`day ${d} $${S.money | 0} (+${S.ledger.lastIncome | 0}/-${S.ledger.lastExpense | 0}) pop ${st.pop} jobs ${st.jobs} eco ${C.eco} bld ${Object.keys(S.buildings).length} sites ${st.sites} trucks ${S.trucks.length} busy ${S.trucks.filter((t) => t.steps).length} lv ${lv} r ${radius} goal ${S.goal}`);
  }
}
const st = computeStats();
console.log(JSON.stringify(st.count));
console.log('hubs', Object.values(S.buildings).filter((b) => b.type === 'hub').map((h) => JSON.stringify(h.inv)).join(' | '));
