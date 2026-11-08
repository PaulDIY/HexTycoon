// Sprite-stacking renderer: models are lists of primitive shapes that are sliced
// horizontally and drawn bottom-to-top with a vertical offset, rotated with the camera.
// Composites are cached per (model, angle bucket, resolution).
export const Y_SCALE = 0.62;   // ground squash (camera tilt)
export const H_SCALE = 0.85;   // how tall 1 world unit of height appears
const ANGLE_STEPS = 72;

const cache = new Map();
const MAX_CACHE = 320;
let budget = 0;
export function resetBudget(n = 24) { budget = n; }

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 1) { r *= f; g *= f; b *= f; } else { const t = f - 1; r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// shape: [type, x, y, a, b, z0, h, color]
//  box:   a=w, b=d          cyl: a=r         cone: a=r (tapers to 0)
//  sph:   a=r (ellipsoid)   gable: a=w, b=d (ridge along x)   pyr: a=w, b=d (tapers both)
function bounds(shapes) {
  let rad = 4, top = 1;
  for (const s of shapes) {
    const [t, x, y, a, b] = s, z1 = s[5] + s[6];
    const ext = (t === 'box' || t === 'gable' || t === 'pyr') ? Math.hypot(a / 2, b / 2) : a;
    rad = Math.max(rad, Math.hypot(x, y) + ext);
    top = Math.max(top, z1);
  }
  return { rad: Math.ceil(rad + 2), top: Math.ceil(top + 1) };
}

export function makeModel(shapes, opts = {}) {
  return { shapes, ...bounds(shapes), shadow: opts.shadow !== false };
}

function drawSection(ctx, s, z) {
  const [t, x, y, a, b, z0, h, col] = s;
  if (z < z0 || z > z0 + h) return;
  const f = h > 0 ? (z - z0) / h : 1;
  const top = z0 + h - z < 0.75;
  let fill;
  switch (t) {
    case 'box':
      fill = top ? shade(col, 1.08) : shade(col, 0.62 + 0.18 * f);
      ctx.fillStyle = fill; ctx.fillRect(x - a / 2, y - b / 2, a, b); return;
    case 'cyl':
      fill = top ? shade(col, 1.08) : shade(col, 0.62 + 0.18 * f);
      ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, a, 0, 6.2832); ctx.fill(); return;
    case 'cone': {
      const r = a * (1 - f); if (r <= 0.2) return;
      ctx.fillStyle = shade(col, 0.7 + 0.4 * f); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); return;
    }
    case 'sph': {
      const r = a * Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)); if (r <= 0.2) return;
      ctx.fillStyle = shade(col, 0.68 + 0.45 * f); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); return;
    }
    case 'gable': {
      const d = b * (1 - f); if (d <= 0.2) return;
      ctx.fillStyle = shade(col, 0.75 + 0.35 * f); ctx.fillRect(x - a / 2, y - d / 2, a, d); return;
    }
    case 'pyr': {
      const w = a * (1 - f), d = b * (1 - f); if (w <= 0.2) return;
      ctx.fillStyle = shade(col, 0.75 + 0.35 * f); ctx.fillRect(x - w / 2, y - d / 2, w, d); return;
    }
  }
}

function render(model, angle, res) {
  const { rad, top, shapes } = model;
  const W = Math.ceil(rad * 2 * res) + 4;
  const groundH = rad * 2 * Y_SCALE;
  const H = Math.ceil((groundH + top * H_SCALE) * res) + 4;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const ax = W / 2, ay = H - 2 - rad * Y_SCALE * res;
  const c = Math.cos(angle), s = Math.sin(angle);
  const setT = (z) => ctx.setTransform(res * c, res * Y_SCALE * s, -res * s, res * Y_SCALE * c, ax, ay - z * H_SCALE * res);
  if (model.shadow) {
    // soft shadow cast towards world +x/+y (sun fixed in world space)
    setT(0);
    ctx.fillStyle = 'rgba(30,50,20,0.22)';
    const off = Math.min(top * 0.35, 9);
    for (const sh of shapes) {
      if (sh[5] > 2) continue;
      const [t, x, y, a, b] = sh;
      ctx.beginPath();
      if (t === 'box' || t === 'gable' || t === 'pyr') ctx.rect(x - a / 2 + off * 0.6, y - b / 2 + off * 0.4, a, b);
      else ctx.arc(x + off * 0.6, y + off * 0.4, a, 0, 6.2832);
      ctx.fill();
    }
  }
  const step = Math.max(0.25, 1.1 / (H_SCALE * res));
  for (let z = 0; z <= top; z += step) {
    setT(z);
    for (const sh of shapes) drawSection(ctx, sh, z);
  }
  return { cv, ax, ay, res };
}

export function bucket(angle) {
  const a = ((angle % 6.2832) + 6.2832) % 6.2832;
  return Math.round(a / 6.2832 * ANGLE_STEPS) % ANGLE_STEPS;
}

// returns composite (or null when over budget and nothing cached)
export function getSprite(name, model, angle, res) {
  const bk = bucket(angle);
  const k = name + '|' + bk + '|' + res;
  let e = cache.get(k);
  if (e) { cache.delete(k); cache.set(k, e); return e; }
  if (budget <= 0) {
    // fall back to any cached angle of this model at this res
    for (let d = 1; d < 6; d++) {
      for (const bb of [bk + d, bk - d]) {
        const f = cache.get(name + '|' + ((bb + ANGLE_STEPS) % ANGLE_STEPS) + '|' + res);
        if (f) return f;
      }
    }
    return null;
  }
  budget--;
  e = render(model, bk / ANGLE_STEPS * 6.2832, res);
  cache.set(k, e);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return e;
}

export function clearSpriteCache() { cache.clear(); }
