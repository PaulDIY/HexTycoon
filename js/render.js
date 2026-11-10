// Canvas renderer: affine ground pass (batched Path2D) + depth-sorted sprite stacks.
import { S, C, tileAt, def, roadNeighbors } from './state.js';
import { TERRAIN, ZONES, BUILDINGS } from './config.js';
import { toWorld, hexPath, SIZE, DIRS, hash2, key, fromWorld } from './hex.js';
import { Y_SCALE, H_SCALE, getSprite, resetBudget } from './stack.js';
import { MODELS } from './models.js';
import { isConnected } from './logistics.js';

export const V = {
  cx: 0, cy: 30, zoom: 1.7, angle: -0.35, W: 1, H: 1, dpr: 1,
  overlay: null, hover: null, selected: null, preview: [], previewOk: true, range: null,
};
let cv, ctx, ground = null;
const particles = [];

export function initRender(canvas) {
  cv = canvas; ctx = cv.getContext('2d');
  resize();
  addEventListener('resize', resize);
}
export function resize() {
  V.dpr = Math.min(2, devicePixelRatio || 1);
  V.W = Math.floor(cv.clientWidth * V.dpr); V.H = Math.floor(cv.clientHeight * V.dpr);
  cv.width = V.W; cv.height = V.H;
}

// ---------- transforms ----------
function M() {
  const Z = V.zoom * V.dpr, c = Math.cos(V.angle), s = Math.sin(V.angle);
  return [Z * c, Z * Y_SCALE * s, -Z * s, Z * Y_SCALE * c,
    V.W / 2 - Z * (c * V.cx - s * V.cy), V.H / 2 - Z * Y_SCALE * (s * V.cx + c * V.cy)];
}
export function worldToScreen(x, y, h = 0) {
  const m = M();
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5] - h * H_SCALE * V.zoom * V.dpr];
}
export function screenToWorld(px, py) { // px,py in CSS pixels
  const Z = V.zoom * V.dpr, c = Math.cos(V.angle), s = Math.sin(V.angle);
  const rx = (px * V.dpr - V.W / 2) / Z, ry = (py * V.dpr - V.H / 2) / (Z * Y_SCALE);
  return [c * rx + s * ry + V.cx, -s * rx + c * ry + V.cy];
}
export function screenToTile(px, py) {
  const [x, y] = screenToWorld(px, py);
  const [q, r] = fromWorld(x, y);
  return tileAt(q, r) || null;
}

// ---------- ground batches ----------
function buildGround() {
  const g = { terrain: {}, zones: {}, roads: [new Path2D(), new Path2D(), new Path2D()], roadDots: [new Path2D(), new Path2D(), new Path2D()],
    grid: new Path2D(), all: new Path2D(), unconnected: new Path2D() };
  for (const t of S.tiles) {
    const { x, y } = toWorld(t.q, t.r);
    const col = TERRAIN[t.terrain].colors[t.v];
    (g.terrain[col] = g.terrain[col] || new Path2D());
    hexPath(g.terrain[col], x, y, SIZE + 0.4);
    hexPath(g.all, x, y, SIZE + 0.4);
    if (t.terrain !== 'water') hexPath(g.grid, x, y, SIZE);
    if (t.zone) { const p = (g.zones[t.zone] = g.zones[t.zone] || new Path2D()); hexPath(p, x, y, SIZE - 2.5); }
    if (t.road) {
      const L = t.road - 1;
      g.roadDots[L].moveTo(x + 7, y); g.roadDots[L].arc(x, y, 7, 0, 6.2832);
      for (const n of roadNeighbors(t)) {
        if (n.q < t.q || (n.q === t.q && n.r < t.r)) continue;
        const w = toWorld(n.q, n.r), Lm = Math.min(t.road, n.road) - 1;
        g.roads[Lm].moveTo(x, y); g.roads[Lm].lineTo(w.x, w.y);
      }
    }
  }
  ground = g;
  C.groundDirty = false;
}

const ROAD_STYLE = [
  { edge: '#8a6d4a', fill: '#c2a476', w: 12 },
  { edge: '#4d555c', fill: '#727b83', w: 14, dash: '#e9e4d0' },
  { edge: '#4f9a42', fill: '#6b747c', w: 17, dash: '#cfe9c4' },
];

