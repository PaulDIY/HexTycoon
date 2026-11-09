// Bottom-sheet property inspector: selected building, tile, active tool or fleet overview. Tap the header to minimise it.
import { S, C, def, tileAt, hubTrucks } from './state.js';
import { BUILDINGS, ZONES, GOODS, ROAD, TERRAIN, TRUCK, PRIORITIES, LEVEL_UNLOCK, ZONE_COST, NEED_RATE } from './config.js';
import { V } from './render.js';
import * as A from './actions.js';
import { isUnlocked, levelUnlocked } from './sim.js';
import { activeHubs, isConnected, hubFree } from './logistics.js';
import { key } from './hex.js';

const fmt = (n) => Math.round(n).toLocaleString();
const stars = (l) => `<span class="stars">${'★'.repeat(l)}<span class="off">${'★'.repeat(3 - l)}</span></span>`;
const chip = (g, n, cls = '') => `<span class="chip ${cls}">${GOODS[g].icon} ${typeof n === 'number' ? fmt(n) : n}</span>`;
const bar = (f, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(1, f)) * 100}%"></i></div>`;
const row = (k, v) => `<div class="row"><span>${k}</span><span class="v">${v}</span></div>`;
const sec = (title, body) => `<div class="sec"><h4>${title}</h4>${body}</div>`;
const matsChips = (m) => Object.entries(m).map(([g, n]) => chip(g, n)).join(' ') || '<span class="note">none</span>';
// compact "icon value" stat; a row of them wraps
const kv = (ic, v, title = '', cls = '') => `<span class="kv ${cls}" title="${title}">${ic} <b>${v}</b></span>`;
const kvs = (...items) => `<div class="kvs">${items.filter(Boolean).join('')}</div>`;
const xtra = (html) => html ? `<div class="xtra">${html}</div>` : '';
const head = (ic, title, sub = '') => `<div class="insp-head"><span class="ic">${ic}</span><div class="ht"><h2>${title}</h2>${sub}</div></div>`;

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
  el.addEventListener('change', (e) => {
    const b = V.selected ? S.buildings[V.selected] : null;
    if (e.target.dataset.chg === 'prio' && b) { A.setPriority(b, e.target.value); uiRef.inspDirty = true; }
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
  const hint = xtra('<p class="note">☝️ Tap or drag with one finger to paint. Two fingers move, zoom and rotate the map.</p>');
  const stroke = UI.stroke.length ? kv('💲', fmt(strokeCostLocal(UI)), 'Cost of this stroke') : '';
  if (t.kind === 'zone') {
    const z = ZONES[t.zone];
    const opts = z.types.length > 1 ? `<div class="seg">${specBtn('spec', 'auto', t.spec === 'auto', true, 'Auto')}${z.types.map((ty) =>
      specBtn('spec', ty, t.spec === ty, isUnlocked(ty), `${BUILDINGS[ty].icon} ${BUILDINGS[ty].names[0]}${isUnlocked(ty) ? '' : ' 🔒'}`)).join('')}</div>` : '';
    return head(z.icon, `${z.name} zone`, `<span class="sub">$${ZONE_COST}/tile · ${z.terrain.map((x) => TERRAIN[x].name).join(', ')}</span>`)
      + kvs(stroke) + opts
      + xtra('<p class="note">Companies move in next to a road that leads to a Storage Hub, when the R/C/I bars show demand.</p>') + hint;
  }
  if (t.kind === 'road') {
    const L = t.level - 1;
    return head('🛣️', ROAD.names[L], stars(t.level))
      + kvs(kv('💲', ROAD.cost[L] + '/tile', 'Cost per tile'), kv('🚚', '×' + ROAD.speed[L], 'Truck speed'), kv('🔧', '$' + ROAD.upkeep[L] + '/d', 'Upkeep'), stroke)
      + xtra('<p class="note">Drawing over a lower-level road upgrades it. Roads through forest clear the trees.</p>') + hint;
  }
  if (t.kind === 'build') {
    const d = BUILDINGS[t.type];
    return head(d.icon, d.names[0], `<span class="sub">$${d.cost[0]}</span>`)
      + `<div class="chips">${matsChips(d.mats[0])}</div>`
      + (t.type === 'park' ? kvs(kv('◎', d.radius[0], 'Radius (tiles)'), kv('🌿', d.strength[0], 'Pollution absorbed')) : '')
      + (t.type === 'hub' ? kvs(kv('📦', d.cap[0], 'Storage'), kv('🚚', d.trucks[0], 'Truck slots')) : '')
      + xtra(`<p class="note">${d.desc} Tap a free tile to place it.</p>`);
  }
  if (t.kind === 'bulldoze') return head('🧨', 'Remove', '<span class="sub">Buildings, then roads, then zones</span>') + xtra('<p class="note">Player buildings refund 30%.</p>') + hint;
  if (t.kind === 'unzone') return head('🧽', 'Remove zone', '<span class="sub">Existing buildings stay</span>') + hint;
  return '';
}
const specBtn = (act, arg, on, enabled, label) => `<button data-act="${act}" data-arg="${arg}" class="${on ? 'on' : ''}" ${enabled ? '' : 'disabled'}>${label}</button>`;
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
  const spec = z && z.types.length > 1 ? `<div class="seg">${specBtn('tilespec', 'auto', t.spec === 'auto', true, 'Auto')}${z.types.map((ty) =>
    specBtn('tilespec', ty, t.spec === ty, isUnlocked(ty), `${BUILDINGS[ty].icon} ${BUILDINGS[ty].names[0]}`)).join('')}</div>` : '';
  const sub = [z ? z.name + ' zone' : '', t.road ? ROAD.names[t.road - 1] : ''].filter(Boolean).join(' · ');
  return head(z ? z.icon : '⬡', TERRAIN[t.terrain].name, sub ? `<span class="sub">${sub}</span>` : '')
    + kvs(kv('☁️', p.toFixed(1), 'Pollution')) + spec;
}

