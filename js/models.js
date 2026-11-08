// Procedural sprite-stack models. Shapes: [type, x, y, a, b, z0, h, color]
import { makeModel } from './stack.js';
import { hash2 } from './hex.js';

const box = (x, y, w, d, z0, h, c) => ['box', x, y, w, d, z0, h, c];
const cyl = (x, y, r, z0, h, c) => ['cyl', x, y, r, 0, z0, h, c];
const cone = (x, y, r, z0, h, c) => ['cone', x, y, r, 0, z0, h, c];
const sph = (x, y, r, z0, h, c) => ['sph', x, y, r, 0, z0, h, c];
const gable = (x, y, w, d, z0, h, c) => ['gable', x, y, w, d, z0, h, c];
const pyr = (x, y, w, d, z0, h, c) => ['pyr', x, y, w, d, z0, h, c];

const P = {
  wall: '#efe2c6', wall2: '#e6d6b9', roof: '#c75b3d', roof2: '#a9473a', wood: '#9a6a3c', dark: '#5b3b22',
  stone: '#a3a39b', glass: '#8cc5df', solar: '#2d4f7d', green: '#5fae55', leaf: '#4f9a42', leaf2: '#67b04a',
  trunk: '#7a5232', metal: '#8b98a3', concrete: '#c9c8c0', soil: '#9b7446', water: '#5aa6cf',
};

const tree = (x, y, s = 1, c = P.leaf) => [cyl(x, y, 0.9 * s, 0, 4 * s, P.trunk), sph(x, y, 4.2 * s, 2.6 * s, 7.5 * s, c)];
const pine = (x, y, s = 1) => [cyl(x, y, 0.8 * s, 0, 3 * s, P.trunk), cone(x, y, 4.2 * s, 2.5 * s, 11 * s, '#3f7f3c')];
const solarRow = (x, y, w, d, z) => [box(x, y, w, d, z, 0.8, P.solar), box(x, y, w + 0.6, 0.4, z + 0.8, 0.2, '#a9c4e6')];
const crates = (x, y, c = P.wood) => [box(x, y, 3, 3, 0, 3, c), box(x + 3.2, y, 3, 3, 0, 3, c), box(x + 1.6, y, 3, 3, 3, 3, c)];

// ---- houses ----
const house = [
  () => [box(0, 0, 16, 13, 0, 8, P.wall), gable(0, 0, 18, 15, 8, 7, P.roof), box(5, -3, 2.4, 2.4, 9, 6, '#8a6a5a'),
    box(0, 6.7, 3, 0.6, 0, 5, '#7a4f2e'), box(-5, 6.7, 3, 0.5, 3, 3, P.glass), box(5, 6.7, 3, 0.5, 3, 3, P.glass), ...tree(-11, 8, 0.7)],
  () => [box(0, -2, 20, 14, 0, 14, P.wall2), gable(0, -2, 22, 16, 14, 8, P.roof2), box(-7, 8, 8, 6, 0, 8, P.wall),
    gable(-7, 8, 9, 7, 8, 4, P.roof), box(6, -2, 2.4, 2.4, 16, 7, '#8a6a5a'),
    box(-3, 5.2, 3, 0.5, 9, 3, P.glass), box(5, 5.2, 3, 0.5, 9, 3, P.glass), box(5, 5.2, 3, 0.5, 3, 3, P.glass), ...tree(10, 9, 0.8)],
  () => [box(0, 0, 24, 18, 0, 26, '#e3e9e5'),
    ...[7, 14, 21].map((z) => box(0, 9.6, 22, 2, z, 0.9, '#6aa84f')),
    ...[7, 14, 21].map((z) => box(0, 9.4, 18, 0.6, z + 1.2, 2.6, P.glass)),
    box(0, 0, 24, 18, 26, 1.4, '#79b95e'), ...solarRow(-5, -4, 8, 6, 27.4), ...solarRow(5, -4, 8, 6, 27.4),
    sph(6, 4, 3, 27.4, 5, P.leaf2), sph(-6, 5, 2.5, 27.4, 4, P.leaf), ...tree(-13, 11, 0.8), ...tree(13, 10, 0.7)],
];