function drawGround(m) {
  if (!ground || C.groundDirty) buildGround();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const grd = ctx.createLinearGradient(0, 0, 0, V.H);
  grd.addColorStop(0, '#bfe3f0'); grd.addColorStop(1, '#8cc8de');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, V.W, V.H);
  // island slab (side walls)
  const thick = 14 * V.zoom * V.dpr;
  for (const [off, col] of [[thick, '#5d4a37'], [thick * 0.55, '#7a6246']]) {
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5] + off);
    ctx.fillStyle = col; ctx.fill(ground.all);
  }
  ctx.setTransform(...m);
  for (const [col, p] of Object.entries(ground.terrain)) { ctx.fillStyle = col; ctx.fill(p); }
  ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(40,60,20,0.10)'; ctx.stroke(ground.grid);
  for (const [z, p] of Object.entries(ground.zones)) {
    ctx.globalAlpha = 0.28; ctx.fillStyle = ZONES[z].color; ctx.fill(p);
    ctx.globalAlpha = 0.85; ctx.lineWidth = 1.4; ctx.strokeStyle = ZONES[z].color; ctx.stroke(p);
  }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let L = 0; L < 3; L++) {
    const st = ROAD_STYLE[L];
    ctx.strokeStyle = st.edge; ctx.lineWidth = st.w + 3; ctx.stroke(ground.roads[L]);
  }
  for (let L = 0; L < 3; L++) {
    const st = ROAD_STYLE[L];
    ctx.lineWidth = 3; ctx.strokeStyle = st.edge; ctx.stroke(ground.roadDots[L]);
    ctx.fillStyle = st.fill; ctx.fill(ground.roadDots[L]);
    ctx.strokeStyle = st.fill; ctx.lineWidth = st.w; ctx.stroke(ground.roads[L]);
    if (st.dash) { ctx.setLineDash([4, 5]); ctx.strokeStyle = st.dash; ctx.lineWidth = 1.1; ctx.stroke(ground.roads[L]); ctx.setLineDash([]); }
  }
}

function drawOverlays(m) {
  ctx.setTransform(...m);
  if (V.overlay === 'eco') {
    const bands = {};
    for (const [k, v] of C.poll) {
      if (Math.abs(v) < 0.15) continue;
      const lvl = Math.max(-4, Math.min(6, Math.round(v * 2) / 2));
      const t = C.tiles.get(k); const { x, y } = toWorld(t.q, t.r);
      hexPath((bands[lvl] = bands[lvl] || new Path2D()), x, y, SIZE - 1);
    }
    for (const [l, p] of Object.entries(bands)) {
      const v = +l;
      ctx.fillStyle = v > 0 ? `rgba(200,60,40,${Math.min(0.65, v * 0.12)})` : `rgba(40,170,80,${Math.min(0.55, -v * 0.14)})`;
      ctx.fill(p);
    }
  }
  if (V.range) {
    const p = new Path2D(), { q, r, rad, color } = V.range;
    for (let dq = -rad; dq <= rad; dq++) for (let dr = Math.max(-rad, -dq - rad); dr <= Math.min(rad, -dq + rad); dr++) {
      const t = tileAt(q + dq, r + dr); if (!t) continue; const { x, y } = toWorld(t.q, t.r); hexPath(p, x, y, SIZE - 1);
    }
    ctx.fillStyle = color; ctx.globalAlpha = 0.16; ctx.fill(p); ctx.globalAlpha = 1;
  }
  const hl = (t, col, w = 2.5) => { const p = new Path2D(); const { x, y } = toWorld(t.q, t.r); hexPath(p, x, y, SIZE - 1); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke(p); return p; };
  if (V.preview.length) {
    const p = new Path2D();
    for (const t of V.preview) { const { x, y } = toWorld(t.q, t.r); hexPath(p, x, y, SIZE - 1.5); }
    ctx.fillStyle = V.previewOk ? 'rgba(255,255,255,0.35)' : 'rgba(230,70,50,0.35)'; ctx.fill(p);
    ctx.lineWidth = 2; ctx.strokeStyle = V.previewOk ? '#ffffff' : '#e64632'; ctx.stroke(p);
  }
  if (V.hover && !V.preview.length) hl(V.hover, 'rgba(255,255,255,0.8)', 2);
  if (V.selected) {
    const b = S.buildings[V.selected];
    if (b) hl(tileAt(b.q, b.r), '#ffd84a', 3.5); else V.selected = null;
  }
}

// ---------- objects ----------
function spriteRes() {
  const z = V.zoom * V.dpr;
  return z > 2.2 ? 3 : z > 1.3 ? 2 : z > 0.7 ? 1 : 0.5;
}