// ---------- building ----------
const STATUS = { ok: ['✅', 'Working'], full: ['📦', 'Storage full'], noinput: ['⏳', 'Waiting for input'] };
const status = (b) => { const s = STATUS[b.status]; return s ? `<span class="sub">${s[0]} ${s[1]}</span>` : ''; };
function building(b) {
  const d = def(b), L = b.level - 1;
  const sub = `${stars(b.level)} ${b.site && !b.site.upgrade ? '<span class="sub">🚧 under construction</span>' : (d.kind === 'producer' || d.kind === 'processor') && b.built ? status(b) : ''}`;
  let h = head(d.icon, d.names[L], sub);
  if (d.desc) h += xtra(`<p class="note">${d.desc}</p>`);
  if (!isConnected(b)) h += `<div class="warnbox">🚧 No road to a Storage Hub</div>`;
  if (b.site) h += siteSec(b);
  if (b.built) {
    if (d.kind === 'house') h += houseSec(b, d, L);
    else if (d.kind === 'store') h += storeSec(b, d, L);
    else if (d.kind === 'producer') h += producerSec(b, d, L);
    else if (d.kind === 'processor') h += processorSec(b, d, L);
    else if (d.kind === 'hub') h += hubSec(b, d, L);
    else if (d.kind === 'park') h += kvs(kv('◎', d.radius[L], 'Radius (tiles)'), kv('🌿', d.strength[L], 'Pollution absorbed'), kv('🔧', '$' + d.upkeep[L] + '/d', 'Upkeep'));
  }
  return h + actions(b, d, L);
}

function siteSec(b) {
  const s = b.site;
  const chips = Object.entries(s.need).map(([g, n]) => { const got = s.got[g] || 0, inc = s.incoming[g] || 0;
    return chip(g, `${fmt(got)}/${n}${inc > 0 ? ' 🚚' : ''}`, got < n ? 'miss' : ''); }).join(' ');
  const done = Object.entries(s.need).every(([g, n]) => (s.got[g] || 0) >= n);
  // materials that nobody has in stock: tell the player which building makes them
  const short = Object.entries(s.need).filter(([g, n]) => (s.got[g] || 0) + (s.incoming[g] || 0) < n
    && !Object.values(S.buildings).some((x) => x !== b && x.built && (x.inv[g] || 0) >= 1 && (x.type === 'hub' || def(x).out === g || (def(x).recipe && def(x).recipe.out[g]))))
    .map(([g]) => { const m = Object.values(BUILDINGS).find((d) => d.out === g || (d.recipe && d.recipe.out[g]));
      return `${GOODS[g].icon} ${GOODS[g].name}${m ? ` → ${m.names[0]}` : ''}`; });
  return `<div class="sec wide"><h4>${s.upgrade ? `Upgrading to ${def(b).names[b.level]}` : 'Construction'}${done ? ' · ' + Math.round(s.progress * 100) + '%' : ''}</h4>
    <div class="chips">${chips || '<span class="note">No materials needed</span>'}</div>${done ? bar(s.progress, 'gold') : ''}
    ${short.length ? `<div class="warnbox">None in stock: ${short.join(', ')}</div>` : ''}</div>`;
}

