// Statistics window: resources, transport and eco. Reads the daily snapshots in S.hist (see sim.js closeDay).
import { S, C, hubTrucks } from './state.js';
import { GOODS, BUILDINGS, PRIORITIES, TRUCK } from './config.js';
import { activeHubs } from './logistics.js';

const fmt = (n) => (Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toLocaleString());
const pct = (f) => Math.round(f * 100) + '%';
const esc = (s) => String(s).replace(/"/g, '&quot;');

// view state survives re-renders while the window is open
export const ST = { tab: 'res', good: 'food', resMetric: 'stock', trMetric: 'moved' };

export const TABS = { res: '📊 Resources', tr: '🚚 Transport', eco: '🌿 Eco' };

export function renderStats() {
  const tabs = `<div class="seg tabs">${Object.entries(TABS).map(([k, n]) => `<button data-stab="${k}" class="${ST.tab === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  const body = ST.tab === 'res' ? resources() : ST.tab === 'tr' ? transport() : eco();
  return `<div class="stats">${tabs}${body}</div>`;
}

const tile = (label, value, sub = '') => `<div class="tile"><small>${label}</small><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
const tiles = (...t) => `<div class="tiles">${t.join('')}</div>`;
const metricSeg = (key, opts) => `<div class="seg metric">${Object.entries(opts).map(([k, n]) => `<button data-smetric="${key}:${k}" class="${ST[key] === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
const noData = '<p class="note">Charts fill in after the first full day.</p>';
const last = () => S.hist[S.hist.length - 1];

// ---------- charts (single series, inline SVG, tap or hover to read a value) ----------
// pts: [{ x: day label, v: number }]
function chart(pts, { kind = 'line', unit = '', max, title }) {
  if (pts.length < 1) return noData;
  const W = 320, H = 110, L = 30, R = 6, T = 8, B = 18;
  const top = max ?? niceMax(Math.max(1, ...pts.map((p) => p.v)));
  const iw = W - L - R, ih = H - T - B, n = pts.length;
  const xAt = (i) => L + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yAt = (v) => T + ih - (Math.max(0, v) / top) * ih;
  let marks = '';
  if (kind === 'bar') {
    const slot = iw / n, bw = Math.max(2, slot - 2);
    marks = pts.map((p, i) => { const x = L + i * slot + (slot - bw) / 2, y = yAt(p.v), h = T + ih - y;
      return h > 0 ? `<path d="${barPath(x, y, bw, h, Math.min(2, bw / 2))}" class="mark-fill"/>` : ''; }).join('');
  } else {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(p.v).toFixed(1)}`).join('');
    marks = `<path d="${d}L${xAt(n - 1).toFixed(1)},${T + ih}L${xAt(0).toFixed(1)},${T + ih}Z" class="mark-area"/><path d="${d}" class="mark-line"/>`
      + `<circle cx="${xAt(n - 1).toFixed(1)}" cy="${yAt(pts[n - 1].v).toFixed(1)}" r="3.5" class="mark-dot"/>`;
  }
  // hit targets: one full-height column per point
  const slot = iw / n;
  const hits = pts.map((p, i) => `<rect x="${(kind === 'bar' ? L + i * slot : xAt(i) - slot / 2).toFixed(1)}" y="${T}" width="${slot.toFixed(1)}" height="${ih}" class="hit" data-read="${esc(`Day ${p.x + 1}: ${fmtV(p.v)}${unit}`)}"/>`).join('');
  const grid = [0, 0.5, 1].map((f) => { const y = T + ih - f * ih; return `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 4}" y="${y + 3}" class="axis" text-anchor="end">${fmtV(top * f)}</text>`; }).join('');
  const xl = `<text x="${L}" y="${H - 4}" class="axis">Day ${pts[0].x + 1}</text><text x="${W - R}" y="${H - 4}" class="axis" text-anchor="end">Day ${pts[n - 1].x + 1}</text>`;
  const lastV = `${fmtV(pts[n - 1].v)}${unit}`;
  return `<figure class="chart"><figcaption><span>${title}</span><span class="read" data-default="${esc('Latest: ' + lastV)}">Latest: ${lastV}</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${grid}${marks}${xl}${hits}</svg></figure>`;
}
const fmtV = (v) => (Math.abs(v) >= 1000 ? fmt(v) : Math.abs(v) >= 10 ? Math.round(v) : +v.toFixed(1)).toString();
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 4, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
// rounded top corners, square base on the baseline
function barPath(x, y, w, h, r) {
  r = Math.min(r, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
// horizontal magnitude bars with labels (single hue)
function hbars(rows, cls = '') {
  const max = Math.max(1e-6, ...rows.map((r) => r.v));
  return `<div class="hbars ${cls}">${rows.map((r) => `<div class="hb"><span class="l">${r.label}</span><span class="t"><i style="width:${(r.v / max) * 100}%"></i></span><span class="v">${r.text ?? fmtV(r.v)}</span></div>`).join('')}</div>`;
}

// ---------- resources ----------
function stockNow() {
  const s = {};
  for (const b of Object.values(S.buildings)) for (const [g, n] of Object.entries(b.inv)) s[g] = (s[g] || 0) + n;
  return s;
}
function resources() {
  const h = last(), now = stockNow();
  const goods = Object.keys(GOODS).filter((g) => now[g] >= 1 || S.hist.some((d) => d.prod[g] || d.use[g] || d.exp[g] || d.stock[g]));
  if (!goods.includes(ST.good)) ST.good = goods[0] || 'food';
  const g = ST.good, G = GOODS[g];
  const series = { stock: (d) => d.stock[g] || 0, prod: (d) => d.prod[g] || 0, use: (d) => d.use[g] || 0, exp: (d) => d.exp[g] || 0 };
  const names = { stock: 'In stock', prod: 'Made per day', use: 'Used per day', exp: 'Exported per day' };
  const pts = S.hist.map((d) => ({ x: d.d, v: series[ST.resMetric](d) }));
  const pick = `<div class="goods">${goods.map((x) => `<button data-sgood="${x}" class="${x === g ? 'on' : ''}" title="${GOODS[x].name}">${GOODS[x].icon}</button>`).join('')}</div>`;
  const rows = goods.map((x) => `<tr class="${x === g ? 'sel' : ''}" data-sgood="${x}"><td>${GOODS[x].icon} <span class="nm">${GOODS[x].name}</span></td><td>${fmt(now[x] || 0)}</td>
    <td>${h ? fmt(h.prod[x] || 0) : '–'}</td><td>${h ? fmt(h.use[x] || 0) : '–'}</td><td>${h ? fmt(h.exp[x] || 0) : '–'}</td></tr>`).join('');
  return tiles(tile('Goods in stock', fmt(Object.values(now).reduce((a, v) => a + v, 0))), tile('Exports yesterday', h ? '$' + fmt(h.expIncome) : '–'),
      tile('Harbors', (C.stats?.count.harbor || 0)))
    + pick + metricSeg('resMetric', { stock: 'Stock', prod: 'Made', use: 'Used', exp: 'Sold' })
    + chart(pts, { kind: ST.resMetric === 'stock' ? 'line' : 'bar', title: `${G.icon} ${G.name} · ${names[ST.resMetric]}` })
    + `<table class="stable"><thead><tr><th>Good</th><th>Stock</th><th>Made</th><th>Used</th><th>Sold</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No goods yet</td></tr>'}</tbody></table>
      <p class="note">Made / Used / Sold are yesterday's totals. Used = factories, citizens and construction.</p>`;
}

// ---------- transport ----------
function transport() {
  const h = last(), busyNow = S.trucks.filter((t) => t.steps).length;
  const tripSum = (d) => d.trips.con + d.trips.sup + d.trips.col + (d.trips.route || 0);
  const trips = h ? tripSum(h) : 0;
  const series = { moved: (d) => d.moved, busy: (d) => d.busy * 100, trips: tripSum, dist: (d) => d.dist };
  const names = { moved: 'Goods delivered per day', busy: 'Fleet utilisation', trips: 'Trips per day', dist: 'Tiles driven per day' };
  const pts = S.hist.map((d) => ({ x: d.d, v: series[ST.trMetric](d) }));
  const hubs = activeHubs().map((b) => {
    const ts = hubTrucks(b.id), used = Object.values(b.inv).reduce((a, v) => a + v, 0), cap = BUILDINGS.hub.cap[b.level - 1];
    return `<tr><td>📦 L${b.level} <span class="nm">${BUILDINGS.hub.names[b.level - 1]}</span></td><td>${ts.filter((t) => t.steps).length}/${ts.length}</td><td>${pct(used / cap)}</td><td>${PRIORITIES[b.priority]?.name || ''}</td></tr>`;
  }).join('');
  return tiles(tile('Trucks', S.trucks.length, `${busyNow} busy now`), tile('Utilisation', h ? pct(h.busy) : '–', 'yesterday'),
      tile('Delivered', h ? fmt(h.moved) : '–', `${trips} trips`), tile('Truck CO₂', h ? h.co2.toFixed(1) : '–', h ? `${fmt(h.dist)} tiles` : ''))
    + metricSeg('trMetric', { moved: 'Goods', busy: 'Busy %', trips: 'Trips', dist: 'Distance' })
    + chart(pts, { kind: ST.trMetric === 'busy' ? 'line' : 'bar', unit: ST.trMetric === 'busy' ? '%' : '', max: ST.trMetric === 'busy' ? 100 : undefined, title: names[ST.trMetric] })
    + (h ? `<h4 class="sh">Trips yesterday by job</h4>` + hbars([
      { label: '🏗️ Construction', v: h.trips.con }, { label: '🛒 Supply', v: h.trips.sup }, { label: '📥 Collection', v: h.trips.col }, { label: '🛣️ Route legs', v: h.trips.route || 0 }]) : '')
    + `<h4 class="sh">Hubs</h4><table class="stable"><thead><tr><th>Hub</th><th>Busy</th><th>Full</th><th>Priority</th></tr></thead><tbody>${hubs}</tbody></table>
      <p class="note">${TRUCK.names.join(' → ')}: upgrading a hub upgrades its trucks (faster, bigger, cleaner).</p>`;
}

// ---------- eco ----------
function eco() {
  const src = C.pollSrc || {}, sink = C.pollSink || {};
  const total = Object.values(src).reduce((a, v) => a + v, 0), absorb = Object.values(sink).reduce((a, v) => a + v, 0);
  const pts = S.hist.map((d) => ({ x: d.d, v: d.eco }));
  const srcRows = Object.entries(src).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, v }));
  const sinkRows = Object.entries(sink).filter(([, v]) => v > 0.01).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, v }));
  const worst = srcRows[0];
  const tip = worst ? { Mining: 'Upgrade quarries and clay pits to level 3 (Low-Impact).', Industry: 'Level 3 factories pollute up to 85% less.',
    Trucks: 'Upgrade hubs to level 3 for zero-emission E-Trucks, and use faster roads.', Farms: 'Level 3 farms are almost emission-free.',
    'Storage hubs': 'Level 3 Smart Eco Hubs pollute far less.', Harbors: 'Upgrade harbors to the Green Port.' }[worst.label] || '' : '';
  return tiles(tile('Eco score', C.eco ?? 100, C.eco >= 60 ? '🌱 healthy' : '⚠️ polluted'), tile('Pollution', total.toFixed(1), 'emitted'), tile('Absorption', absorb.toFixed(1), 'forests & parks'))
    + chart(pts, { kind: 'line', max: 100, title: 'Eco score over time' })
    + `<h4 class="sh">Pollution sources</h4>` + (srcRows.length ? hbars(srcRows, 'bad') : '<p class="note">Nothing pollutes yet.</p>')
    + `<h4 class="sh">Absorption</h4>` + hbars(sinkRows, 'good')
    + (tip ? `<p class="note">💡 Biggest polluter: <b>${worst.label}</b>. ${tip} Parks next to polluters help locally.</p>` : '');
}
