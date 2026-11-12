// Player actions with validation. Each returns { ok, msg }.
import { S, C, tileAt, neighbors, roadNeighbors, def, createBuilding, makeSite, addTruck, hubTrucks, emit } from './state.js';
import { BUILDINGS, ZONES, ROAD, ZONE_COST, LEVEL_UNLOCK, COUNT_SCALE } from './config.js';
import { cancelTrucksFor, cancelTruck, activeHubs } from './logistics.js';
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
  const idle = ts.find((t) => !t.steps) || ts[ts.length - 1];
  if (idle.steps) cancelTruck(idle);
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
    }
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