function houseSec(b, d, L) {
  const needs = d.needs[L].map((g) => { const v = b.sat[g] ?? 0.6; return chip(g, Math.round(v * 100) + '%', v < 0.4 ? 'miss' : ''); }).join(' ');
  const stores = (C.storesNear[b.id] || []).length;
  return kvs(kv('👥', `${b.residents}/${d.cap[L]}`, 'Citizens'), kv(b.happy < 35 ? '☹️' : '🙂', Math.round(b.happy) + '%', 'Happiness', b.happy < 35 ? 'bad' : ''),
      kv('💰', '$' + (b.residents * d.tax[L] * b.happy / 100).toFixed(1) + '/d', 'Taxes'))
    + `<div class="chips">${needs}</div>` + (stores ? '' : '<div class="warnbox">No store within walking range</div>');
}
function storeSec(b, d, L) {
  const per = Math.floor(d.stock[L] / d.sells[L].length);
  const stock = d.sells[L].map((g) => chip(g, `${fmt(b.inv[g] || 0)}/${per}${(b.incoming[g] || 0) > 0 ? ' 🚚' : ''}`, (b.inv[g] || 0) < 2 ? 'miss' : '')).join(' ');
  return `<div class="chips">${stock}</div>` + xtra(kvs(kv('🚶', d.range[L] + ' tiles', 'Walking range'), kv('👷', d.workers[L], 'Jobs')));
}
function producerSec(b, d, L) {
  const have = b.inv[d.out] || 0, t = tileAt(b.q, b.r);
  let bonus = '';
  if (d.bonus === 'fertile' && t.terrain === 'fertile') bonus = kv('🌱', '+30%', 'Fertile soil bonus');
  return kvs(kv(GOODS[d.out].icon, d.rate[L] + '/d', 'Output per day'), kv('📦', `${fmt(have)}/${d.buf[L]}`, 'Stored, waiting for pickup', have >= d.buf[L] ? 'bad' : ''), bonus,
    xtra(kv('👷', d.workers[L], 'Jobs')));
}
function processorSec(b, d, L) {
  const r = d.recipe;
  const io = (o, isIn) => Object.entries(o).map(([g, n]) => chip(g, `${fmt(b.inv[g] || 0)}`, isIn && (b.inv[g] || 0) < n ? 'miss' : '')).join(' ');
  return `<div class="chips">${io(r.in, true)} <span class="arrow">➜ ${Object.entries(r.out).map(([g, n]) => GOODS[g].icon + n).join(' ')} ×${d.rate[L]}/d ➜</span> ${io(r.out, false)}</div>`
    + xtra(kvs(kv('👷', d.workers[L], 'Jobs')));
}
const PRIO_SHORT = { balanced: '⚖️ Balanced', construction: '🏗️ Build', supply: '🛒 Supply', collect: '📥 Collect' };
function hubSec(b, d, L) {
  const used = Object.values(b.inv).reduce((a, v) => a + v, 0);
  const trucks = hubTrucks(b.id), ti = A.truckInfo(b);
  const busy = trucks.filter((t) => t.steps).length;
  return `<div class="sec"><h4>Storage · ${fmt(used)}/${d.cap[L]}</h4>${bar(used / d.cap[L], used / d.cap[L] > 0.9 ? 'warn' : '')}
      <div class="chips">${Object.entries(b.inv).filter(([, n]) => n >= 1).map(([g, n]) => chip(g, n)).join(' ') || '<span class="note">empty</span>'}</div>
      ${hubFree(b) < 5 ? '<div class="warnbox">Hub is full</div>' : ''}</div>`
    + `<div class="sec span2"><h4>${TRUCK.names[L]}s ·${ti.n}/${ti.max} · ${busy} busy</h4>
      <div class="btnrow"><button class="btn" data-act="buytruck" ${ti.n >= ti.max ? 'disabled' : ''} title="Buy a ${TRUCK.names[L]}">🚚 +$${ti.cost}</button><button class="btn sec2 sell" data-act="selltruck" ${ti.n ? '' : 'disabled'} title="Sell a truck">Sell</button>
      <select class="btn sec2" data-chg="prio" title="Transport priority">${Object.keys(PRIORITIES).map((k) => `<option value="${k}" ${b.priority === k ? 'selected' : ''}>${PRIO_SHORT[k]}</option>`).join('')}</select></div></div>`;
}

