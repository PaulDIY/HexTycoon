// Economy simulation: construction, production, citizens, stores, taxes, growth, pollution, goals.
import { S, C, tileAt, neighbors, roadNeighbors, def, createBuilding, emit, hubTrucks } from './state.js';
import { DAY, BUILDINGS, ZONES, GOODS, NEED_RATE, COMPANY_TAX, SALES_TAX, ROAD, TRUCK, LEVEL_UNLOCK, UNLOCK_MESSAGES, GOALS } from './config.js';
import { hexDist, key, hash2 } from './hex.js';
import { tickLogistics, activeHubs, isConnected } from './logistics.js';

const add = (o, g, n) => { o[g] = (o[g] || 0) + n; if (Math.abs(o[g]) < 1e-6) delete o[g]; };
const pay = (n) => { S.money += n; S.ledger.income += n; };
const spend = (n) => { S.money -= n; S.ledger.expense += n; };

export const pop = () => C.stats ? C.stats.pop : 0;
export const isUnlocked = (type) => (BUILDINGS[type].unlock || 0) <= S.maxPop;
export const levelUnlocked = (lvl) => LEVEL_UNLOCK[lvl - 1] <= S.maxPop;

// ---------- stats ----------
export function computeStats() {
  const t = { pop: 0, jobs: 0, houses: 0, cap: 0, count: {}, zoned: {}, trucks: S.trucks.length, maxLevel: 1, upkeep: 0, sites: 0, unhoused: 0 };
  for (const z in ZONES) t.zoned[z] = 0;
  for (const tile of S.tiles) {
    if (tile.zone) t.zoned[tile.zone]++;
    if (tile.road) t.upkeep += ROAD.upkeep[tile.road - 1];
  }
  for (const b of Object.values(S.buildings)) {
    const d = def(b);
    t.count[b.type] = (t.count[b.type] || 0) + 1;
    t.maxLevel = Math.max(t.maxLevel, b.level);
    if (b.site && !b.site.upgrade) { if (isConnected(b)) t.sites++; continue; }
    if (d.kind === 'house') { t.pop += b.residents; t.cap += d.cap[b.level - 1]; t.houses++; }
    if (d.workers) t.jobs += d.workers[b.level - 1];
    if (d.upkeep) t.upkeep += d.upkeep[b.level - 1];
  }
  for (const tr of S.trucks) { const h = S.buildings[tr.hub]; if (h) t.upkeep += TRUCK.upkeep[h.level - 1]; }
  t.employment = t.jobs > 0 ? Math.min(1, t.pop / t.jobs) : 1;
  t.unemployed = Math.max(0, t.pop - t.jobs);
  // demand (-1..1 style numbers, >0 means growth wanted)
  t.demandR = (t.jobs + 8 - t.pop) / 20;
  t.demandI = (t.pop + 6 - t.jobs * 0.85) / 20;
  const stores = t.count.store || 0;
  t.demandC = (t.pop - stores * 28 + (stores === 0 && t.pop > 0 ? 20 : 0)) / 20;
  t.eco = C.eco ?? 100;
  C.stats = t;
  return t;
}

// ---------- pollution & eco ----------
function computePollution() {
  const poll = new Map();
  let total = S.co2 * 0.5, green = 6;
  const addP = (q, r, v, rad) => {
    for (let dq = -rad; dq <= rad; dq++) for (let dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
      const d = hexDist(0, 0, dq, dr), k = key(q + dq, r + dr);
      if (!C.tiles.has(k)) continue;
      poll.set(k, (poll.get(k) || 0) + v * (1 - d / (rad + 1)));
    }
  };
  for (const b of Object.values(S.buildings)) {
    if (!b.built) continue;
    const d = def(b), p = d.poll[b.level - 1];
    if (p > 0) { total += p; addP(b.q, b.r, p, 2); }
    if (d.kind === 'park') { const st = d.strength[b.level - 1]; green += st * 2; addP(b.q, b.r, -st, d.radius[b.level - 1]); }
  }
  for (const t of S.tiles) if (t.terrain === 'forest') { green += 0.08; }
  C.poll = poll;
  C.eco = Math.max(0, Math.min(100, Math.round(100 * green / (green + total))));
}

function storesInRange(h) {
  if (C.nearDirty) { C.storesNear = {}; C.nearDirty = false; }
  if (C.storesNear[h.id]) return C.storesNear[h.id];
  const list = [];
  for (const b of Object.values(S.buildings)) {
    if (b.type !== 'store' || (!b.built)) continue;
    if (hexDist(b.q, b.r, h.q, h.r) <= BUILDINGS.store.range[b.level - 1]) list.push(b);
  }
  return (C.storesNear[h.id] = list);
}

