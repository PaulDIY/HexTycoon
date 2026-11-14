// Touch + mouse input: 1-finger pan / paint, 2-finger pan-zoom-rotate, wheel zoom, keyboard.
import { V, screenToWorld, screenToTile } from './render.js';
import { Y_SCALE } from './stack.js';
import { MAP_RADIUS } from './config.js';
import { SIZE } from './hex.js';

const ptrs = new Map();
let mode = 'none', h = null, gest = null, downT = 0, rotTimer = 0;

export function zoomAt(px, py, factor) {
  const [x0, y0] = screenToWorld(px, py);
  V.zoom = Math.max(0.35, Math.min(3.2, V.zoom * factor));
  const [x1, y1] = screenToWorld(px, py);
  V.cx += x0 - x1; V.cy += y0 - y1; clampCam();
}
export function rotateBy(da, px = innerWidth / 2, py = innerHeight / 2) {
  const [x0, y0] = screenToWorld(px, py);
  V.angle += da;
  const [x1, y1] = screenToWorld(px, py);
  V.cx += x0 - x1; V.cy += y0 - y1;
  V.rotating = true; clearTimeout(rotTimer); rotTimer = setTimeout(() => (V.rotating = false), 250);
}
function panBy(dx, dy) {
  const c = Math.cos(V.angle), s = Math.sin(V.angle);
  const rx = dx / V.zoom, ry = dy / (V.zoom * Y_SCALE);
  V.cx -= c * rx + s * ry; V.cy -= -s * rx + c * ry; clampCam();
}
function clampCam() {
  const lim = MAP_RADIUS * SIZE * 1.6, d = Math.hypot(V.cx, V.cy);
  if (d > lim) { V.cx *= lim / d; V.cy *= lim / d; }
}

export function initInput(canvas, handlers) {
  h = handlers;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, btn: e.button, type: e.pointerType });
    if (ptrs.size === 1) {
      downT = performance.now();
      mode = e.button === 1 || e.button === 2 ? 'pan' : 'pending';
    } else if (ptrs.size === 2) {
      if (mode === 'paint') h.paintCancel();
      mode = 'gesture'; gest = gestureInfo();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse') h.hover(screenToTile(e.clientX, e.clientY)); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (mode === 'pending') {
      const moved = Math.hypot(p.x - p.sx, p.y - p.sy);
      const lag = performance.now() - downT;
      if (moved > 8 && (p.type === 'mouse' || lag > 90)) {
        if (h.paints()) { mode = 'paint'; h.paintStart(screenToTile(p.sx, p.sy)); h.paintMove(screenToTile(p.x, p.y)); }
        else mode = 'pan';
      }
    } else if (mode === 'pan') panBy(dx, dy);
    else if (mode === 'paint') h.paintMove(screenToTile(p.x, p.y));
    else if (mode === 'gesture' && ptrs.size >= 2) {
      const g = gestureInfo();
      panBy(g.cx - gest.cx, g.cy - gest.cy);
      if (gest.d > 10) zoomAt(g.cx, g.cy, g.d / gest.d);
      let da = g.a - gest.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) < 0.5) rotateBy(da, g.cx, g.cy);
      gest = g;
    }
    if (e.pointerType === 'mouse') h.hover(screenToTile(e.clientX, e.clientY));
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (mode === 'pending' && performance.now() - downT < 600) h.tap(screenToTile(p.x, p.y));
    else if (mode === 'paint') h.paintEnd();
    if (ptrs.size === 0) mode = 'none';
    else if (mode === 'gesture') { mode = 'none-wait'; }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { if (mode === 'paint') h.paintCancel(); ptrs.delete(e.pointerId); if (!ptrs.size) mode = 'none'; });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size) h.hover(null); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k in HOLD) { held.add(HOLD[k]); if (k.startsWith('arrow')) e.preventDefault(); }
    else if (k === 'escape') h.escape();
    else if (k === ' ') { e.preventDefault(); h.togglePause(); }
  });
  addEventListener('keyup', (e) => { const a = HOLD[e.key.toLowerCase()]; if (a) held.delete(a); });
  addEventListener('blur', () => held.clear()); // don't keep scrolling after alt-tab
}

// ---------- smooth held-key camera ----------
// Keys set a target velocity; the actual velocity eases toward it so motion starts and stops softly.
const HOLD = {
  w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
  q: 'rotL', e: 'rotR', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut',
};
const held = new Set();
const vel = { x: 0, y: 0, rot: 0, zoom: 0 };
const KEY_PAN = 900, KEY_ROT = 1.8, KEY_ZOOM = 1.6, EASE = 12; // px/s, rad/s, log-zoom/s, 1/s

export function updateKeys(dt) {
  const on = (a) => (held.has(a) ? 1 : 0);
  let tx = on('left') - on('right'), ty = on('up') - on('down');
  if (tx && ty) { tx *= Math.SQRT1_2; ty *= Math.SQRT1_2; } // diagonals aren't faster
  const k = 1 - Math.exp(-EASE * dt);
  vel.x += (tx * KEY_PAN - vel.x) * k;
  vel.y += (ty * KEY_PAN - vel.y) * k;
  vel.rot += ((on('rotR') - on('rotL')) * KEY_ROT - vel.rot) * k;
  vel.zoom += ((on('zoomIn') - on('zoomOut')) * KEY_ZOOM - vel.zoom) * k;
  if (Math.abs(vel.x) + Math.abs(vel.y) > 0.5) panBy(vel.x * dt, vel.y * dt); else vel.x = vel.y = 0;
  if (Math.abs(vel.rot) > 0.002) rotateBy(vel.rot * dt); else vel.rot = 0;
  if (Math.abs(vel.zoom) > 0.002) zoomAt(innerWidth / 2, innerHeight / 2, Math.exp(vel.zoom * dt)); else vel.zoom = 0;
}

function gestureInfo() {
  const [a, b] = [...ptrs.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
}