// upgrade + demolish in one footer row
function actions(b, d, L) {
  let up = '', msg = '';
  if (b.level < 3 && !b.site) {
    const u = A.upgradeInfo(b), next = b.level;
    const gains = [];
    if (d.cap) gains.push(`capacity ${d.cap[next - 1]}→${d.cap[next]}`);
    if (d.rate) gains.push(`output ${d.rate[next - 1]}→${d.rate[next]}/day`);
    if (d.stock) gains.push(`stock ${d.stock[next - 1]}→${d.stock[next]}`);
    if (d.trucks) gains.push(`trucks ${d.trucks[next - 1]}→${d.trucks[next]}`);
    if (d.radius) gains.push(`radius ${d.radius[next - 1]}→${d.radius[next]}`);
    if (d.needs) gains.push(`needs ${d.needs[next].map((g) => GOODS[g].icon).join('')}`);
    if (d.sells) gains.push(`sells ${d.sells[next].map((g) => GOODS[g].icon).join('')}`);
    const mats = u.mats ? Object.entries(u.mats).map(([g, n]) => GOODS[g].icon + n).join(' ') : '';
    const locked = !levelUnlocked(next + 1);
    const label = locked ? `⬆️ <small>🔒 Lv ${next + 1} at ${LEVEL_UNLOCK[next]} 👥</small>` : `⬆️ ${u.cost !== undefined ? '$' + fmt(u.cost) : ''} <small>${mats}</small>`;
    up = `<button class="btn" data-act="upgrade" ${u.can ? '' : 'disabled'} title="Upgrade to ${d.names[next]}: ${gains.join(', ')}">${label}</button>`;
    msg = (u.can || locked ? '' : `<p class="note">${u.msg}</p>`) + xtra(`<p class="note">${d.names[next]}: ${gains.join(' · ')}</p>`);
  }
  const canDemolish = b.type !== 'hub' || activeHubs().length > 1 || !b.built;
  const dem = canDemolish ? `<button class="btn danger icon" data-act="demolish" title="Demolish${d.player ? ` (+$${fmt(d.cost[L] * 0.3)})` : ''}">🧨</button>` : '';
  return up || dem ? `<div class="actions">${up}${dem}</div>${msg}` : '';
}

// ---------- fleet ----------
function fleet() {
  const hubs = Object.values(S.buildings).filter((b) => b.type === 'hub');
  const sites = Object.values(S.buildings).filter((b) => b.site);
  const busy = S.trucks.filter((t) => t.steps).length;
  return head('🚚', 'Fleet', `<span class="sub">${S.trucks.length} trucks · ${busy} busy</span>`)
    + sec('Hubs', hubs.map((h) => { const ts = hubTrucks(h.id), used = Object.values(h.inv).reduce((a, v) => a + v, 0), cap = BUILDINGS.hub.cap[h.level - 1];
      return `<button class="item" data-act="gohub" data-arg="${h.id}"><span class="ic">📦</span><span class="tx"><b>${BUILDINGS.hub.names[h.level - 1]}</b><small>${ts.filter((t) => t.steps).length}/${ts.length} busy · ${fmt(used)}/${cap}${h.built ? '' : ' · building'}</small></span></button>`; }).join(''))
    + sec('Construction sites', sites.length ? sites.map((b) => row(`${def(b).icon} ${def(b).names[b.site.upgrade ? b.level : 0]}`, isConnected(b) ? Math.round(Object.entries(b.site.need).reduce((a, [g, n]) => a + Math.min(n, b.site.got[g] || 0), 0) / Math.max(1, Object.values(b.site.need).reduce((a, v) => a + v, 0)) * 100) + '%' : '🚧 no road')).join('') : '<p class="note">None</p>')
    + xtra('<p class="note">Tip: if sites wait long, buy trucks or set a hub\'s priority to Build.</p>');
}