// ---------- per building ----------
function tickSite(b, dt) {
  const s = b.site;
  const done = Object.entries(s.need).every(([g, n]) => (s.got[g] || 0) >= n);
  if (!done) return;
  s.progress += dt / (DAY * 0.5);
  if (s.progress >= 1) {
    if (s.upgrade) { b.level++; emit('upgraded', { b: b.id }); }
    else { b.built = true; emit('built', { b: b.id }); if (def(b).kind === 'house') b.residents = 2; }
    b.site = null;
    C.fieldsDirty = C.groundDirty = C.nearDirty = true;
  }
}

function efficiency(b) {
  const d = def(b), t = tileAt(b.q, b.r);
  let e = C.stats ? C.stats.employment : 1;
  if (d.bonus === 'fertile' && t.terrain === 'fertile') e *= 1.3;
  if (d.bonus === 'forest') {
    const n = neighbors(t).filter((x) => x.terrain === 'forest').length + (t.terrain === 'forest' ? 2 : 0);
    e *= 0.5 + n * 0.2;
  }
  return e;
}

function tickProducer(b, d, dt) {
  const L = b.level - 1, cap = d.buf[L];
  if ((b.inv[d.out] || 0) >= cap) { b.status = 'full'; return; }
  b.status = 'ok';
  b.progress += d.rate[L] * efficiency(b) * dt / DAY;
  while (b.progress >= 1) {
    b.progress -= 1; add(b.inv, d.out, 1);
    pay(GOODS[d.out].value * COMPANY_TAX);
  }
}

function tickProcessor(b, d, dt) {
  const L = b.level - 1, cap = d.buf[L];
  const hasIn = Object.entries(d.recipe.in).every(([g, n]) => (b.inv[g] || 0) >= n);
  const outTotal = Object.keys(d.recipe.out).reduce((a, g) => a + (b.inv[g] || 0), 0);
  if (!hasIn) { b.status = 'noinput'; return; }
  if (outTotal >= cap) { b.status = 'full'; return; }
  b.status = 'ok';
  b.progress += d.rate[L] * efficiency(b) * dt / DAY;
  if (b.progress >= 1) {
    b.progress -= 1;
    for (const [g, n] of Object.entries(d.recipe.in)) add(b.inv, g, -n);
    for (const [g, n] of Object.entries(d.recipe.out)) { add(b.inv, g, n); pay(GOODS[g].value * n * COMPANY_TAX); }
    if (Math.random() < 0.5) emit('smoke', { b: b.id });
  }
}

function tickHouse(b, d, dt) {
  const L = b.level - 1, needs = d.needs[L];
  for (const g of needs) {
    if (b.sat[g] === undefined) b.sat[g] = 0.6;
    b.want[g] = (b.want[g] || 0) + b.residents * NEED_RATE[g] * dt / DAY;
    while (b.want[g] >= 1) {
      b.want[g] -= 1;
      let best = null;
      for (const s of storesInRange(b)) {
        if (!s.built && !s.site) continue;
        if ((s.inv[g] || 0) >= 1 && (!best || s.inv[g] > best.inv[g])) best = s;
      }
      if (best) { add(best.inv, g, -1); pay(GOODS[g].value * SALES_TAX); b.sat[g] = b.sat[g] * 0.75 + 0.25; }
      else b.sat[g] *= 0.75;
    }
  }
  const sat = needs.reduce((a, g) => a + (b.sat[g] ?? 0.6), 0) / needs.length;
  const lp = C.poll.get(key(b.q, b.r)) || 0;
  const eco = C.eco ?? 100;
  const unemp = C.stats && C.stats.pop > 0 ? C.stats.unemployed / C.stats.pop : 0;
  b.happy = Math.max(0, Math.min(100, 32 + sat * 48 + (eco - 50) * 0.25 - lp * 6 - unemp * 30));
  pay(b.residents * d.tax[L] * (b.happy / 100) * dt / DAY);
  b.growT += dt;
  if (b.growT > DAY * 0.3) {
    b.growT = 0;
    const st = C.stats;
    if (b.happy >= 45 && b.residents < d.cap[L] && st && st.demandR > 0) b.residents++;
    else if (b.happy < 25 && b.residents > 1 && Math.random() < 0.5) b.residents--;
    if (b.residents > d.cap[L]) b.residents = d.cap[L];
  }
}

