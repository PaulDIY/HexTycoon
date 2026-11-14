// Long-run balance test: a bot player grows a city on a road grid.
// Usage: node test/bot.test.js   (env: SEED, DAYS, BOT=demand|fixed)
//  demand (default): zones whatever good is scarcest (supply vs. demand per good), tags the tile
//                    with the building it needs, and demolishes idle surplus producers to free jobs.
//  fixed:            the old strategy, zones every tile by terrain / a fixed pattern.
import { newGame, S, C, roadNeighbors, tileAt } from '../js/state.js';
import { tick, computeStats, isUnlocked, levelUnlocked } from '../js/sim.js';
import * as A from '../js/actions.js';
import { TICK, DAY, BUILDINGS, ZONES, NEED_RATE, GOODS } from '../js/config.js';
import { hexDist, key } from '../js/hex.js';
import { activeHubs } from '../js/logistics.js';

// the sim uses Math.random; seed it so a run is reproducible for a given SEED
const SEED = +process.env.SEED || 4242;
{ let a = SEED >>> 0; Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
newGame(SEED);
const days = +process.env.DAYS || 400;
const MODE = process.env.BOT || 'demand';
const UPGRADE_CAP = +process.env.UPCAP || 99; // max concurrent upgrade sites per hub (demand bot)
const hd = (t) => hexDist(0, 0, t.q, t.r);
const all = () => Object.values(S.buildings);

// road grid: every third row plus a few columns
function roads(radius) {
  for (const t of S.tiles) {
    if (hd(t) > radius || t.terrain === 'water' || t.b) continue;
    const col = t.q + Math.floor(t.r / 2);
    if (((t.r % 3) + 3) % 3 === 1 || col === 3 || col === -6 || col === 10 || col === -13) A.buildRoad(t, 1);
  }
}

// ---------- fixed strategy ----------
function zoneFixed(radius) {
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

// ---------- demand strategy ----------
const zoneOf = (type) => BUILDINGS[type].zone;
// buildings that make good g, unlocked ones only
const makers = (g) => Object.keys(BUILDINGS).filter((t) => {
  const d = BUILDINGS[t];
  return isUnlocked(t) && (d.out === g || (d.recipe && d.recipe.out[g]));
});

// nominal supply and demand per good per day, counting buildings still under construction
// and tiles already tagged for a type (the pipeline), so the bot doesn't over-zone
function balance() {
  const sup = {}, dem = {};
  const add = (o, g, n) => { o[g] = (o[g] || 0) + n; };
  const prodOf = (d, L, o) => {
    if (d.kind === 'producer') add(o, d.out, d.rate[L] * (d.bonus === 'forest' ? 1.3 : 1));
    if (d.kind === 'processor') for (const [g, n] of Object.entries(d.recipe.out)) add(o, g, n * d.rate[L]);
  };
  for (const b of all()) {
    const d = BUILDINGS[b.type], L = b.level - 1;
    prodOf(d, L, sup);
    if (d.kind === 'processor') for (const [g, n] of Object.entries(d.recipe.in)) add(dem, g, n * d.rate[L]);
    if (d.kind === 'house') {
      // plan for full houses, and for the next level's needs once that level is unlocked
      const nl = L < 2 && levelUnlocked(L + 2) ? L + 1 : L;
      for (const g of d.needs[nl]) if (makers(g).length) add(dem, g, d.cap[nl] * NEED_RATE[g] * (nl > L ? 0.5 : 1));
    }
    if (b.site) for (const [g, n] of Object.entries(b.site.need)) add(dem, g, Math.max(0, n - (b.site.got[g] || 0)) / 6);
  }
  for (const t of S.tiles) if (t.zone && !t.b && t.spec && BUILDINGS[t.spec]) {
    const d = BUILDINGS[t.spec];
    prodOf(d, 0, sup);
    if (d.recipe) for (const [g, n] of Object.entries(d.recipe.in)) add(dem, g, n * d.rate[0]);
  }
  // a little standing demand for building materials so construction never starves
  for (const g of ['wood', 'stone', 'planks']) add(dem, g, 2);
  if (isUnlocked('brickworks')) add(dem, 'bricks', 2);
  return { sup, dem };
}
const hubStock = (g) => activeHubs().reduce((a, h) => a + (h.inv[g] || 0), 0);

// best free tile for a building type within the road grid
function pickTile(type, radius) {
  const d = BUILDINGS[type], z = ZONES[d.zone];
  let best = null, bs = -Infinity;
  for (const t of S.tiles) {
    if (hd(t) > radius || t.b || t.road || t.zone || !roadNeighbors(t).length) continue;
    if (!z.terrain.includes(t.terrain) || (d.terrain && !d.terrain.includes(t.terrain))) continue;
    let s = -hd(t);
    if (d.bonus === 'fertile' && t.terrain === 'fertile') s += 6;
    if (d.bonus === 'forest') s += 3 * (t.terrain === 'forest') + 1.5 * neighborsOf(t, 'forest');
    if (!d.bonus && !d.terrain && (t.terrain === 'fertile' || t.terrain === 'forest')) s -= 4; // keep good soil for farms/forestry
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}
function neighborsOf(t, terrain) {
  let n = 0;
  for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]]) { const x = tileAt(t.q + dq, t.r + dr); if (x && x.terrain === terrain) n++; }
  return n;
}
// store tile covering the most houses that no store reaches yet
function pickStoreTile(radius) {
  const R = BUILDINGS.store.range[0], stores = all().filter((b) => b.type === 'store');
  const pending = S.tiles.filter((t) => t.zone === 'com' && !t.b);
  const uncovered = all().filter((h) => h.type === 'house' && ![...stores, ...pending].some((s) => hexDist(s.q, s.r, h.q, h.r) <= BUILDINGS.store.range[s.level ? s.level - 1 : 0]));
  if (!uncovered.length) return null;
  let best = null, bs = 0;
  for (const t of S.tiles) {
    if (hd(t) > radius || t.b || t.road || t.zone || !roadNeighbors(t).length || !ZONES.com.terrain.includes(t.terrain)) continue;
    const s = uncovered.filter((h) => hexDist(t.q, t.r, h.q, h.r) <= R).length;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}

// connected free tile far from existing hubs, near many buildings
function pickHubTile(hubs) {
  const B = all();
  let best = null, bs = -Infinity;
  for (const t of S.tiles) {
    if (hd(t) > radius || t.b || t.road || t.terrain === 'water' || !roadNeighbors(t).length) continue;
    if (!hubs.some((h) => C.fields[h.id] && roadNeighbors(t).some((n) => C.fields[h.id].dist.has(key(n.q, n.r))))) continue;
    const far = Math.min(...hubs.map((h) => hexDist(h.q, h.r, t.q, t.r)));
    const near = B.filter((b) => hexDist(b.q, b.r, t.q, t.r) <= 4).length;
    const s = Math.min(far, 7) + 0.3 * near;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}

let radius = 5;
function demandStep() {
  let acted = 0;
  // 1. residential: keep a few free plots while citizens want to move in
  const st = C.stats;
  const freeRes = S.tiles.filter((t) => t.zone === 'res' && !t.b).length;
  if (st.demandR > 0 && freeRes < 4) for (let i = 0; i < 3; i++) { const t = pickTile('house', radius); if (t) A.zoneTile(t, 'res', 'house'); }
  // 2. commercial: cover houses no store reaches
  if (!S.tiles.some((t) => t.zone === 'com' && !t.b)) { const t = pickStoreTile(radius); if (t) A.zoneTile(t, 'com', 'store'); }
  // 3. goods: zone a maker for the scarcest goods (up to 3 per step)
  for (let k = 0; k < 3; k++) {
    const { sup, dem } = balance();
    let worst = null, wr = 1.1;
    for (const g in dem) {
      if (dem[g] < 0.5 || !makers(g).length) continue;
      const r = (sup[g] || 0) / dem[g];
      if (r < wr) { wr = r; worst = g; }
    }
    if (!worst) break;
    // for food pick whichever maker we have fewer of
    const opts = makers(worst).sort((a, b) => all().filter((x) => x.type === a).length - all().filter((x) => x.type === b).length);
    let done = false;
    for (const type of opts) { const t = pickTile(type, radius); if (t && A.zoneTile(t, zoneOf(type), type).ok) { done = true; acted++; break; } }
    if (!done) { if (radius < 18) { radius++; roads(radius); } break; }
  }
  // 3b. jobs: when citizens lack work (industry demand) and no shortage is left, add the least-oversupplied maker
  const freeInd = S.tiles.some((t) => t.zone && !t.b && t.spec && BUILDINGS[t.spec] && ['producer', 'processor'].includes(BUILDINGS[t.spec].kind));
  if (st.demandI > 0.3 && !freeInd) {
    const { sup, dem } = balance();
    const goods = Object.keys(GOODS).filter((g) => makers(g).length).sort((a, b) => (sup[a] || 0) / (dem[a] || 0.5) - (sup[b] || 0) / (dem[b] || 0.5));
    outer: for (const g of goods) for (const type of makers(g)) { const t = pickTile(type, radius); if (t && A.zoneTile(t, zoneOf(type), type).ok) { acted++; break outer; } }
  }
  // 4. prune: demolish one idle producer of a good we make far too much of (frees workers for other companies)
  const { sup, dem } = balance();
  if (st.vacant > 0) for (const b of all()) {
    const d = BUILDINGS[b.type], g = d.out || (d.recipe && Object.keys(d.recipe.out)[0]);
    if (!g || !b.built || b.status !== 'full' || d.kind === 'house') continue;
    if ((sup[g] || 0) > 1.8 * (dem[g] || 0) + 4 && hubStock(g) > 100) { const t = tileAt(b.q, b.r); A.demolish(t); A.demolish(t); break; }
  }
  return acted;
}

roads(radius);
if (MODE === 'fixed') zoneFixed(radius);
const MILESTONES = [60, 180, 300, 500], reached = {};
let peakCash = 0, peakDay = 0;
for (let d = 0; d < days; d++) {
  for (let i = 0; i < DAY / TICK; i++) tick(TICK);
  const st = computeStats();
  for (const m of MILESTONES) if (reached[m] === undefined && st.pop >= m) reached[m] = d;
  if (S.money > peakCash) { peakCash = S.money; peakDay = d; }
  const hubs = all().filter((b) => b.type === 'hub' && b.built);
  if (MODE !== 'fixed') {
    demandStep();
  }
  if (d % 2 === 0) {
    if (MODE === 'fixed') for (const h of hubs) { if (S.money > 600) A.buyTruck(h); if (S.money > 1500) A.upgrade(h); }
    else for (const h of hubs) {
      // logistics first: when this hub's trucks are all busy, add a truck, or upgrade the hub for more slots
      const tr = S.trucks.filter((t) => t.hub === h.id);
      if (tr.length < 2 || tr.every((t) => t.steps)) {
        const ti = A.truckInfo(h);
        if (ti.n < ti.max) { if (S.money > ti.cost + 150) A.buyTruck(h); }
        else if (!h.site && S.money > A.upgradeInfo(h).cost + 200) A.upgrade(h);
      }
    }
    // every hub maxed out and busy: open a new hub where the city is far from existing ones
    if (MODE !== 'fixed' && !all().some((b) => b.type === 'hub' && !b.built)
      && hubs.every((h) => { const ti = A.truckInfo(h); return ti.n >= ti.max && S.trucks.filter((t) => t.hub === h.id).every((t) => t.steps); })
      && S.money > A.placeCost('hub') + 150) {
      const t = pickHubTile(hubs);
      if (t) { t.zone = null; t.spec = null; A.place('hub', t); }
    }
    // demand bot: a few upgrades at a time, and houses only when the next level's goods are supplied
    const bal = MODE !== 'fixed' ? balance() : null;
    let upgrading = all().filter((b) => b.site && b.site.upgrade).length;
    // demand bot: stores first (houses can only buy what their store sells), then houses, then the rest
    const rank = (b) => (b.type === 'store' ? 0 : b.type === 'house' ? 1 : 2);
    const order = bal ? all().sort((a, b) => rank(a) - rank(b) || a.level - b.level) : all();
    for (const b of order) {
      if (!b.built || b.site || b.type === 'hub') continue;
      if (bal ? S.money < (A.upgradeInfo(b).cost || 0) + 300 : S.money <= 1200) continue;
      const d = BUILDINGS[b.type];
      if (bal) {
        if (upgrading >= UPGRADE_CAP * hubs.length) break;
        if (d.kind === 'house' && b.level < 3 && !d.needs[b.level].every((g) => bal.sup[g] > 0)) continue;
      }
      if (A.upgrade(b).ok) upgrading++;
    }
    if (MODE === 'fixed') {
      const free = S.tiles.filter((t) => t.zone === 'res' && !t.b && roadNeighbors(t).length).length;
      if (free < 3 && radius < 18 && S.money > 300) { radius++; roads(radius); zoneFixed(radius); }
    }
    if (MODE === 'fixed' && st.pop > 60 * hubs.length && S.money > 800) {
      const t = S.tiles.find((x) => hd(x) === radius - 1 && !x.b && !x.road && x.terrain !== 'water' && roadNeighbors(x).length);
      if (t) { t.zone = null; A.place('hub', t); }
    }
    if (C.eco < 55 && S.money > A.placeCost('park') + 150) { const t = S.tiles.find((x) => x.zone === 'res' && !x.b); if (t) { t.zone = null; A.place('park', t); } }
  }
  if (d % 25 === 0 || d === days - 1) {
    const lv = [0, 0, 0]; for (const b of all()) if (b.built) lv[b.level - 1]++;
    console.log(`day ${d} $${S.money | 0} (+${S.ledger.lastIncome | 0}/-${S.ledger.lastExpense | 0}) pop ${st.pop} jobs ${st.jobs} eco ${C.eco} bld ${Object.keys(S.buildings).length} sites ${st.sites} trucks ${S.trucks.length} busy ${S.trucks.filter((t) => t.steps).length} lv ${lv} r ${radius} goal ${S.goal}`);
  }
}
const st = computeStats();
const houses = all().filter((b) => b.type === 'house' && b.built), sat = {};
for (const h of houses) for (const [g, v] of Object.entries(h.sat)) (sat[g] ||= []).push(v);
console.log(`[${MODE}] milestones (day reached):`, MILESTONES.map((m) => `${m} pop: ${reached[m] ?? '—'}`).join(', '), `| peak cash $${peakCash | 0} on day ${peakDay}`);
console.log('avg happy', (houses.reduce((a, h) => a + h.happy, 0) / (houses.length || 1)).toFixed(0), 'sat',
  Object.entries(sat).map(([g, a]) => `${g} ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)}`).join(' '));
console.log(JSON.stringify(st.count));
console.log('hubs', all().filter((b) => b.type === 'hub').map((h) => JSON.stringify(h.inv)).join(' | '));
// SAVE=path writes the final city as a save file (paste into localStorage 'hexaverde-save-v1' to inspect it in the game)
if (process.env.SAVE) { const { serialize } = await import('../js/state.js'); (await import('node:fs')).writeFileSync(process.env.SAVE, serialize()); }
