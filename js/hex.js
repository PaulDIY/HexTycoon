// Pointy-top axial hex math.
export const SIZE = 24;
export const SQ3 = Math.sqrt(3);
export const TILE_W = SIZE * SQ3; // distance between neighbouring centres
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const key = (q, r) => q + ',' + r;
export const parseKey = (k) => { const i = k.indexOf(','); return [+k.slice(0, i), +k.slice(i + 1)]; };

export function toWorld(q, r) {
  return { x: SIZE * SQ3 * (q + r / 2), y: SIZE * 1.5 * r };
}

export function roundHex(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return [q, r];
}

export function fromWorld(x, y) {
  const q = (SQ3 / 3 * x - y / 3) / SIZE;
  const r = (2 / 3 * y) / SIZE;
  return roundHex(q, r);
}

export function hexDist(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
}

export function hexLine(q1, r1, q2, r2) {
  const n = hexDist(q1, r1, q2, r2);
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    out.push(roundHex(q1 + (q2 - q1) * t + 1e-6, r1 + (r2 - r1) * t + 1e-6));
  }
  return out;
}

export function corners(x, y, size = SIZE) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([x + size * Math.cos(a), y + size * Math.sin(a)]);
  }
  return pts;
}

export function hexPath(path, x, y, size = SIZE) {
  const c = corners(x, y, size);
  path.moveTo(c[0][0], c[0][1]);
  for (let i = 1; i < 6; i++) path.lineTo(c[i][0], c[i][1]);
  path.closePath();
}

// deterministic hash -> [0,1)
export function hash2(a, b, seed = 0) {
  let h = (a * 374761393 + b * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
