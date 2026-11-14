// Player actions with validation. Each returns { ok, msg }.
import { S, C, tileAt, neighbors, roadNeighbors, def, createBuilding, makeSite, addTruck, hubTrucks, emit } from './state.js';
import { BUILDINGS, ZONES, ROAD, ZONE_COST, LEVEL_UNLOCK, COUNT_SCALE, GOODS } from './config.js';
import { cancelTrucksFor, cancelTruck, activeHubs, access, computeFields } from './logistics.js';
import { spend, pay, levelUnlocked, isUnlocked, computeStats } from './sim.js';

const fail = (msg) => ({ ok: false, msg });
const OK = { ok: true };
const dirty = () => { C.groundDirty = true; C.fieldsDirty = true; C.nearDirty = true; };

export function canZone(t, zone) {
  if (!t) return fail('Outside the map');
  if (t.b) return fail('Occupied');
  if (t.road) return fail('Road here');
  if (!ZONES[zone].terrain.includes(t.terrain)) return fail(`${ZONES[zone].name} needs ${ZONES[zone].terrain.join(' / ')}`);
  if (ZONES[zone].coastal && !isCoastal(t)) return fail(`${ZONES[zone].name} must touch water`);
  if (t.zone === zone) return fail('Already zoned');
  if (S.money < ZONE_COST) return fail('Not enough money');
  return OK;
}
export const isCoastal = (t) => t.terrain !== 'water' && neighbors(t).some((n) => n.terrain === 'water');
export function zoneTile(t, zone, spec) {
  const c = canZone(t, zone);
  if (!c.ok) {
    if (t && t.zone === zone && spec && t.spec !== spec) { t.spec = spec; return OK; }
    return c;
  }
  spend(ZONE_COST);
  t.zone = zone; t.spec = spec || 'auto';
  C.groundDirty = true;
  return OK;
}

export function roadCost(t, level) {
  if (!t) return null;
  if (t.road >= level) return 0;
  return ROAD.cost[level - 1] - (t.road ? ROAD.cost[t.road - 1] : 0);
}
export function canRoad(t, level) {
  if (!t) return fail('Outside the map');
  if (t.terrain === 'water') return fail('Cannot build on water');
  if (t.b) return fail('Occupied');
  if (t.road >= level) return fail('Already built');
  if (LEVEL_UNLOCK[level - 1] > S.maxPop) return fail(`${ROAD.names[level - 1]} unlocks at ${LEVEL_UNLOCK[level - 1]} citizens`);
  if (S.money < roadCost(t, level)) return fail('Not enough money');
  return OK;
}
export function buildRoad(t, level) {
  const c = canRoad(t, level);
  if (!c.ok) return c;
  spend(roadCost(t, level));
  t.road = level; t.zone = null; t.spec = null;
  if (t.terrain === 'forest') t.terrain = 'grass';
  dirty();
  return OK;
}

// Price of placing a new player building: rises linearly with how many you already own.
// The starter hub doesn't count: the 2nd hub costs the base price, the 3rd × 1.5, the 4th × 2 …
export function placeCost(type) {
  const base = BUILDINGS[type].cost[0], k = COUNT_SCALE[type] || 0;
  if (!k) return base;
  let n = 0;
  for (const b of Object.values(S.buildings)) if (b.type === type) n++;
  if (type === 'hub') n = Math.max(0, n - 1);
  return Math.round((base * (1 + k * n)) / 10) * 10;
}

export function canPlace(type, t) {
  const d = BUILDINGS[type];
  if (!t) return fail('Outside the map');
  if (t.terrain === 'water') return fail('Cannot build on water');
  if (t.b) return fail('Occupied');
  if (t.road) return fail('Road here');
  if (!isUnlocked(type)) return fail('Locked');
  if (d.needsRoad && !roadNeighbors(t).length) return fail('Must be next to a road');
  if (S.money < placeCost(type)) return fail('Not enough money');
  return OK;
}
export function place(type, t) {
  const c = canPlace(type, t);
  if (!c.ok) return c;
  spend(placeCost(type));
  t.zone = null; t.spec = null;
  if (t.terrain === 'forest') t.terrain = 'grass';
  const b = createBuilding(type, t.q, t.r);
  dirty();
  return { ok: true, b };
}

