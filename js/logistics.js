// Road network distance fields, truck job dispatch and movement.
import { S, C, tileAt, tileByKey, roadNeighbors, def, emit } from './state.js';
import { BUILDINGS, ROAD, TRUCK, PRIORITIES } from './config.js';
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
function findJob(truck, hub) {
  const lvl = hub.level - 1, cap = TRUCK.cap[lvl], W = PRIORITIES[hub.priority] || PRIORITIES.balanced;
  const hubs = activeHubs();
  let best = null;
  const consider = (score, job) => { if (score > 0 && (!best || score > best.score)) best = { score, ...job }; };
  // producers with spare output, per good (direct deliveries / cross-docking)
  const outs = {};
  for (const p of Object.values(S.buildings)) {
    for (const g of producerOutputs(p)) {
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
    if (b.type === 'hub' && b.built) continue;
    const accHB = access(hub.id, b);
    if (!accHB) continue;
    // construction
    if (b.site) {
      for (const [g, n] of Object.entries(b.site.need)) {
        const rem = n - (b.site.got[g] || 0) - (b.site.incoming[g] || 0);
        if (rem <= 0) continue;
        const src = source(g, b, accHB); if (!src) continue;
        const amt = Math.min(rem, Math.floor(avail(src.h, g)), cap);
        if (amt < 1) continue;
        consider(W.con * (1 + amt / cap) / (src.d + accHB.d + 3), { kind: 'con', b, g, amt, src });
      }
    }
    // supply consumers
    for (const [g, want] of consumerWants(b)) {
      const src = source(g, b, accHB); if (!src) continue;
      const amt = Math.min(Math.floor(want), Math.floor(avail(src.h, g)), cap);
      if (amt < 1) continue;
      consider(W.sup * (0.5 + amt / cap) / (src.d + accHB.d + 3), { kind: 'sup', b, g, amt, src });
    }
    // collect outputs
    const d = def(b);
    for (const g of producerOutputs(b)) {
      const have = Math.floor(avail(b, g)), bufCap = d.buf[b.level - 1];
      const thresh = Math.min(cap, Math.ceil(bufCap * 0.4));
      if (have < thresh && !(have > 0 && have >= bufCap - 1)) continue;
      const free = Math.floor(hubFree(hub));
      const perGood = Math.floor(BUILDINGS.hub.cap[hub.level - 1] * 0.35 - (hub.inv[g] || 0) - (hub.incoming[g] || 0));
      const amt = Math.min(have, cap, free, perGood);
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
  if (truck.cargo) { const h = S.buildings[truck.hub]; if (h) add(h.inv, truck.cargo.g, truck.cargo.amt); }
  truck.steps = null; truck.cargo = null; truck.job = null;
}

export function cancelTrucksFor(bid) {
  for (const t of S.trucks) {
    if (!t.steps) continue;
    if (t.hub === bid || t.steps.some((st, i) => i >= t.si && (st.from === bid || st.to === bid))) cancelTruck(t);
  }
}

let dispatchT = 0;
export function tickLogistics(dt) {
  if (C.fieldsDirty) computeFields();
  dispatchT -= dt;
  if (dispatchT <= 0) {
    dispatchT = 0.4;
    for (const tr of S.trucks) {
      if (tr.steps) continue;
      const hub = S.buildings[tr.hub];
      if (!hub || !hub.built || !C.fields[hub.id]) continue;
      const job = findJob(tr, hub);
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
      if (tr.seg >= segLen - 1e-6) { tr.pi++; tr.seg = 0; S.co2 += TRUCK.co2[lvl]; }
      const p = st.path[tr.pi], n = st.path[Math.min(tr.pi + 1, st.path.length - 1)], f = tr.seg / (Math.hypot(n.x - p.x, n.y - p.y) || 1);
      tr.x = p.x + (n.x - p.x) * f; tr.y = p.y + (n.y - p.y) * f;
    }
    if (tr.pi >= st.path.length - 1) { tr.si++; tr.pi = 0; tr.seg = 0; tr.wait = 0.4; }
    return;
  }
  if (tr.wait > 0) { tr.wait -= dt; return; }
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
    if (amt) emit('delivered', { b: t.id, g: st.g, amt });
    tr.cargo = null;
  }
  tr.si++; tr.pi = 0; tr.seg = 0;
  if (tr.si >= tr.steps.length) { tr.steps = null; tr.job = null; }
}
