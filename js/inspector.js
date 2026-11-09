// Bottom-sheet property inspector: selected building, tile, active tool or fleet overview. Tap the header to minimise it.
import { S, C, def, tileAt, hubTrucks } from './state.js';
import { BUILDINGS, ZONES, GOODS, ROAD, TERRAIN, TRUCK, PRIORITIES, LEVEL_UNLOCK, ZONE_COST, NEED_RATE } from './config.js';
import { V } from './render.js';
import * as A from './actions.js';
import { isUnlocked } from './sim.js';
import { activeHubs, isConnected, hubFree } from './logistics.js';
import { key } from './hex.js';

const fmt = (n) => Math.round(n).toLocaleString();
const stars = (l) => `<span class="stars">${'★'.repeat(l)}<span class="off">${'★'.repeat(3 - l)}</span></span>`;
const chip = (g, n, cls = '') => `<span class="chip ${cls}">${GOODS[g].icon} ${typeof n === 'number' ? fmt(n) : n}</span>`;
const bar = (f, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(1, f)) * 100}%"></i></div>`;
const row = (k, v) => `<div class="row"><span>${k}</span><span class="v">${v}</span></div>`;
const sec = (title, body) => `<div class="sec"><h4>${title}</h4>${body}</div>`;
const matsChips = (m) => Object.entries(m).map(([g, n]) => chip(g, n)).join(' ') || '<span class="note">none</span>';

let bound = null, uiRef = null;
function bind(el) {
  if (bound === el) return;
  bound = el;
  el.addEventListener('click', (e) => {
    if (e.target.closest('.insp-head')) { el.parentElement.classList.toggle('mini'); return; }
    const btn = e.target.closest('[data-act]'); if (!btn || btn.disabled) return;
    const act = btn.dataset.act, arg = btn.dataset.arg;
    const b = V.selected ? S.buildings[V.selected] : null;
    let r = { ok: true };
    if (act === 'upgrade' && b) r = A.upgrade(b);
    else if (act === 'demolish' && b) { r = A.demolish(tileAt(b.q, b.r)); if (r.ok) { V.selected = null; V.range = null; } }
    else if (act === 'buytruck' && b) r = A.buyTruck(b);
    else if (act === 'selltruck' && b) r = A.sellTruck(b);
    else if (act === 'prio' && b) A.setPriority(b, arg);
    else if (act === 'spec') uiRef.tool = { ...uiRef.tool, spec: arg };
    else if (act === 'tilespec') { const t = V.selTile; if (t) { t.spec = arg; } }
    else if (act === 'gohub') { V.selected = arg; uiRef.fleet = false; }
    if (!r.ok && r.msg) window.dispatchEvent(new CustomEvent('hv-toast', { detail: { text: r.msg, kind: 'err' } }));
    uiRef.inspDirty = true;
  });
}

let lastHTML = '';
export function renderInspector(el, UI) {
  uiRef = UI; bind(el);
  let html;
  if (UI.fleet) html = fleet();
  else if (V.selected && S.buildings[V.selected]) html = building(S.buildings[V.selected]);
  else if (UI.tool.kind !== 'select') html = tool(UI);
  else if (V.selTile) html = tile(V.selTile);
  else html = '<p class="note">Tap a building or tile to inspect it.</p>';
  if (html !== lastHTML) { el.innerHTML = html; lastHTML = html; }
}