export function upgradeInfo(b) {
  const d = def(b);
  if (b.level >= 3) return { can: false, msg: 'Max level' };
  if (b.site) return { can: false, msg: b.site.upgrade ? 'Upgrade in progress' : 'Under construction' };
  const next = b.level + 1;
  const cost = d.player ? d.cost[next - 1] : d.upCost[next - 1];
  const mats = d.mats[next - 1];
  if (!levelUnlocked(next)) return { can: false, cost, mats, msg: `Level ${next} unlocks at ${LEVEL_UNLOCK[next - 1]} citizens` };
  if (S.money < cost) return { can: false, cost, mats, msg: 'Not enough money' };
  return { can: true, cost, mats };
}
export function upgrade(b) {
  const u = upgradeInfo(b);
  if (!u.can) return fail(u.msg);
  spend(u.cost);
  b.site = makeSite(u.mats, true);
  return OK;
}

export function truckInfo(hub) {
  const d = BUILDINGS.hub, L = hub.level - 1;
  const n = hubTrucks(hub.id).length;
  return { n, max: d.trucks[L], cost: d.truckCost[L] };
}
export function buyTruck(hub) {
  if (!hub.built) return fail('Hub not finished');
  const i = truckInfo(hub);
  if (i.n >= i.max) return fail('Truck slots full — upgrade the hub');
  if (S.money < i.cost) return fail('Not enough money');
  spend(i.cost);
  addTruck(hub);
  computeStats();
  return OK;
}
export function sellTruck(hub) {
  const ts = hubTrucks(hub.id);
  if (ts.length <= 0) return fail('No trucks');
  // sell a free idle truck if possible, route trucks last
  const idle = ts.find((t) => !t.route && !t.steps) || ts.find((t) => !t.route) || ts[ts.length - 1];
  cancelTruck(idle);
  S.trucks.splice(S.trucks.indexOf(idle), 1);
  pay(Math.round(truckInfo(hub).cost * 0.3));
  return OK;
}

export function demolish(t) {
  if (!t) return fail('Nothing here');
  const b = t.b ? S.buildings[t.b] : null;
  if (b) {
    const d = def(b);
    if (b.type === 'hub' && b.built && activeHubs().length <= 1) return fail('You need at least one Storage Hub');
    cancelTrucksFor(b.id);
    if (b.type === 'hub') {
      for (const tr of S.trucks.filter((x) => x.hub === b.id)) S.trucks.splice(S.trucks.indexOf(tr), 1);
      S.routes = S.routes.filter((r) => r.hub !== b.id);
    }
    for (const r of S.routes) r.stops = r.stops.filter((st) => st.b !== b.id);
    if (d.player) pay(Math.round(d.cost[b.level - 1] * 0.3));
    delete S.buildings[b.id];
    t.b = null;
    dirty();
    emit('demolished', { b: b.id });
    return OK;
  }
  if (t.road) { t.road = 0; dirty(); return OK; }
  if (t.zone) { t.zone = null; t.spec = null; C.groundDirty = true; return OK; }
  return fail('Nothing to remove');
}

export function setPriority(hub, p) { hub.priority = p; }

// harbor: which good to ship and how many units per day
export function setExport(b, g, amt) {
  const d = def(b), max = d.maxExport[b.level - 1];
  if (g !== undefined) b.exp.g = g;
  if (amt !== undefined) b.exp.amt = Math.max(0, Math.min(max, Math.round(amt)));
  return OK;
}

// ---------- depot rules ----------
// hub.keep = null: free trucks bring any good (up to 35% of space each). { good: max }: only these goods, up to max.
export const keepStep = (hub) => { const c = BUILDINGS.hub.cap[hub.level - 1]; return c >= 1000 ? 50 : c >= 400 ? 25 : 10; };
export function setKeepMode(hub, pick) {
  if (!pick) { hub.keep = null; return; }
  // start from what is stored now, so switching modes doesn't strand goods
  const def0 = keepStep(hub) * 4;
  hub.keep = {};
  for (const [g, n] of Object.entries(hub.inv)) if (n >= 1) hub.keep[g] = Math.max(def0, Math.ceil(n / keepStep(hub)) * keepStep(hub));
}
export function toggleKeep(hub, g) {
  if (!hub.keep) hub.keep = {};
  if (g in hub.keep) delete hub.keep[g]; else hub.keep[g] = keepStep(hub) * 4;
}
export function setKeepMax(hub, g, delta) {
  if (!hub.keep || !(g in hub.keep)) return;
  hub.keep[g] = Math.max(0, Math.min(BUILDINGS.hub.cap[hub.level - 1], hub.keep[g] + delta));
}