// ---- stores ----
const store = [
  () => [box(0, 0, 14, 9, 0, 5, '#c9a36b'), ...[-6, -2, 2, 6].map((x, i) => box(x, 0, 4, 12, 9, 1, i % 2 ? '#f4efe6' : '#e05a47')),
    cyl(-6.5, 5, 0.5, 0, 9, P.wood), cyl(6.5, 5, 0.5, 0, 9, P.wood), cyl(-6.5, -5, 0.5, 0, 9, P.wood), cyl(6.5, -5, 0.5, 0, 9, P.wood),
    box(-3, 0, 3, 3, 5, 1.5, '#e9c94e'), box(2, 0, 3, 3, 5, 1.5, '#e07b39'), ...crates(-11, 8)],
  () => [box(0, 0, 22, 16, 0, 11, '#f1ead9'), box(0, 0, 23, 17, 11, 1.2, '#7a8088'), box(0, 8.6, 12, 0.8, 8, 3, '#3a8fd6'),
    box(0, 9.6, 18, 2.4, 6, 0.8, '#e05a47'), box(-5, 8.3, 5, 0.5, 1, 4.5, P.glass), box(5, 8.3, 5, 0.5, 1, 4.5, P.glass),
    box(-6, -3, 4, 4, 12.2, 2, P.metal), ...crates(9, 10)],
  () => [box(0, 0, 28, 22, 0, 14, '#d4e7ee'), ...[3, 7, 11].map((z) => box(0, 11.2, 26, 0.5, z, 2.4, P.glass)),
    box(0, 0, 28, 22, 14, 1.5, '#6db55a'), sph(-7, -4, 3.5, 15.5, 6, P.leaf2), sph(6, 3, 3, 15.5, 5, P.leaf), sph(-2, 6, 2.6, 15.5, 4, P.leaf2),
    ...solarRow(7, -6, 9, 5, 15.5), box(0, 12, 8, 2, 0, 6, '#3a8fd6'), ...tree(-15, 12, 0.7), ...tree(15, 12, 0.7)],
];

// ---- farms ----
function field(color, rowColor, lvl, extra = []) {
  const n = 5 + lvl;
  const w = 26 + lvl * 2, rows = [];
  for (let i = 0; i < n; i++) rows.push(box(-w / 2 + (i + 0.5) * (w / n), 2, w / n * 0.55, 20, 0.6, 1.6 + lvl * 0.3, i % 2 ? color : rowColor));
  return [box(0, 2, w, 22, 0, 0.6, P.soil), ...rows, ...extra];
}
const barn = (x, y, s) => [box(x, y, 9 * s, 7 * s, 0, 6 * s, '#b23a2e'), gable(x, y, 10 * s, 8 * s, 6 * s, 4 * s, '#5d4a3f'), box(x, y + 3.6 * s, 3 * s, 0.4, 0, 4 * s, '#f2eadb')];
const silo = (x, y) => [cyl(x, y, 3, 0, 14, '#cfd4d6'), sph(x, y, 3, 12, 5, '#b9c0c4')];
const turbine = (x, y) => [cyl(x, y, 0.8, 0, 26, '#f4f4f4'), box(x, y, 1, 1, 18, 16, '#ffffff'), box(x, y, 14, 1, 25.5, 1, '#ffffff'), box(x, y, 1.6, 2.4, 25, 2, '#e9e9e9')];
const greenhouse = (x, y, w) => [box(x, y, w, 8, 0, 5, '#bfe3ef'), gable(x, y, w, 8, 5, 3, '#d9f0f7')];
const cropSet = (c1, c2, extra) => [
  () => field(c1, c2, 0, [...barn(-12, -10, 0.8)]),
  () => field(c1, c2, 1, [...barn(-12, -10, 1), ...silo(11, -10), ...(extra ? extra(1) : [])]),
  () => field(c1, c2, 2, [...barn(-12, -10, 1), ...silo(11, -10), ...turbine(14, 10), ...(extra ? extra(2) : [])]),
];
const farm_grain = cropSet('#e9c94e', '#d8b23d');
const farm_veg = cropSet('#4f9a3c', '#e07b39', (l) => greenhouse(0, -12, l === 2 ? 16 : 10));
const farm_cotton = cropSet('#f4f4ee', '#7aa65a');

