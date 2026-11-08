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
    const k = e.key.toLowerCase();
    if (k === 'q') rotateBy(-0.12); else if (k === 'e') rotateBy(0.12);
    else if (k === 'w' || k === 'arrowup') panBy(0, 40); else if (k === 's' || k === 'arrowdown') panBy(0, -40);
    else if (k === 'a' || k === 'arrowleft') panBy(40, 0); else if (k === 'd' || k === 'arrowright') panBy(-40, 0);
    else if (k === '+' || k === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.15);
    else if (k === '-') zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.15);
    else if (k === 'escape') h.escape();
    else if (k === ' ') { e.preventDefault(); h.togglePause(); }
  });
}

function gestureInfo() {
  const [a, b] = [...ptrs.values()];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
}
