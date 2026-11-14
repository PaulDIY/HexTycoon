// Road network distance fields, truck job dispatch and movement.
import { S, C, tileAt, tileByKey, roadNeighbors, def, emit } from './state.js';
import { BUILDINGS, ROAD, TRUCK, PRIORITIES, DAY } from './config.js';
import { key, parseKey, toWorld, TILE_W, hexDist } from './hex.js';

// ---------- distance fields (Dijkstra from every hub over roads) ----------
function heapPush(h, item) { h.push(item); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
function heapPop(h) {
  const top = h[0], last = h.pop();
  if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
    if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r;
    if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
  return top;
}

export function activeHubs() {
  return Object.values(S.buildings).filter((b) => b.type === 'hub' && b.built);
}

export function computeFields() {
  C.fields = {};
  for (const hub of activeHubs()) {
    const dist = new Map(), parent = new Map(), heap = [];
    const start = tileAt(hub.q, hub.r);
    for (const n of roadNeighbors(start)) { const k = key(n.q, n.r); dist.set(k, 1 / ROAD.speed[n.road - 1]); parent.set(k, null); heapPush(heap, [dist.get(k), k]); }
    while (heap.length) {
      const [d, k] = heapPop(heap);
      if (d > dist.get(k)) continue;
      const t = tileByKey(k);
      for (const n of roadNeighbors(t)) {
        const nk = key(n.q, n.r), nd = d + 1 / ROAD.speed[n.road - 1];
        if (!dist.has(nk) || nd < dist.get(nk)) { dist.set(nk, nd); parent.set(nk, k); heapPush(heap, [nd, nk]); }
      }
    }
    C.fields[hub.id] = { dist, parent };
  }
  C.fieldsDirty = false;
  C.fieldsGen = (C.fieldsGen || 0) + 1; // invalidates cached route lines
}

// best road tile next to building b reachable from hub field
export function access(hubId, b) {
  const f = C.fields[hubId];
  if (!f) return null;
  const t = tileAt(b.q, b.r);
  let best = null;
  for (const n of roadNeighbors(t)) {
    const k = key(n.q, n.r), d = f.dist.get(k);
    if (d !== undefined && (!best || d < best.d)) best = { k, d };
  }
  return best;
}

// list of tile keys from hub's first road tile to tile k
function chain(hubId, k) {
  const f = C.fields[hubId], out = [];
  let c = k;
  while (c) { out.push(c); c = f.parent.get(c); }
  return out.reverse();
}

const centre = (b) => toWorld(b.q, b.r);
function pts(keys) { return keys.map((k) => { const t = tileByKey(k); const w = toWorld(t.q, t.r); return { x: w.x, y: w.y, k }; }); }

// path (world points) from hub to building b, and the reverse
function pathHubTo(hub, b, acc) {
  const p = pts(chain(hub.id, acc.k));
  return [{ ...centre(hub), k: null }, ...p, { ...centre(b), k: null }];
}

// A* over road tiles between two road tile keys -> list of keys
export function roadPath(fromK, toK) {
  if (fromK === toK) return [fromK];
  const [gq, gr] = parseKey(toK);
  const g = new Map([[fromK, 0]]), par = new Map([[fromK, null]]), heap = [[0, fromK]], closed = new Set();
  while (heap.length) {
    const [, k] = heapPop(heap);
    if (closed.has(k)) continue;
    if (k === toK) { const out = []; let c = k; while (c) { out.push(c); c = par.get(c); } return out.reverse(); }
    closed.add(k);
    const t = tileByKey(k);
    for (const n of roadNeighbors(t)) {
      const nk = key(n.q, n.r); if (closed.has(nk)) continue;
      const ng = g.get(k) + 1 / ROAD.speed[n.road - 1];
      if (!g.has(nk) || ng < g.get(nk)) { g.set(nk, ng); par.set(nk, k); heapPush(heap, [ng + hexDist(n.q, n.r, gq, gr) / 2.1, nk]); }
    }
  }
  return null;
}

export function isConnected(b) {
  for (const hub of activeHubs()) if (b === hub ? roadNeighbors(tileAt(b.q, b.r)).length > 0 : access(hub.id, b)) return true;
  return false;
}

// ---------- reservations ----------
const avail = (b, g) => (b.inv[g] || 0) - (b.resOut[g] || 0);
const add = (o, g, n) => { o[g] = (o[g] || 0) + n; if (Math.abs(o[g]) < 1e-6) delete o[g]; };
const invTotal = (b) => Object.values(b.inv).reduce((a, v) => a + v, 0);
const incomingTotal = (b) => Object.values(b.incoming).reduce((a, v) => a + v, 0);
export function hubFree(h) { return BUILDINGS.hub.cap[h.level - 1] - invTotal(h) - incomingTotal(h); }

export function consumerWants(b) {
  const d = def(b), res = [];
  if (!b.built) return res;
  if (d.kind === 'processor') {
    for (const [g, n] of Object.entries(d.recipe.in)) {
      const target = n * 4, want = target - (b.inv[g] || 0) - (b.incoming[g] || 0);
      if (want >= n) res.push([g, want]);
    }
  } else if (d.kind === 'harbor') {
    const { g, amt } = b.exp || {};
    if (g && amt > 0) {
      const target = Math.min(d.stock[b.level - 1], Math.max(8, amt * 2)), want = target - (b.inv[g] || 0) - (b.incoming[g] || 0);
      if (want >= Math.min(4, target / 3)) res.push([g, want]);
    }
  } else if (d.kind === 'store') {
    const sells = d.sells[b.level - 1], per = Math.floor(d.stock[b.level - 1] / sells.length);
    for (const g of sells) { const want = per - (b.inv[g] || 0) - (b.incoming[g] || 0); if (want >= Math.min(4, per / 3)) res.push([g, want]); }
  }
  return res;
}
export function producerOutputs(b) {
  const d = def(b);
  if (!b.built) return [];
  if (d.kind === 'producer') return [d.out];
  if (d.kind === 'processor') return Object.keys(d.recipe.out);
  return [];
}

// ---------- dispatch ----------
// How many more units of g this hub's own trucks may bring in. Without rules: up to 35% of capacity per good.
// With depot rules (hub.keep = { good: max }) only the listed goods, each up to its max.
export function hubRoomFor(hub, g) {
  const have = (hub.inv[g] || 0) + (hub.incoming[g] || 0);
  const lim = hub.keep ? (hub.keep[g] || 0) : BUILDINGS.hub.cap[hub.level - 1] * 0.35;
  return Math.min(lim - have, hubFree(hub));
}

// building → goods its route stops load / unload; free trucks leave those links to the routes
function routeCover() {
  const cov = {};
  for (const r of S.routes || []) {
    if (!S.trucks.some((t) => t.route === r.id)) continue; // a route without trucks covers nothing
    for (const st of r.stops) {
      const c = cov[st.b] || (cov[st.b] = { load: new Set(), unload: new Set() });
      for (const g of st.load) c.load.add(g);
      for (const g of st.unload) c.unload.add(g);
    }
  }
  return cov;
}
const covers = (cov, b, way, g) => { const c = cov[b.id]; return !!c && (c[way].has(g) || c[way].has('*')); };

function findJob(truck, hub, cov) {
  const lvl = hub.level - 1, cap = TRUCK.cap[lvl], W = PRIORITIES[hub.priority] || PRIORITIES.balanced;
  const hubs = activeHubs();
  let best = null;
  const consider = (score, job) => { if (score > 0 && (!best || score > best.score)) best = { score, ...job }; };
  // producers with spare output, per good (direct deliveries / cross-docking)
  const outs = {};
  for (const p of Object.values(S.buildings)) {
    for (const g of producerOutputs(p)) {
      if (covers(cov, p, 'load', g)) continue;
      const a = Math.floor(avail(p, g));
      if (a < 2) continue;
      const acc = access(hub.id, p); if (!acc) continue;
      (outs[g] = outs[g] || []).push({ p, a, acc });
    }
  }
  // pick the nearest source (hub stock or producer output) of good g for target b
  const source = (g, b, accHB) => {
    let s = null;
    for (const h of hubs) {
      if (avail(h, g) < 1) continue;
      const a2 = access(h.id, b); if (!a2) continue;
      let d = a2.d;
      if (h !== hub) { const hh = access(hub.id, h); if (!hh) continue; d += hh.d; }
      if (!s || d < s.d) s = { h, d, acc: a2 };
    }
    for (const o of outs[g] || []) {
      if (o.p === b) continue;
      const d = o.acc.d + hexDist(o.p.q, o.p.r, b.q, b.r) * 0.8 - accHB.d - 1; // net extra distance, favoured
      if (!s || d < s.d) s = { h: o.p, d: Math.max(0.5, d), direct: true };
    }
    return s;
  };
  for (const b of Object.values(S.buildings)) {
    if (b.type === 'hub' && b.built && !b.site) continue; // hubs only take goods while they are being upgraded
    const accHB = access(hub.id, b);
    if (!accHB) continue;
    // construction
    if (b.site) {
      // sites gain priority the longer they wait, so short supply runs can't starve construction forever
      const waitDays = Math.min(6, (S.time - (b.site.t0 ?? S.time)) / DAY);
      const urgency = 1 + waitDays * 0.25; // up to ×2.5 after 6 days
      for (const [g, n] of Object.entries(b.site.need)) {
        const rem = n - (b.site.got[g] || 0) - (b.site.incoming[g] || 0);
        if (rem <= 0) continue;
        const src = source(g, b, accHB); if (!src) continue;
        const amt = Math.min(rem, Math.floor(avail(src.h, g)), cap);
        if (amt < 1) continue;
        consider(W.con * urgency * (1 + amt / cap) / (src.d + accHB.d + 3), { kind: 'con', b, g, amt, src });
      }
    }
    // supply consumers
    for (const [g, want] of consumerWants(b)) {
      if (covers(cov, b, 'unload', g)) continue;
      const src = source(g, b, accHB); if (!src) continue;
      const amt = Math.min(Math.floor(want), Math.floor(avail(src.h, g)), cap);
      if (amt < 1) continue;
      consider(W.sup * (0.5 + amt / cap) / (src.d + accHB.d + 3), { kind: 'sup', b, g, amt, src });
    }
    // collect outputs
    const d = def(b);
    for (const g of producerOutputs(b)) {
      if (covers(cov, b, 'load', g)) continue;
      const have = Math.floor(avail(b, g)), bufCap = d.buf[b.level - 1];
      const thresh = Math.min(cap, Math.ceil(bufCap * 0.4));
      if (have < thresh && !(have > 0 && have >= bufCap - 1)) continue;
      const amt = Math.min(have, cap, Math.floor(hubRoomFor(hub, g)));
      if (amt < 1) continue;
      consider(W.col * (0.5 + amt / cap) / (2 * accHB.d + 3), { kind: 'col', b, g, amt });
    }
  }
  return best;
}

function assign(truck, hub, job) {
  const { b, g, amt } = job;
  const steps = [];
  if (job.kind === 'col') {
    const acc = access(hub.id, b);
    const p = pathHubTo(hub, b, acc);
    add(b.resOut, g, amt); add(hub.incoming, g, amt);
    steps.push({ a: 'move', path: p }, { a: 'load', from: b.id, g, amt }, { a: 'move', path: p.slice().reverse() }, { a: 'unload', to: hub.id, g, amt });
  } else {
    const src = job.src.h;
    add(src.resOut, g, amt);
    if (job.kind === 'con') add(b.site.incoming, g, amt); else add(b.incoming, g, amt);
    if (src !== hub) steps.push({ a: 'move', path: pathHubTo(hub, src, access(hub.id, src)) });
    steps.push({ a: 'load', from: src.id, g, amt });
    if (job.src.direct) {
      const a1 = access(hub.id, src), a2 = access(hub.id, b);
      const mid = roadPath(a1.k, a2.k) || [...chain(hub.id, a1.k).reverse(), ...chain(hub.id, a2.k)];
      steps.push({ a: 'move', path: [{ ...centre(src), k: null }, ...pts(mid), { ...centre(b), k: null }] });
    } else steps.push({ a: 'move', path: pathHubTo(src, b, job.src.acc) });
    steps.push({ a: job.kind === 'con' ? 'build' : 'unload', to: b.id, g, amt });
    const back = access(hub.id, b);
    steps.push({ a: 'move', path: pathHubTo(hub, b, back).reverse() });
  }
  C.day.trips[job.kind]++;
  truck.steps = steps; truck.si = 0; truck.pi = 0; truck.seg = 0; truck.wait = 0; truck.job = job.kind;
  const p0 = toWorld(hub.q, hub.r); truck.x = p0.x; truck.y = p0.y;
}

// release reservations of remaining steps (used when a truck is cancelled)
export function cancelTruck(truck) {
  if (!truck.steps) return;
  for (let i = truck.si; i < truck.steps.length; i++) {
    const st = truck.steps[i];
    if (st.a === 'load') { const f = S.buildings[st.from]; if (f) add(f.resOut, st.g, -st.amt); }
    if (st.a === 'unload') { const t = S.buildings[st.to]; if (t) add(t.incoming, st.g, -st.amt); }
    if (st.a === 'build') { const t = S.buildings[st.to]; if (t && t.site) add(t.site.incoming, st.g, -st.amt); }
  }
  const h = S.buildings[truck.hub];
  if (truck.cargo && h) add(h.inv, truck.cargo.g, truck.cargo.amt);
  if (truck.hold && h) for (const [g, n] of Object.entries(truck.hold)) add(h.inv, g, n); // route cargo goes back to the depot
  truck.steps = null; truck.cargo = null; truck.job = null; truck.hold = {}; truck.at = truck.hub;
}

export function cancelTrucksFor(bid) {
  for (const t of S.trucks) {
    if (!t.steps) continue;
    if (t.hub === bid || t.steps.some((st, i) => i >= t.si && (st.from === bid || st.to === bid))) cancelTruck(t);
  }
}

let dispatchT = 0;
// a hub being upgraded uses materials it already stores (no truck trip needed)
function selfSupply(hub) {
  const s = hub.site;
  for (const [g, n] of Object.entries(s.need)) {
    const rem = n - (s.got[g] || 0) - (s.incoming[g] || 0);
    const amt = Math.min(rem, Math.floor(avail(hub, g)));
    if (amt > 0) { add(hub.inv, g, -amt); add(s.got, g, amt); C.day.use[g] = (C.day.use[g] || 0) + amt; }
  }
}

export function tickLogistics(dt) {
  if (C.fieldsDirty) computeFields();
  for (const b of Object.values(S.buildings)) if (b.type === 'hub' && b.built && b.site) selfSupply(b);
  dispatchT -= dt;
  if (dispatchT <= 0) {
    dispatchT = 0.4;
    const cov = routeCover();
    for (const tr of S.trucks) {
      if (tr.steps) continue;
      const hub = S.buildings[tr.hub];
      if (!hub || !hub.built || !C.fields[hub.id]) continue;
      if (tr.route) { const r = S.routes.find((x) => x.id === tr.route); if (r) { routeLeg(tr, hub, r); continue; } tr.route = null; }
      const job = findJob(tr, hub, cov);
      if (job) assign(tr, hub, job);
    }
  }
  for (const tr of S.trucks) if (tr.steps) stepTruck(tr, dt);
}

function stepTruck(tr, dt) {
  const hub = S.buildings[tr.hub];
  if (!hub) { cancelTruck(tr); return; }
  const lvl = hub.level - 1;
  let st = tr.steps[tr.si];
  if (!st) { tr.steps = null; tr.job = null; return; }
  if (st.a === 'move') {
    let budget = TRUCK.speed[lvl] * TILE_W * dt;
    while (budget > 0 && tr.pi < st.path.length - 1) {
      const a = st.path[tr.pi], b = st.path[tr.pi + 1];
      const t = b.k ? tileByKey(b.k) : (a.k ? tileByKey(a.k) : null);
      const rs = t && t.road ? ROAD.speed[t.road - 1] : 1;
      const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const move = Math.min(budget * rs, segLen - tr.seg);
      tr.seg += move; budget -= move / rs;
      tr.h = Math.atan2(b.y - a.y, b.x - a.x);
      if (tr.seg >= segLen - 1e-6) { tr.pi++; tr.seg = 0; S.co2 += TRUCK.co2[lvl]; C.day.dist++; C.day.co2 += TRUCK.co2[lvl]; }
      const p = st.path[tr.pi], n = st.path[Math.min(tr.pi + 1, st.path.length - 1)], f = tr.seg / (Math.hypot(n.x - p.x, n.y - p.y) || 1);
      tr.x = p.x + (n.x - p.x) * f; tr.y = p.y + (n.y - p.y) * f;
    }
    if (tr.pi >= st.path.length - 1) { tr.si++; tr.pi = 0; tr.seg = 0; tr.wait = 0.4; }
    return;
  }
  if (tr.wait > 0) { tr.wait -= dt; return; }
  if (st.a === 'stop') { if (routeStop(tr, st)) { tr.steps = null; tr.job = null; } return; }
  if (st.a === 'load') {
    const f = S.buildings[st.from];
    if (!f) { cancelTruck(tr); return; }
    add(f.resOut, st.g, -st.amt);
    const got = Math.min(st.amt, f.inv[st.g] || 0);
    add(f.inv, st.g, -got);
    tr.cargo = { g: st.g, amt: got };
  } else if (st.a === 'unload' || st.a === 'build') {
    const t = S.buildings[st.to];
    const amt = tr.cargo ? tr.cargo.amt : 0;
    if (!t) { cancelTruck(tr); return; }
    if (st.a === 'build') {
      if (t.site) { add(t.site.incoming, st.g, -st.amt); add(t.site.got, st.g, amt); }
      else add(hub.inv, st.g, amt);
    } else { add(t.incoming, st.g, -st.amt); add(t.inv, st.g, amt); }
    if (amt) { emit('delivered', { b: t.id, g: st.g, amt }); C.day.moved += amt; if (st.a === 'build') C.day.use[st.g] = (C.day.use[st.g] || 0) + amt; }
    tr.cargo = null;
  }
  tr.si++; tr.pi = 0; tr.seg = 0;
  if (tr.si >= tr.steps.length) { tr.steps = null; tr.job = null; tr.at = tr.hub; } // free jobs end at the depot
}

// ---------- player routes ----------
// A route is a loop of stops run by the trucks assigned to it. Each stop names goods to unload and to load there.
// The truck drives stop to stop on the hub's road network; free trucks leave those links alone (see routeCover).
const holdTotal = (tr) => Object.values(tr.hold || {}).reduce((a, v) => a + v, 0);

// road path between two buildings, as world points (null if not connected to the hub's network)
export function legPath(hub, from, to) {
  const a = access(hub.id, from), b = access(hub.id, to);
  if (!a || !b) return null;
  const mid = roadPath(a.k, b.k);
  if (!mid) return null;
  return [{ ...centre(from), k: null }, ...pts(mid), { ...centre(to), k: null }];
}

function routeLeg(tr, hub, r) {
  if (!r.stops.length) return;
  if (!tr.hold) tr.hold = {};
  if (!(tr.rs < r.stops.length)) tr.rs = 0;
  const stop = r.stops[tr.rs], to = S.buildings[stop.b], from = S.buildings[tr.at] || hub;
  const path = to && legPath(hub, from, to);
  if (!path) { tr.rs = (tr.rs + 1) % r.stops.length; return; } // gone or cut off: skip it
  tr.steps = [{ a: 'move', path }, { a: 'stop', r: r.id, i: tr.rs }];
  tr.si = 0; tr.pi = 0; tr.seg = 0; tr.wait = 0; tr.job = 'route';
  const p0 = centre(from); tr.x = p0.x; tr.y = p0.y;
  if (C.day.trips.route === undefined) C.day.trips.route = 0;
  C.day.trips.route++;
}

// room for g at b when a route truck unloads there
export function unloadRoom(b, g) {
  const d = def(b), L = b.level - 1;
  if (b.site) return Math.max(0, (b.site.need[g] || 0) - (b.site.got[g] || 0) - (b.site.incoming[g] || 0));
  if (!b.built) return 0;
  if (d.kind === 'hub') return Math.max(0, hubFree(b));
  if (d.kind === 'store') return d.sells[L].includes(g) ? Math.max(0, Math.floor(d.stock[L] / d.sells[L].length) - (b.inv[g] || 0)) : 0;
  if (d.kind === 'processor') return d.recipe.in[g] ? Math.max(0, d.recipe.in[g] * 8 - (b.inv[g] || 0)) : 0;
  if (d.kind === 'harbor') return b.exp && b.exp.g === g ? Math.max(0, d.stock[L] - (b.inv[g] || 0)) : 0;
  return 0;
}

// unload, then load; returns false while waiting for a full load
function routeStop(tr, st) {
  const r = S.routes.find((x) => x.id === st.r), stop = r && r.stops[st.i], b = stop && S.buildings[stop.b];
  const hub = S.buildings[tr.hub], cap = TRUCK.cap[hub.level - 1];
  if (b) {
    for (const [g, n] of Object.entries(tr.hold)) {
      if (!stop.unload.includes(g) && !stop.unload.includes('*')) continue;
      const amt = Math.min(n, Math.floor(unloadRoom(b, g)));
      if (amt < 1) continue;
      add(tr.hold, g, -amt);
      if (b.site) { add(b.site.got, g, amt); C.day.use[g] = (C.day.use[g] || 0) + amt; } else add(b.inv, g, amt);
      emit('delivered', { b: b.id, g, amt }); C.day.moved += amt; r.moved = (r.moved || 0) + amt;
    }
    for (const g of stop.load) {
      const amt = Math.min(Math.floor(avail(b, g)), cap - holdTotal(tr));
      if (amt >= 1) { add(b.inv, g, -amt); add(tr.hold, g, amt); }
    }
    // wait for a full load (at most 2 days, so a dry source can't block the route forever)
    if (stop.full && stop.load.length && holdTotal(tr) < cap && (tr.waited || 0) < 2 * DAY) { tr.wait = 0.5; tr.waited = (tr.waited || 0) + 0.5; return false; }
    tr.at = b.id;
  }
  tr.waited = 0;
  tr.rs = (st.i + 1) % Math.max(1, r ? r.stops.length : 1);
  if (r && tr.rs === 0) { if (tr.loop0 !== undefined) r.loopT = (S.time - tr.loop0) / DAY; tr.loop0 = S.time; }
  return true;
}