// ---- lumber / mining ----
const logs = (x, y, n = 3) => { const o = []; for (let i = 0; i < n; i++) o.push(box(x, y + (i % 2) * 0.6, 10, 2.2, i * 2, 2, i % 2 ? '#a9773f' : '#8e5f30')); return o; };
const lumber = [
  () => [box(-6, -5, 10, 8, 0, 6, '#8a5a32'), gable(-6, -5, 11, 9, 6, 4, P.dark), ...logs(6, 6, 3), ...pine(10, -8), ...pine(-12, 8, 0.9)],
  () => [box(-7, -5, 13, 9, 0, 8, '#8a5a32'), gable(-7, -5, 14, 10, 8, 5, P.dark), ...logs(6, 5, 4), ...logs(6, 10, 2), box(10, -6, 6, 4, 0, 3, P.metal), ...pine(-12, 9), ...pine(13, -11, 0.8)],
  () => [box(-7, -5, 13, 9, 0, 8, '#8a5a32'), gable(-7, -5, 14, 10, 8, 5, '#6ea64e'), ...logs(7, 6, 4),
    ...[-12, -8, -4].flatMap((x) => [cyl(x, 9, 0.4, 0, 2, P.trunk), sph(x, 9, 1.6, 1.4, 3, P.leaf2)]), ...pine(13, -10), ...pine(-14, 0, 0.8), ...solarRow(-7, -5, 8, 5, 13)],
];
const quarry = [
  () => [box(0, 2, 24, 18, 0, 0.6, '#7c7468'), pyr(-6, 0, 10, 8, 0, 6, '#9a958c'), pyr(6, 4, 8, 7, 0, 4, '#8d877d'), box(6, -6, 4, 4, 0, 4, P.stone), box(6, -6, 4, 4, 4, 2, '#b4b3ab')],
  () => [box(0, 2, 26, 20, 0, 0.6, '#7c7468'), pyr(-7, 0, 11, 9, 0, 7, '#9a958c'), ...[0, 4].map((x) => box(4 + x, -6, 4, 4, 0, 4, P.stone)),
    cyl(11, 8, 0.8, 0, 16, '#e1b33b'), box(5, 8, 13, 1.2, 15, 1.2, '#e1b33b'), box(-1, 8, 1, 1, 9, 6, '#555')],
  () => [box(0, 2, 26, 20, 0, 0.6, '#867f70'), pyr(-7, 0, 11, 9, 0, 7, '#9a958c'), box(6, -6, 8, 4, 0, 4, P.stone),
    ...solarRow(7, 7, 8, 5, 2), ...tree(-12, 10, 0.8), ...tree(12, -11, 0.7), sph(-12, -9, 3, 0, 3, P.leaf2)],
];
const claypit = [
  () => [box(0, 2, 22, 18, 0, 0.6, '#9a6b46'), sph(-5, 0, 5, 0, 3, '#b07a50'), cyl(7, -5, 3, 0, 6, '#9b4b33'), cone(7, -5, 3, 6, 3, '#7c3b28')],
  () => [box(0, 2, 24, 20, 0, 0.6, '#9a6b46'), sph(-6, 0, 6, 0, 4, '#b07a50'), cyl(8, -5, 3.5, 0, 9, '#9b4b33'), cyl(8, -5, 1, 9, 6, '#555'), box(4, 8, 8, 4, 0, 3, '#b5523b')],
  () => [box(0, 2, 24, 20, 0, 0.6, '#9a6b46'), cyl(-6, 2, 6, 0, 0.9, P.water), sph(-11, -4, 2, 0, 3, P.leaf2), cyl(8, -5, 3.5, 0, 9, '#9b4b33'), ...solarRow(8, 8, 8, 5, 1)],
];