// ---------- zone growth ----------
function reachable(t, hubs) {
  for (const n of roadNeighbors(t)) { const k = key(n.q, n.r); for (const h of hubs) if (C.fields[h.id] && C.fields[h.id].dist.has(k)) return true; }
  return false;
}
function chooseType(zone, tile) {
  const z = ZONES[zone];
  let opts = z.types.filter((t) => isUnlocked(t) && (!BUILDINGS[t].terrain || BUILDINGS[t].terrain.includes(tile.terrain)));
  if (tile.spec && opts.includes(tile.spec)) return tile.spec;
  if (tile.spec && tile.spec !== 'auto') return null;
  if (!opts.length) return null;
  if (opts.length === 1) return opts[0];
  // auto: favour types that are rare and whose inputs exist
  const counts = C.stats.count, stock = {};
  for (const h of activeHubs()) for (const [g, n] of Object.entries(h.inv)) stock[g] = (stock[g] || 0) + n;
  let best = null, bs = -1;
  for (const t of opts) {
    const d = BUILDINGS[t];
    let s = 1 / (1 + (counts[t] || 0) * 1.5);
    if (d.recipe) {
      const inputs = Object.keys(d.recipe.in);
      const supplied = inputs.every((g) => Object.values(S.buildings).some((b) => b.built && BUILDINGS[b.type].out === g) || (stock[g] || 0) > 5);
      s *= supplied ? 2 : 0.4;
      const out = Object.keys(d.recipe.out)[0];
      s *= 1 / (1 + (stock[out] || 0) / 20);
    }
    s *= 0.8 + hash2(tile.q, tile.r, Math.floor(S.time)) * 0.4;
    if (s > bs) { bs = s; best = t; }
  }
  return best;
}

function tryGrow() {
  const st = C.stats;
  if (st.sites >= 3 + activeHubs().length * 2) return;
  const demand = { res: st.demandR, com: st.demandC, agri: st.demandI, forest: st.demandI, mine: st.demandI, ind: st.demandI };
  const order = Object.keys(ZONES).sort(() => Math.random() - 0.5);
  for (const zone of order) {
    if (demand[zone] <= 0) continue;
    const hubs = activeHubs();
    const cands = S.tiles.filter((t) => t.zone === zone && !t.b && !t.road && roadNeighbors(t).length && reachable(t, hubs));
    if (!cands.length) continue;
    const tile = cands[Math.floor(Math.random() * cands.length)];
    const type = chooseType(zone, tile);
    if (!type) continue;
    createBuilding(type, tile.q, tile.r);
    st.sites++;
    if (st.sites >= 3 + activeHubs().length * 2) return;
  }
}

// ---------- main tick ----------
let slowT = 0, growT = 0;
export function tick(dt) {
  S.time += dt;
  if (!C.stats) { computeStats(); computePollution(); }
  for (const b of Object.values(S.buildings)) {
    const d = def(b);
    b.age += dt;
    if (b.site) tickSite(b, dt);
    if (!b.built) continue;
    if (d.kind === 'producer') tickProducer(b, d, dt);
    else if (d.kind === 'processor') tickProcessor(b, d, dt);
    else if (d.kind === 'house') tickHouse(b, d, dt);
  }
  tickLogistics(dt);
  spend(C.stats.upkeep * dt / DAY);
  slowT += dt; growT += dt;
  if (slowT >= 1) {
    slowT = 0;
    computeStats(); computePollution();
    S.co2 *= 0.97;
    const p = C.stats.pop;
    if (p > S.maxPop) {
      const old = S.maxPop; S.maxPop = p;
      for (const [n, msg] of UNLOCK_MESSAGES) if (old < n && p >= n) emit('toast', { text: '🔓 ' + msg, kind: 'unlock' });
    }
    checkGoals();
  }
  if (growT >= DAY * 0.4) { growT = 0; tryGrow(); }
  const day = Math.floor(S.time / DAY);
  if (day !== S.ledger.day) {
    S.ledger.lastIncome = S.ledger.income; S.ledger.lastExpense = S.ledger.expense;
    S.ledger.income = 0; S.ledger.expense = 0; S.ledger.day = day;
  }
}

function checkGoals() {
  const g = GOALS[S.goal];
  if (!g) return;
  if (g.check(S, C.stats)) {
    pay(g.reward); S.goal++;
    emit('toast', { text: `🎯 Goal complete: ${g.text} (+$${g.reward})`, kind: 'goal' });
  }
}

export function refreshDerived() { computeStats(); computePollution(); computeStats(); }
export { add, pay, spend };
