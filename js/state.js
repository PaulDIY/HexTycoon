// Game state (serialisable) + derived caches + map generation.
import { MAP_RADIUS, START_MONEY, BUILDINGS } from './config.js';
import { key, parseKey, DIRS, hexDist, hash2, toWorld } from './hex.js';

export let S = null;          // saved state
export const C = {            // derived, never saved
  tiles: new Map(),           // key -> tile object (same objects as S.tiles)
  fieldsDirty: true, fields: {},
  groundDirty: true, nearDirty: true, storesNear: {},
  poll: new Map(), stats: null, events: [],
};
export function setState(s) {
  S = s;
  C.tiles = new Map();
  for (const t of S.tiles) C.tiles.set(key(t.q, t.r), t);
  C.fieldsDirty = C.groundDirty = C.nearDirty = true;
  C.fields = {}; C.storesNear = {}; C.poll = new Map();
  C.day = newDayCounters();
}

// per-day counters for statistics; rolled into S.hist at the end of each day
export function newDayCounters() {
  return { prod: {}, use: {}, exp: {}, expIncome: 0, trips: { con: 0, sup: 0, col: 0 }, moved: 0, dist: 0, co2: 0, busy: 0, samples: 0 };
}

export const tileAt = (q, r) => C.tiles.get(key(q, r));
export const tileByKey = (k) => C.tiles.get(k);
export function neighbors(t) {
  const out = [];
  for (const [dq, dr] of DIRS) { const n = tileAt(t.q + dq, t.r + dr); if (n) out.push(n); }
  return out;
}
export const roadNeighbors = (t) => neighbors(t).filter((n) => n.road > 0);
export const bAt = (t) => (t && t.b ? S.buildings[t.b] : null);
export const def = (b) => BUILDINGS[b.type];
export const tileOf = (b) => tileAt(b.q, b.r);

export function emit(type, data) { C.events.push({ type, ...data }); }

// ---------- value noise ----------
function noise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const s = (t) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, seed) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < 4; i++) { v += amp * noise(x * f, y * f, seed + i * 17); amp *= 0.5; f *= 2; }
  return v / 0.9375;
}

export function generateMap(seed) {
  const tiles = [];
  const R = MAP_RADIUS;
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const { x, y } = toWorld(q, r);
      const d = hexDist(0, 0, q, r) / R;
      let e = fbm(x * 0.006 + 50, y * 0.006 + 50, seed) - Math.pow(d, 3) * 0.55 + 0.08;
      const m = fbm(x * 0.009 + 9, y * 0.009 + 3, seed + 99);
      let terrain;
      if (e < 0.33) terrain = 'water';
      else if (e < 0.38) terrain = 'sand';
      else if (e > 0.73) terrain = 'hills';
      else if (m > 0.56) terrain = 'forest';
      else if (m < 0.42 && e < 0.55) terrain = 'fertile';
      else terrain = 'grass';
      if (d >= 0.999) terrain = 'water';
      const hd = hexDist(0, 0, q, r);
      if (hd <= 3) terrain = hd <= 2 ? 'grass' : (terrain === 'water' || terrain === 'hills' ? 'grass' : terrain);
      tiles.push({ q, r, terrain, v: Math.floor(hash2(q, r, seed + 5) * 3), zone: null, spec: null, road: 0, b: null });
    }
  }
  // guarantee some starting resources nearby
  const ensure = (terrain, count, minD, maxD, seedOff) => {
    const near = tiles.filter((t) => { const hd = hexDist(0, 0, t.q, t.r); return hd >= minD && hd <= maxD; });
    let have = near.filter((t) => t.terrain === terrain).length;
    let i = 0;
    while (have < count && i < 200) {
      const c = near[Math.floor(hash2(i, seedOff, seed) * near.length)];
      i++;
      if (!c || c.terrain === terrain) continue;
      for (const t of near) {
        if (hexDist(c.q, c.r, t.q, t.r) <= 1 && t.terrain !== 'water') { t.terrain = terrain; have++; }
      }
    }
  };
  ensure('hills', 5, 5, 9, 1);
  ensure('forest', 10, 4, 8, 2);
  ensure('sand', 4, 5, 10, 3);
  ensure('fertile', 6, 4, 8, 4);
  for (const t of tiles) if (hexDist(0, 0, t.q, t.r) <= 2) t.terrain = 'grass';
  return tiles;
}

export function newGame(seed = Math.floor(Math.random() * 1e6)) {
  const s = {
    version: 1, seed, money: START_MONEY, time: 0, speed: 1,
    tiles: generateMap(seed), buildings: {}, trucks: [], nextId: 1,
    goal: 0, unlockStage: 0, co2: 0, maxPop: 0,
    ledger: { income: 0, expense: 0, lastIncome: 0, lastExpense: 0, day: 0 },
    hist: [], // one snapshot per finished day (see sim.js closeDay)
    market: {}, // recent export volume per good, lowers harbor prices (see sim.js marketFactor)
  };
  setState(s);
  // starter road row and hub
  for (let q = -4; q <= 4; q++) { const t = tileAt(q, 1); if (t) { t.road = 1; t.terrain = t.terrain === 'water' ? 'grass' : t.terrain; } }
  for (let r = -3; r <= 0; r++) { const t = tileAt(2, r); if (t) t.road = 1; }
  const hub = createBuilding('hub', 0, 0, { built: true });
  hub.inv = { wood: 50, stone: 36, food: 24 };
  addTruck(hub); addTruck(hub);
  return s;
}

export function createBuilding(type, q, r, opts = {}) {
  const d = BUILDINGS[type];
  const id = 'b' + S.nextId++;
  const b = {
    id, type, q, r, level: 1, built: !!opts.built,
    rot: Math.floor(hash2(q, r, 7) * 6),
    inv: {}, incoming: {}, resOut: {}, progress: 0,
    site: null, age: 0,
  };
  if (!b.built) b.site = makeSite(d.mats[0], false);
  if (d.kind === 'house') { b.residents = 0; b.sat = {}; b.want = {}; b.happy = 70; b.growT = 0; }
  if (d.kind === 'hub') { b.priority = 'balanced'; }
  if (d.kind === 'harbor') { b.exp = { g: null, amt: 5 }; b.sold = 0; }
  S.buildings[id] = b;
  const t = tileAt(q, r);
  t.b = id;
  C.fieldsDirty = C.groundDirty = C.nearDirty = true;
  return b;
}

export function makeSite(mats, upgrade) {
  return { need: { ...mats }, got: {}, incoming: {}, progress: 0, upgrade, t0: S.time }; // t0: when the site opened
}

export function addTruck(hub) {
  const t = { id: 't' + S.nextId++, hub: hub.id, steps: null, si: 0, path: null, pi: 0, seg: 0, cargo: null, x: 0, y: 0, h: 0, wait: 0 };
  S.trucks.push(t);
  return t;
}

export function hubTrucks(hubId) { return S.trucks.filter((t) => t.hub === hubId); }

export function serialize() { return JSON.stringify(S); }
export function deserialize(json) {
  const s = JSON.parse(json);
  if (!s || s.version !== 1) throw new Error('bad save');
  if (!s.hist) s.hist = []; // saves from before statistics existed
  if (!s.market) s.market = {}; // saves from before export saturation
  setState(s);
  return s;
}

export { key, parseKey };