// ---- factories ----
function factory(accent, lvl) {
  const w = 22 + lvl * 3, d = 15 + lvl * 2, h = 10 + lvl * 2;
  const roofC = lvl === 2 ? P.solar : '#8e8a84';
  const out = [box(0, 0, w, d, 0, h, lvl === 2 ? '#e2ebe1' : '#d9d2c5'), box(0, d / 2 + 0.3, w * 0.6, 0.6, 1, 3, accent)];
  const n = 3;
  for (let i = 0; i < n; i++) out.push(gable(0, -d / 2 + (i + 0.5) * (d / n), w, d / n, h, 3.5, roofC));
  if (lvl < 2) out.push(cyl(w / 2 - 3, -d / 2 + 3, 1.8, h, 10, '#8b6f5e'), cyl(w / 2 - 3, -d / 2 + 3, 2.2, h + 9, 1.2, '#6d5446'));
  if (lvl === 1) out.push(cyl(-w / 2 - 3, d / 2 - 2, 3, 0, 9, '#c7ccd0'), cyl(-w / 2 + 3, -d / 2 - 2, 2.4, 0, 7, accent));
  if (lvl === 2) out.push(...tree(-w / 2 - 2, d / 2 + 2, 0.8), ...tree(w / 2 + 1, d / 2 + 3, 0.7), box(-w / 2 - 1, -d / 2, 3, 3, 0, 2, '#6ab04c'));
  if (lvl === 0) out.push(...crates(-w / 2 + 2, d / 2 + 4, accent));
  return out;
}
const fac = (accent) => [0, 1, 2].map((l) => () => factory(accent, l));

// ---- hub ----
const containers = (x, y, cs) => cs.map((c, i) => box(x, y + i * 3.3, 10, 3, 0, 3, c));
const hub = [
  () => [box(0, 0, 28, 20, 0, 10, '#d8c9a8'), gable(0, 0, 30, 22, 10, 6, '#6d7b88'),
    ...[-8, 0, 8].map((x) => box(x, 10.3, 5, 0.6, 0, 6, '#5b6670')), ...crates(-14, 13)],
  () => [box(-2, 0, 30, 22, 0, 12, '#d9cfb8'), gable(-2, 0, 32, 24, 12, 7, '#56636e'), ...[-10, -2, 6].map((x) => box(x, 11.3, 5, 0.6, 0, 7, '#5b6670')),
    ...containers(15, -8, ['#d24d3c', '#3a7fc4', '#e1b33b', '#4c9a5a', '#d24d3c'])],
  () => [box(-2, 0, 30, 22, 0, 12, '#e2ebe4'), gable(-2, 0, 32, 24, 12, 7, P.solar), ...[-10, -2, 6].map((x) => box(x, 11.3, 5, 0.6, 0, 7, '#4b8f5a')),
    ...[ -12, -6, 0].map((x) => box(x, 15, 1.4, 1, 0, 3.2, '#5fbf6a')), ...containers(15, -8, ['#4c9a5a', '#3a7fc4', '#4c9a5a', '#e1b33b']), ...tree(16, 12, 0.8)],
];

// ---- park ----
const park = [
  () => [cyl(0, 0, 17, 0, 0.7, '#7cc463'), ...tree(-6, -4), ...tree(6, 3, 0.9), cyl(4, -7, 3.5, 0, 0.9, P.water), box(-4, 8, 6, 1.4, 0.7, 1.2, P.wood)],
  () => [cyl(0, 0, 18, 0, 0.7, '#7cc463'), ...tree(-8, -5), ...tree(8, -6, 0.9), ...tree(-2, 9, 1.1), cyl(4, 2, 4, 0, 1, P.water), cyl(4, 2, 1, 1, 4, '#d9e3e8'),
    ...[-11, 11].map((x) => box(x, 4, 1.4, 5, 0.7, 1.2, P.wood)), sph(10, 10, 2.5, 0, 2.5, '#d86aa0')],
  () => [cyl(0, 0, 18.5, 0, 0.7, '#6fbd59'), ...pine(-9, -6, 1.1), ...tree(7, -8, 1.1), ...tree(-3, 9, 1.2, P.leaf2), ...pine(10, 6, 0.9), ...tree(-11, 6, 0.8),
    cyl(2, 0, 5.5, 0, 1, P.water), sph(0, -1, 1.5, 0.8, 1.5, '#5aae4a'), cyl(13, -2, 0.4, 0, 8, P.wood), box(13, -2, 2, 2, 8, 2, '#c58c4a'), sph(-6, 2, 2, 0, 2, '#e9c94e')],
];