// ---------- tool info ----------
function tool(UI) {
  const t = UI.tool;
  const hint = '<p class="note">☝️ Tap or drag with one finger to paint. Use two fingers to move, zoom and rotate the map.</p>';
  const cost = UI.stroke.length ? row('This stroke', '$' + fmt(strokeCostLocal(UI))) : '';
  if (t.kind === 'zone') {
    const z = ZONES[t.zone];
    const opts = z.types.length > 1 ? sec('Specialisation', `<div class="seg"><button data-act="spec" data-arg="auto" class="${t.spec === 'auto' ? 'on' : ''}">Auto</button>${z.types.map((ty) => {
      const d = BUILDINGS[ty], lk = !isUnlocked(ty);
      return `<button data-act="spec" data-arg="${ty}" class="${t.spec === ty ? 'on' : ''}" ${lk ? 'disabled' : ''} title="${lk ? 'Unlocks at ' + d.unlock + ' citizens' : d.desc}">${d.icon} ${d.names[0]}${lk ? ' 🔒' : ''}</button>`;
    }).join('')}</div><p class="note">Auto lets companies choose what the economy needs most.</p>`) : '';
    return `<div class="insp-head"><span class="ic">${z.icon}</span><div><h2>${z.name} zone</h2><div class="sub">$${ZONE_COST} per tile</div></div></div>
      ${sec('Allowed on', `<div class="chips">${z.terrain.map((x) => `<span class="chip">${TERRAIN[x].name}</span>`).join('')}</div>`)}
      ${opts}${sec('Info', `<p class="note">Buildings appear on zoned tiles <b>next to a road that leads to a Storage Hub</b> when there is demand (see the R/C/I bars at the top). Trucks must reach them with materials.</p>${cost}`)}${hint}`;
  }
  if (t.kind === 'road') {
    const L = t.level - 1;
    return `<div class="insp-head"><span class="ic">🛣️</span><div><h2>${ROAD.names[L]}</h2>${stars(t.level)}</div></div>
      ${sec('Stats', row('Cost per tile', '$' + ROAD.cost[L]) + row('Truck speed', '×' + ROAD.speed[L]) + row('Upkeep', '$' + ROAD.upkeep[L] + '/day') + cost)}
      <p class="note">Drawing over a lower-level road upgrades it. Roads through forest clear the trees.</p>${hint}`;
  }
  if (t.kind === 'build') {
    const d = BUILDINGS[t.type];
    return `<div class="insp-head"><span class="ic">${d.icon}</span><div><h2>${d.names[0]}</h2><div class="sub">$${d.cost[0]}</div></div></div>
      <p class="note desc">${d.desc}</p>${sec('Materials needed', `<div class="chips">${matsChips(d.mats[0])}</div>`)}
      ${t.type === 'park' ? sec('Effect', row('Radius', d.radius[0] + ' tiles') + row('Absorbs', d.strength[0] + ' pollution')) : ''}
      ${t.type === 'hub' ? sec('Capacity', row('Storage', d.cap[0]) + row('Truck slots', d.trucks[0])) : ''}
      <p class="note">☝️ Tap a free tile to place it.</p>`;
  }
  if (t.kind === 'bulldoze') return `<div class="insp-head"><span class="ic">🧨</span><div><h2>Remove</h2></div></div><p class="note">Tap or drag to remove buildings, then roads, then zones. Player buildings refund 30%.</p>${hint}`;
  if (t.kind === 'unzone') return `<div class="insp-head"><span class="ic">🧽</span><div><h2>Remove zone</h2></div></div><p class="note">Clears zoning from empty tiles. Existing buildings stay.</p>${hint}`;
  return '';
}
function strokeCostLocal(UI) {
  const t = UI.tool;
  if (t.kind === 'road') return UI.stroke.reduce((a, x) => a + (A.canRoad(x, t.level).ok ? A.roadCost(x, t.level) : 0), 0);
  if (t.kind === 'zone') return UI.stroke.filter((x) => A.canZone(x, t.zone).ok).length * ZONE_COST;
  return 0;
}

// ---------- tile ----------
function tile(t) {
  const p = C.poll.get(key(t.q, t.r)) || 0;
  const z = t.zone ? ZONES[t.zone] : null;
  let specSeg = '';
  if (z && z.types.length > 1) {
    specSeg = sec('Specialisation', `<div class="seg"><button data-act="tilespec" data-arg="auto" class="${t.spec === 'auto' ? 'on' : ''}">Auto</button>${z.types.map((ty) =>
      `<button data-act="tilespec" data-arg="${ty}" class="${t.spec === ty ? 'on' : ''}" ${isUnlocked(ty) ? '' : 'disabled'}>${BUILDINGS[ty].icon} ${BUILDINGS[ty].names[0]}</button>`).join('')}</div>`);
  }
  return `<div class="insp-head"><span class="ic">${z ? z.icon : '⬡'}</span><div><h2>${TERRAIN[t.terrain].name}</h2><div class="sub">Tile ${t.q}, ${t.r}</div></div></div>
    ${sec('Tile', row('Zone', z ? z.name : '—') + row('Road', t.road ? ROAD.names[t.road - 1] : '—') + row('Pollution', p.toFixed(2)))}${specSeg}`;
}