// ---------- player routes ----------
const ROUTE_COLORS = ['#e8553a', '#2e86de', '#20a35a', '#9b59d0', '#e3a008', '#0fa3b1', '#d63384', '#6c7a89'];
export const routeTrucks = (r) => S.trucks.filter((t) => t.route === r.id);
export function createRoute(hub) {
  if (!hub.built) return fail('Hub not finished');
  const n = S.routes.filter((r) => r.hub === hub.id).length;
  const r = { id: 'r' + S.nextId++, hub: hub.id, name: `Route ${n + 1}`, color: ROUTE_COLORS[S.routes.length % ROUTE_COLORS.length], stops: [], moved: 0, lastMoved: 0 };
  S.routes.push(r);
  return { ok: true, r };
}
export function deleteRoute(r) {
  for (const t of routeTrucks(r)) unassign(t);
  S.routes.splice(S.routes.indexOf(r), 1);
  return OK;
}
function unassign(t) { cancelTruck(t); t.route = null; t.rs = 0; }

// what a truck can load / unload at building b (hub: '*' unloads everything it carries)
export function stopOptions(b) {
  const d = def(b), L = b.level - 1;
  if (b.site && !b.built) return { load: [], unload: Object.keys(b.site.need) };
  if (d.kind === 'producer') return { load: [d.out], unload: [] };
  if (d.kind === 'processor') return { load: Object.keys(d.recipe.out), unload: Object.keys(d.recipe.in) };
  if (d.kind === 'store') return { load: [], unload: d.sells[L] };
  if (d.kind === 'harbor') return { load: [], unload: b.exp && b.exp.g ? [b.exp.g] : [] };
  if (d.kind === 'hub') return { load: Object.keys(GOODS), unload: ['*'] };
  return { load: [], unload: [] };
}
export function addStop(r, b) {
  if (!b) return fail('Tap a building to add a stop');
  const hub = S.buildings[r.hub];
  const o = stopOptions(b);
  if (!o.load.length && !o.unload.length) return fail(def(b).kind === 'house' ? 'Houses shop at stores: add the store instead' : 'Nothing to load or unload here');
  if (C.fieldsDirty) computeFields();
  if (b !== hub && !access(hub.id, b)) return fail('No road from this route\'s hub to here');
  const last = r.stops[r.stops.length - 1];
  if (last && last.b === b.id) return fail('Already the last stop');
  // sensible defaults: load what it makes, unload what it uses; a hub takes everything, loads nothing until you pick
  r.stops.push({ b: b.id, load: def(b).kind === 'hub' ? [] : o.load.slice(), unload: o.unload.slice(), full: false });
  return OK;
}
export function removeStop(r, i) {
  r.stops.splice(i, 1);
  for (const t of routeTrucks(r)) if (t.rs > i) t.rs--; else if (t.rs >= r.stops.length) t.rs = 0;
  return OK;
}
export function toggleStopGood(r, i, way, g) {
  const st = r.stops[i]; if (!st) return OK;
  const list = st[way], k = list.indexOf(g);
  if (k >= 0) list.splice(k, 1); else list.push(g);
  return OK;
}
export function toggleStopFull(r, i) { const st = r.stops[i]; if (st) st.full = !st.full; return OK; }
// +1: take a free truck of the hub (idle first), buy one if none is free; -1: release the last one
export function routeTruckDelta(r, delta) {
  const hub = S.buildings[r.hub];
  if (delta < 0) { const ts = routeTrucks(r); if (!ts.length) return fail('No trucks on this route'); unassign(ts[ts.length - 1]); return OK; }
  let t = hubTrucks(hub.id).filter((x) => !x.route).sort((a, b) => !!a.steps - !!b.steps)[0];
  if (!t) { const res = buyTruck(hub); if (!res.ok) return fail(res.msg === 'Truck slots full — upgrade the hub' ? 'No free truck and no free slot: upgrade the hub' : res.msg); t = hubTrucks(hub.id).at(-1); }
  t.route = r.id; t.rs = 0; t.hold = t.hold || {}; t.at = t.at || hub.id; t.loop0 = undefined;
  return OK;
}