export function frame(dt) {
  if (!S) return;
  resetBudget(V.rotating ? 10 : 30);
  const m = M();
  drawGround(m);
  drawOverlays(m);
  const res = spriteRes(), Z = V.zoom * V.dpr, objs = [];
  const c = Math.cos(V.angle), s = Math.sin(V.angle);
  const margin = 80 * Z;
  const push = (name, x, y, rot, extra) => {
    const sx = m[0] * x + m[2] * y + m[4], sy = m[1] * x + m[3] * y + m[5];
    if (sx < -margin || sx > V.W + margin || sy < -margin || sy > V.H + margin * 2.5) return;
    objs.push({ name, sx, sy, rot, depth: s * x + c * y, ...extra });
  };
  for (const t of S.tiles) {
    if (t.b) continue;
    if (t.terrain === 'forest') { const { x, y } = toWorld(t.q, t.r); push('forest' + ((t.q * 7 + t.r * 13) & 7), x, y, 0); }
    else if (t.terrain === 'hills') { const { x, y } = toWorld(t.q, t.r); push('hill' + ((t.q * 5 + t.r * 3) & 3), x, y, 0); }
  }
  for (const b of Object.values(S.buildings)) {
    const { x, y } = toWorld(b.q, b.r);
    const name = b.built ? b.type + b.level : 'site';
    push(name, x, y, b.rot * Math.PI / 3, { b });
  }
  for (const tr of S.trucks) {
    if (!tr.steps) continue;
    const hub = S.buildings[tr.hub]; if (!hub) continue;
    push('truck' + hub.level, tr.x, tr.y, tr.h, { truck: tr });
  }
  objs.sort((a, b) => a.depth - b.depth);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const k = Z / res;
  for (const o of objs) {
    const model = MODELS[o.name]; if (!model) continue;
    const sp = getSprite(o.name, model, V.angle + o.rot, res);
    if (!sp) continue;
    ctx.drawImage(sp.cv, o.sx - sp.ax * k, o.sy - sp.ay * k, sp.cv.width * k, sp.cv.height * k);
  }
  drawParticles(dt, m);
  drawIndicators(objs, Z);
}

// ---------- particles (smoke from polluting chimneys) ----------
let smokeT = 0;
function drawParticles(dt, m) {
  smokeT += dt;
  if (smokeT > 0.35) {
    smokeT = 0;
    for (const b of Object.values(S.buildings)) {
      if (!b.built) continue;
      const d = def(b);
      if (d.kind !== 'processor' || b.status !== 'ok' || b.level === 3) continue;
      if (particles.length > 160) break;
      const { x, y } = toWorld(b.q, b.r);
      const w = 22 + (b.level - 1) * 3, dd = 15 + (b.level - 1) * 2, ang = b.rot * Math.PI / 3;
      const lx = w / 2 - 3, ly = -dd / 2 + 3;
      particles.push({ x: x + lx * Math.cos(ang) - ly * Math.sin(ang), y: y + lx * Math.sin(ang) + ly * Math.cos(ang), h: 10 + (b.level - 1) * 2 + 11, life: 0, dark: b.level === 1 });
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const Z = V.zoom * V.dpr;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt; p.h += dt * 6; p.x += dt * 4; p.y += dt * 2;
    if (p.life > 2.6) { particles.splice(i, 1); continue; }
    const sx = m[0] * p.x + m[2] * p.y + m[4], sy = m[1] * p.x + m[3] * p.y + m[5] - p.h * H_SCALE * Z;
    const a = 0.45 * (1 - p.life / 2.6);
    ctx.fillStyle = p.dark ? `rgba(90,90,90,${a})` : `rgba(200,200,200,${a})`;
    ctx.beginPath(); ctx.arc(sx, sy, (2 + p.life * 3) * Z, 0, 6.2832); ctx.fill();
  }
}

// ---------- indicators (progress bars, warnings) ----------
function drawIndicators(objs, Z) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sz = Math.max(14, 13 * Z);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(sz * 0.8)}px system-ui, sans-serif`;
  for (const o of objs) {
    const b = o.b; if (!b) continue;
    const top = o.sy - 34 * Z * H_SCALE;
    if (b.site) {
      const need = Object.values(b.site.need).reduce((a, v) => a + v, 0) || 1;
      const got = Object.values(b.site.got).reduce((a, v) => a + v, 0);
      const f = need ? Math.min(1, got / need) * 0.8 + b.site.progress * 0.2 : b.site.progress;
      const w = 30 * Z, h = Math.max(4, 3.5 * Z);
      ctx.fillStyle = 'rgba(30,40,30,0.7)'; ctx.fillRect(o.sx - w / 2 - 1, top - 1, w + 2, h + 2);
      ctx.fillStyle = b.site.upgrade ? '#ffd84a' : '#7fd16b'; ctx.fillRect(o.sx - w / 2, top, w * f, h);
    }
    let icon = null;
    if (!isConnected(b)) icon = '🚧';
    else if (b.built && b.status === 'idle') icon = '❔';
    else if (b.built && b.status === 'noinput') icon = '⏳';
    else if (b.built && b.status === 'full' && Z > 0.8) icon = '📦';
    else if (b.built && b.type === 'house' && b.happy < 30) icon = '☹️';
    if (icon) {
      const y = top - sz * 0.9;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(o.sx, y, sz * 0.62, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#000'; ctx.fillText(icon, o.sx, y + 1);
    }
  }
}

export function centerOn(q, r) { const { x, y } = toWorld(q, r); V.cx = x; V.cy = y; }