// ---------- building ----------
const STATUS = { ok: '✅ Working', full: '📦 Storage full — waiting for pickup', noinput: '⏳ Waiting for input goods' };
function building(b) {
  const d = def(b), L = b.level - 1;
  let h = `<div class="insp-head"><span class="ic">${d.icon}</span><div><h2>${d.names[L]}</h2>${stars(b.level)} <span class="sub">${b.built ? '' : 'under construction'}</span></div></div>`;
  if (d.desc) h += `<p class="note desc">${d.desc}</p>`;
  if (!isConnected(b)) h += `<div class="warnbox">🚧 Not reachable by trucks. Connect it to a Storage Hub by road.</div>`;
  if (b.site) h += siteSec(b);
  if (b.built) {
    if (d.kind === 'house') h += houseSec(b, d, L);
    else if (d.kind === 'store') h += storeSec(b, d, L);
    else if (d.kind === 'producer') h += producerSec(b, d, L);
    else if (d.kind === 'processor') h += processorSec(b, d, L);
    else if (d.kind === 'hub') h += hubSec(b, d, L);
    else if (d.kind === 'park') h += sec('Effect', row('Radius', d.radius[L] + ' tiles') + row('Absorbs', d.strength[L] + ' pollution') + row('Upkeep', '$' + d.upkeep[L] + '/day'));
    const p = d.poll[L];
    h += sec('Environment', row('Pollution emitted', p ? p.toFixed(2) : 'none 🌱') + row('Local pollution', (C.poll.get(key(b.q, b.r)) || 0).toFixed(2)));
  }
  h += upgradeSec(b, d);
  if (b.type !== 'hub' || activeHubs().length > 1 || !b.built) h += `<button class="btn danger" data-act="demolish">🧨 Demolish${d.player ? ` (+$${fmt(d.cost[L] * 0.3)})` : ''}</button>`;
  return h;
}

function siteSec(b) {
  const s = b.site;
  const chips = Object.entries(s.need).map(([g, n]) => { const got = s.got[g] || 0; return chip(g, `${fmt(got)}/${n}`, got < n ? 'miss' : ''); }).join(' ');
  const inc = Object.entries(s.incoming).filter(([, n]) => n > 0).map(([g, n]) => chip(g, '🚚 ' + fmt(n))).join(' ');
  const done = Object.entries(s.need).every(([g, n]) => (s.got[g] || 0) >= n);
  // materials that nobody has in stock: tell the player which building makes them
  const short = Object.entries(s.need).filter(([g, n]) => (s.got[g] || 0) + (s.incoming[g] || 0) < n
    && !Object.values(S.buildings).some((x) => x !== b && x.built && (x.inv[g] || 0) >= 1 && (x.type === 'hub' || def(x).out === g || (def(x).recipe && def(x).recipe.out[g]))))
    .map(([g]) => { const m = Object.values(BUILDINGS).find((d) => d.out === g || (d.recipe && d.recipe.out[g]));
      return `${GOODS[g].icon} ${GOODS[g].name}${m ? ` → ${m.names[0]}` : ''}`; });
  const shortBox = short.length ? `<div class="warnbox">None in stock:<br>${short.join('<br>')}</div>` : '';
  return sec(s.upgrade ? `Upgrading to level ${b.level + 1}` : 'Construction',
    `<div class="chips">${chips || '<span class="note">No materials needed</span>'}</div>${inc ? `<div class="chips" style="margin-top:4px">${inc}</div>` : ''}
    ${done ? row('Building', Math.round(s.progress * 100) + '%') + bar(s.progress, 'gold') : '<p class="note">Waiting for trucks to deliver materials.</p>' + shortBox}`);
}