// ---- misc ----
const site = () => [box(0, 0, 20, 16, 0, 1, '#bfb5a3'), ...[[-9, -7], [9, -7], [-9, 7], [9, 7]].map(([x, y]) => cyl(x, y, 0.6, 0, 12, '#c9a45c')),
  box(0, 0, 20, 16, 6, 0.6, '#c9a45c'), box(0, -7, 20, 1.6, 11.4, 0.6, '#c9a45c'), box(-3, 0, 10, 8, 1, 5, '#d9cdb5'), ...crates(5, 10, '#d08a3c'),
  cyl(-12, 10, 1.6, 0, 1.8, '#e1b33b'), cone(-12, 10, 1.4, 1.8, 2.4, '#f08a24')];

function forest(seed) {
  const out = [], n = 3 + Math.floor(hash2(seed, 1) * 3);
  for (let i = 0; i < n; i++) {
    const a = hash2(seed, i * 3) * 6.28, r = 3 + hash2(seed, i * 3 + 1) * 10, s = 0.75 + hash2(seed, i * 3 + 2) * 0.55;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    out.push(...(hash2(seed, i + 40) < 0.55 ? pine(x, y, s) : tree(x, y, s, hash2(seed, i) < 0.5 ? P.leaf : P.leaf2)));
  }
  return out;
}
function hill(seed) {
  const out = [cone(0, 0, 19, 0, 9 + hash2(seed, 5) * 5, '#a8a07a'), sph(3, -2, 9, 0, 13 + hash2(seed, 6) * 4, '#9e9670')];
  for (let i = 0; i < 4; i++) {
    const a = hash2(seed, i) * 6.28, r = 5 + hash2(seed, i + 9) * 9;
    out.push(pyr(Math.cos(a) * r, Math.sin(a) * r, 6, 5, 0, 5 + hash2(seed, i + 3) * 4, '#9c968c'));
  }
  if (hash2(seed, 77) < 0.6) out.push(sph(8, 8, 2.5, 1, 3, '#6f9a45'));
  return out;
}
const truck = [
  () => [box(-1, 0, 8, 5, 1.2, 4.6, '#efe9dc'), box(4.5, 0, 3, 5, 1.2, 3.6, '#3a8fd6'), box(5.4, 0, 0.6, 4.4, 3, 1.4, '#cfe8f5'), box(0, 0, 11, 5.6, 0, 1.4, '#333')],
  () => [box(-2, 0, 10, 5.6, 1.4, 5.6, '#e1b33b'), box(5, 0, 3.2, 5.6, 1.4, 4.2, '#d24d3c'), box(6, 0, 0.6, 5, 3.4, 1.6, '#cfe8f5'), box(0, 0, 13, 6, 0, 1.4, '#333')],
  () => [box(-2, 0, 10, 5.6, 1.4, 5.6, '#f4f7f4'), box(-2, 0, 10, 5.8, 3.6, 1, '#4cae5a'), box(5, 0, 3.2, 5.6, 1.4, 4.2, '#4cae5a'), box(6, 0, 0.6, 5, 3.4, 1.6, '#cfe8f5'), box(0, 0, 13, 6, 0, 1.4, '#333')],
];

const DEFS = {
  house, store, farm_grain, farm_veg, farm_cotton, lumber, quarry, claypit, hub, park,
  bakery: fac('#e8b04a'), cannery: fac('#e06a3a'), sawmill: fac('#a5743a'),
  brickworks: fac('#b5523b'), textile: fac('#7a6ad0'), furniture: fac('#5f8f5a'),
};

export const MODELS = {};
for (const [name, lv] of Object.entries(DEFS)) lv.forEach((f, i) => { MODELS[name + (i + 1)] = makeModel(f()); });
MODELS.site = makeModel(site());
for (let i = 0; i < 8; i++) MODELS['forest' + i] = makeModel(forest(i + 1));
for (let i = 0; i < 4; i++) MODELS['hill' + i] = makeModel(hill(i + 1));
truck.forEach((f, i) => { MODELS['truck' + (i + 1)] = makeModel(f(), { shadow: false }); });