function houseSec(b, d, L) {
  const needs = d.needs[L].map((g) => `<div class="row"><span>${GOODS[g].icon} ${GOODS[g].name}</span><span class="v">${Math.round((b.sat[g] ?? 0.6) * 100)}%</span></div>${bar(b.sat[g] ?? 0.6, (b.sat[g] ?? 1) < 0.4 ? 'warn' : '')}`).join('');
  const stores = (C.storesNear[b.id] || []).length;
  return sec('Residents', row('Citizens', `${b.residents} / ${d.cap[L]}`) + bar(b.residents / d.cap[L]) + row('Happiness', Math.round(b.happy) + '%') + bar(b.happy / 100, b.happy < 35 ? 'warn' : '') +
    row('Taxes', '$' + (b.residents * d.tax[L] * b.happy / 100).toFixed(1) + '/day'))
    + sec('Needs', needs + (stores ? '' : '<div class="warnbox">No store within walking range (5 tiles).</div>'));
}
function storeSec(b, d, L) {
  const per = Math.floor(d.stock[L] / d.sells[L].length);
  return sec('Stock', d.sells[L].map((g) => row(`${GOODS[g].icon} ${GOODS[g].name}`, `${fmt(b.inv[g] || 0)} / ${per}`) + bar((b.inv[g] || 0) / per, (b.inv[g] || 0) < 2 ? 'warn' : '')).join('')
    + (Object.keys(b.incoming).length ? `<div class="chips" style="margin-top:4px">${Object.entries(b.incoming).map(([g, n]) => chip(g, '🚚 ' + fmt(n))).join(' ')}</div>` : ''))
    + sec('Service', row('Walking range', d.range[L] + ' tiles') + row('Jobs', d.workers[L]));
}
function producerSec(b, d, L) {
  const have = b.inv[d.out] || 0;
  const t = tileAt(b.q, b.r);
  let bonus = '';
  if (d.bonus === 'fertile') bonus = t.terrain === 'fertile' ? '+30% fertile soil 🌱' : 'no soil bonus';
  if (d.bonus === 'forest') bonus = 'forest nearby boosts output';
  return sec('Production', `<p class="note">${STATUS[b.status] || ''}</p>` + row(`${GOODS[d.out].icon} Output`, `${d.rate[L]}/day`) + row('Stored', `${fmt(have)} / ${d.buf[L]}`) + bar(have / d.buf[L], have >= d.buf[L] ? 'warn' : '')
    + row('Jobs', d.workers[L]) + row('Workforce', Math.round((C.stats?.employment ?? 1) * 100) + '%') + (bonus ? row('Bonus', bonus) : ''));
}
function processorSec(b, d, L) {
  const r = d.recipe;
  const recipe = `<div class="chips">${Object.entries(r.in).map(([g, n]) => chip(g, n)).join(' ')} <span>➜</span> ${Object.entries(r.out).map(([g, n]) => chip(g, n)).join(' ')}</div>`;
  const inv = [...Object.keys(r.in), ...Object.keys(r.out)].map((g) => chip(g, b.inv[g] || 0, Object.keys(r.in).includes(g) && (b.inv[g] || 0) < r.in[g] ? 'miss' : '')).join(' ');
  return sec('Production', `<p class="note">${STATUS[b.status] || ''}</p>` + recipe + row('Cycles', `${d.rate[L]}/day`) + row('Jobs', d.workers[L]))
    + sec('Inventory', `<div class="chips">${inv}</div>`);
}
function hubSec(b, d, L) {
  const used = Object.values(b.inv).reduce((a, v) => a + v, 0);
  const trucks = hubTrucks(b.id);
  const ti = A.truckInfo(b);
  const label = { con: '🏗️ building', sup: '🛒 supply', col: '📥 collect' };
  const tl = trucks.map((t, i) => `<div class="truck"><span class="dot ${t.steps ? 'busy' : ''}"></span>${TRUCK.names[L]} ${i + 1}<span class="note" style="margin:0 0 0 auto">${t.steps ? label[t.job] || 'busy' : 'idle'}</span></div>`).join('');
  return sec('Storage', row('Used', `${fmt(used)} / ${d.cap[L]}`) + bar(used / d.cap[L], used / d.cap[L] > 0.9 ? 'warn' : '')
      + `<div class="chips" style="margin-top:6px">${Object.entries(b.inv).filter(([, n]) => n >= 1).map(([g, n]) => chip(g, n)).join(' ') || '<span class="note">empty</span>'}</div>`
      + (hubFree(b) < 5 ? '<div class="warnbox">Hub is full! Upgrade it or build another hub.</div>' : ''))
    + sec(`Fleet · ${ti.n}/${ti.max} ${TRUCK.names[L]}s`, tl + row('Capacity', TRUCK.cap[L] + ' per truck') + row('Emissions', TRUCK.co2[L] ? TRUCK.co2[L] + ' CO₂/tile' : 'zero 🌱')
      + `<div class="btnrow"><button class="btn" data-act="buytruck" ${ti.n >= ti.max ? 'disabled' : ''}>🚚 Buy ($${ti.cost})</button><button class="btn sec2" data-act="selltruck" ${ti.n ? '' : 'disabled'}>Sell</button></div>`)
    + sec('Transport priority', `<div class="seg">${Object.entries(PRIORITIES).map(([k, p]) => `<button data-act="prio" data-arg="${k}" class="${b.priority === k ? 'on' : ''}">${p.name}</button>`).join('')}</div>`);
}

function upgradeSec(b, d) {
  if (b.level >= 3) return sec('Level', '<p class="note">⭐ Maximum level reached.</p>');
  if (b.site) return '';
  const u = A.upgradeInfo(b);
  const next = b.level;
  const gains = [];
  if (d.cap) gains.push(`capacity ${d.cap[next - 1]}→${d.cap[next]}`);
  if (d.rate) gains.push(`output ${d.rate[next - 1]}→${d.rate[next]}/day`);
  if (d.stock) gains.push(`stock ${d.stock[next - 1]}→${d.stock[next]}`);
  if (d.trucks) gains.push(`trucks ${d.trucks[next - 1]}→${d.trucks[next]}`);
  if (d.radius) gains.push(`radius ${d.radius[next - 1]}→${d.radius[next]}`);
  if (d.needs) gains.push(`needs ${d.needs[next].map((g) => GOODS[g].icon).join('')}`);
  if (d.sells) gains.push(`sells ${d.sells[next].map((g) => GOODS[g].icon).join('')}`);
  if (d.poll && d.poll[next] < d.poll[next - 1]) gains.push(`pollution ${d.poll[next - 1]}→${d.poll[next]}`);
  return sec(`Upgrade to ${d.names[next]}`, `<p class="note">${gains.join(' · ')}</p><div class="chips">${u.mats ? matsChips(u.mats) : ''}</div>
    <button class="btn" data-act="upgrade" ${u.can ? '' : 'disabled'}>⬆️ Upgrade${u.cost !== undefined ? ` ($${fmt(u.cost)})` : ''}</button>${u.can ? '' : `<p class="note">${u.msg}</p>`}`);
}

// ---------- fleet ----------
function fleet() {
  const hubs = Object.values(S.buildings).filter((b) => b.type === 'hub');
  const sites = Object.values(S.buildings).filter((b) => b.site);
  const busy = S.trucks.filter((t) => t.steps).length;
  return `<div class="insp-head"><span class="ic">🚚</span><div><h2>Fleet overview</h2><div class="sub">${S.trucks.length} trucks · ${busy} busy</div></div></div>
    ${sec('Hubs', hubs.map((h) => { const ts = hubTrucks(h.id), used = Object.values(h.inv).reduce((a, v) => a + v, 0), cap = BUILDINGS.hub.cap[h.level - 1];
      return `<button class="item" data-act="gohub" data-arg="${h.id}"><span class="ic">📦</span><span class="tx"><b>${BUILDINGS.hub.names[h.level - 1]}</b><small>${ts.filter((t) => t.steps).length}/${ts.length} trucks busy · ${fmt(used)}/${cap} stored${h.built ? '' : ' · building'}</small></span></button>`; }).join(''))}
    ${sec('Construction sites', sites.length ? sites.map((b) => row(`${def(b).icon} ${def(b).names[b.site.upgrade ? b.level : 0]}`, isConnected(b) ? Math.round(Object.entries(b.site.need).reduce((a, [g, n]) => a + Math.min(n, b.site.got[g] || 0), 0) / Math.max(1, Object.values(b.site.need).reduce((a, v) => a + v, 0)) * 100) + '%' : '🚧 no road')).join('') : '<p class="note">None</p>')}
    <p class="note">Tip: if sites wait long, buy trucks or set a hub's priority to Construction.</p>`;
}
