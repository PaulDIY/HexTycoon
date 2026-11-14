// Bottom-sheet property inspector: selected building, tile, active tool or fleet overview. Tap the header to minimise it.
import { S, C, def, tileAt, hubTrucks } from './state.js';
import { BUILDINGS, ZONES, GOODS, ROAD, TERRAIN, TRUCK, PRIORITIES, LEVEL_UNLOCK, ZONE_COST, NEED_RATE } from './config.js';
import { hexDist } from './hex.js';
import { V } from './render.js';
import * as A from './actions.js';
import { isUnlocked, levelUnlocked, marketFactor, efficiency, terrainBonus, storesInRange } from './sim.js';
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
    else if (act === 'expgood' && b) A.setExport(b, arg);
    else if (act === 'expamt' && b) A.setExport(b, undefined, b.exp.amt + +arg);
    else if (act === 'spec') uiRef.tool = { ...uiRef.tool, spec: arg };
    else if (act === 'tilespec') { const t = V.selTile; if (t) { t.spec = arg; } }
    else if (act === 'gohub') { V.selected = arg; uiRef.fleet = false; }
    // depot rules
    else if (act === 'keepmode' && b) A.setKeepMode(b, arg === 'pick');
    else if (act === 'keepgood' && b) A.toggleKeep(b, arg);
    else if (act === 'keepmax' && b) { const [g, dl] = arg.split('|'); A.setKeepMax(b, g, +dl); }
    // routes
    else if (act === 'newroute' && b) { r = A.createRoute(b); if (r.ok) setTool({ kind: 'route', rid: r.r.id }); }
    else if (act === 'openroute') setTool({ kind: 'route', rid: arg });
    else if (act.startsWith('r-')) {
      const rt = S.routes.find((x) => x.id === uiRef.tool.rid);
      if (rt) {
        const [i, way, g] = (arg || '').split('|');
        if (act === 'r-truck') r = A.routeTruckDelta(rt, +arg);
        else if (act === 'r-good') r = A.toggleStopGood(rt, +i, way, g);
        else if (act === 'r-full') r = A.toggleStopFull(rt, +i);
        else if (act === 'r-del') r = A.removeStop(rt, +i);
        else if (act === 'r-done') { V.selected = rt.hub; setTool({ kind: 'select' }); }
        else if (act === 'r-delete') { A.deleteRoute(rt); V.selected = rt.hub; setTool({ kind: 'select' }); }
      }
    }
    if (!r.ok && r.msg) window.dispatchEvent(new CustomEvent('hv-toast', { detail: { text: r.msg, kind: 'err' } }));
    uiRef.inspDirty = true;
  });
  el.addEventListener('change', (e) => {
    const b = V.selected ? S.buildings[V.selected] : null;
    if (e.target.dataset.chg === 'prio' && b) { A.setPriority(b, e.target.value); uiRef.inspDirty = true; }
  });
}

let lastHTML = '';
// tools are switched by ui.js (it imports this module, so we ask it via an event)
const setTool = (t) => window.dispatchEvent(new CustomEvent('hv-tool', { detail: t }));

export function renderInspector(el, UI) {
  uiRef = UI; bind(el);
  // routes drawn on the map: the one being edited, or all routes of the selected hub
  const sel = V.selected && S.buildings[V.selected];
  V.routes = UI.tool.kind === 'route' ? [UI.tool.rid] : sel && sel.type === 'hub' ? S.routes.filter((r) => r.hub === sel.id).map((r) => r.id) : [];
  let html;
  if (UI.tool.kind === 'route') html = routeEditor(UI);
  else if (UI.fleet) html = fleet();
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
    return head(z.icon, `${z.name} zone`, `<span class="sub">$${ZONE_COST}/tile · ${z.coastal ? 'land next to water' : z.terrain.map((x) => TERRAIN[x].name).join(', ')}</span>`)
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
    return head(d.icon, d.names[0], `<span class="sub">$${A.placeCost(t.type)}</span>`)
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
const STATUS = { ok: ['✅', 'Working'], full: ['📦', 'Storage full'], noinput: ['⏳', 'Waiting for input'], idle: ['❔', 'Choose a good'], nostaff: ['👷', 'No workers'] };
const status = (b) => { const s = STATUS[b.status]; return s ? `<span class="sub">${s[0]} ${s[1]}</span>` : ''; };
function building(b) {
  const d = def(b), L = b.level - 1;
  const sub = `${stars(b.level)} ${b.site && !b.site.upgrade ? '<span class="sub">🚧 under construction</span>' : (d.kind === 'producer' || d.kind === 'processor' || d.kind === 'harbor') && b.built ? status(b) : ''}`;
  let h = head(d.icon, d.names[L], sub);
  if (d.desc) h += xtra(`<p class="note">${d.desc}</p>`);
  if (!isConnected(b)) h += `<div class="warnbox">🚧 No road to a Storage Hub</div>`;
  if (b.site) h += siteSec(b);
  if (b.built) h += staffWarn(b, d, L);
  if (b.built) {
    if (d.kind === 'house') h += houseSec(b, d, L);
    else if (d.kind === 'store') h += storeSec(b, d, L);
    else if (d.kind === 'producer') h += producerSec(b, d, L);
    else if (d.kind === 'processor') h += processorSec(b, d, L);
    else if (d.kind === 'hub') h += hubSec(b, d, L);
    else if (d.kind === 'harbor') h += harborSec(b, d, L);
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

// ---------- workers ----------
const per = (n) => (n >= 10 ? fmt(n) : (Math.round(n * 10) / 10).toString());
const jobs = (d, L) => (d.workers ? d.workers[L] : 0);
const staffKv = (b, d, L) => jobs(d, L) ? kv('👷', `${b.staff || 0}/${jobs(d, L)}`, 'Workers / jobs', (b.staff || 0) < jobs(d, L) ? 'bad' : '') : '';
function staffWarn(b, d, L) {
  const need = jobs(d, L), have = b.staff || 0;
  if (!need || have >= need || d.kind === 'hub') return '';
  const why = 'Every citizen already works somewhere: zone more houses. Hubs and stores get workers first, then companies oldest first.';
  if (!have) return `<div class="warnbox">👷 No workers (0/${need}): ${d.kind === 'store' ? 'closed, sells nothing' : 'produces nothing'}.</div>` + xtra(`<p class="note">${why}</p>`);
  return `<div class="warnbox">👷 ${have} of ${need} workers: ${d.kind === 'store' ? 'short-staffed' : `runs at ${Math.round(have / need * 100)}% speed`}.</div>` + xtra(`<p class="note">${why}</p>`);
}

// ---------- houses ----------
function houseSec(b, d, L) {
  const stores = storesInRange(b).filter((s) => s.staff);
  const rows = d.needs[L].map((g) => {
    const v = b.sat[g] ?? 0.6, sellers = stores.filter((s) => BUILDINGS.store.sells[s.level - 1].includes(g));
    const stock = sellers.reduce((a, s) => a + (s.inv[g] || 0), 0);
    const where = !sellers.length ? '<span class="bad">not sold nearby</span>' : `${fmt(stock)} in ${sellers.length} 🏪`;
    return `<span>${GOODS[g].icon} ${GOODS[g].name}</span><span class="n">${per(b.residents * NEED_RATE[g])}/d</span>
      <span class="sup">${bar(v, v < 0.4 ? 'warn' : '')}<small class="${v < 0.4 ? 'bad' : ''}">${Math.round(v * 100)}%</small></span><span class="n">${where}</span>`;
  }).join('');
  // happiness = 32 + goods·48 + (eco−50)·¼ − local pollution·6 − unemployment·30  (see sim.js tickHouse)
  const sat = d.needs[L].reduce((a, g) => a + (b.sat[g] ?? 0.6), 0) / d.needs[L].length;
  const lp = C.poll.get(key(b.q, b.r)) || 0, st = C.stats;
  const unemp = st && st.pop > 0 ? st.unemployed / st.pop : 0;
  const sgn = (n) => (n >= 0 ? '+' : '−') + Math.abs(Math.round(n));
  const parts = [`goods ${sgn(sat * 48)}`, `eco ${sgn(((C.eco ?? 100) - 50) * 0.25)}`];
  if (lp > 0.05) parts.push(`smog ${sgn(-lp * 6)}`);
  if (unemp > 0.01) parts.push(`no work ${sgn(-unemp * 30)}`);
  let grow;
  if (b.happy < 25) grow = '<div class="warnbox">😠 Unhappy: residents are moving out</div>';
  else if (b.residents >= d.cap[L]) grow = `<p class="note">🏠 Full.${b.level < 3 ? ' Upgrade for more room.' : ''}</p>`;
  else if (b.happy < 45) grow = '<div class="warnbox">Not growing: happiness must be at least 45%</div>';
  else if (st && st.demandR <= 0) grow = `<div class="warnbox">Not growing: no free jobs (${fmt(st.pop)} citizens, ${fmt(st.jobs)} jobs). New companies bring jobs.</div>`;
  else grow = '<p class="note">📈 Growing: new residents move in</p>';
  return kvs(kv('👥', `${b.residents}/${d.cap[L]}`, 'Residents / room'), kv(b.happy < 35 ? '☹️' : '🙂', Math.round(b.happy) + '%', 'Happiness', b.happy < 35 ? 'bad' : ''),
      kv('💰', '$' + (b.residents * d.tax[L] * b.happy / 100).toFixed(1) + '/d', 'Taxes'))
    + `<div class="sec wide"><h4>Needs</h4><div class="gtab g4"><small>Good</small><small class="n">Uses</small><small>Supplied</small><small class="n">Nearby</small>${rows}</div></div>`
    + grow + xtra(`<p class="note">Map: <b style="color:#2ec4ff">blue</b> stores are in walking range${storesInRange(b).some((s) => !s.staff) ? ', <b style="color:#e64632">red</b> ones are closed (no workers)' : ''}.</p><p class="note">🙂 ${Math.round(b.happy)}% = 32 ${parts.join(' ')}${stores.length ? '' : ' · No open store in walking range'}</p>`);
}

// ---------- stores ----------
function storeSec(b, d, L) {
  const sells = d.sells[L], cap = Math.floor(d.stock[L] / sells.length), range = d.range[L];
  const houses = Object.values(S.buildings).filter((h) => h.built && h.type === 'house' && hexDist(h.q, h.r, b.q, b.r) <= range);
  const people = houses.reduce((a, h) => a + h.residents, 0);
  const rows = sells.map((g) => {
    let demand = 0, share = 0; // share: this store's part when a house can shop at several stores
    for (const h of houses) {
      if (!BUILDINGS.house.needs[h.level - 1].includes(g)) continue;
      const n = h.residents * NEED_RATE[g];
      const others = storesInRange(h).filter((s) => s.staff && BUILDINGS.store.sells[s.level - 1].includes(g)).length;
      demand += n; share += n / Math.max(1, others);
    }
    const have = b.inv[g] || 0, inc = (b.incoming[g] || 0) > 0;
    const lasts = share > 0 ? (have / share < 1 ? '<span class="bad">&lt;1 d</span>' : per(have / share) + ' d') : '—';
    return `<span>${GOODS[g].icon} ${GOODS[g].name}</span><span class="n ${have < 2 ? 'bad' : ''}">${fmt(have)}/${cap}${inc ? ' 🚚' : ''}</span>
      <span class="n">${per(share)}${demand > share + 0.05 ? `<small> of ${per(demand)}</small>` : ''}/d</span><span class="n">${lasts}</span>`;
  }).join('');
  const missing = {};
  for (const h of houses) for (const g of BUILDINGS.house.needs[h.level - 1]) if (!sells.includes(g)) missing[g] = (missing[g] || 0) + 1;
  const miss = Object.entries(missing).map(([g, n]) => `${n} house${n > 1 ? 's' : ''} also need ${GOODS[g].icon} ${GOODS[g].name}`);
  return kvs(kv('🏠', houses.length, 'Houses in walking range'), kv('👥', fmt(people), 'Citizens supplied'), kv('🚶', range, 'Walking range (tiles)'), staffKv(b, d, L))
    + `<div class="sec wide"><h4>Stock &amp; sales</h4><div class="gtab g4"><small>Good</small><small class="n">Stock</small><small class="n">Sells</small><small class="n">Lasts</small>${rows}</div></div>`
    + (miss.length ? `<p class="note">⚠️ ${miss.join(' · ')}: ${b.level < 3 ? 'upgrade this store or ' : ''}build a bigger store nearby.</p>` : '')
    + xtra(`<p class="note">Map: <b style="color:#2ec4ff">blue</b> houses get all they need here, <b style="color:#ffb020">amber</b> only some. “Sells” is this store's share when houses can shop at several stores.</p>`)
    + (houses.length ? '' : '<div class="warnbox">No houses in walking range</div>');
}

// ---------- production: input ➜ recipe ➜ output ----------
const flow = (inp, mid, out) => `<div class="flow"><div><h4>Input</h4>${inp}</div><div class="mid"><h4>Recipe</h4>${mid}</div><div><h4>Output</h4>${out}</div></div>`;
// output per day right now (0 while stopped) and the speed factors behind it
function speed(b, d, L) {
  const e = efficiency(b), base = d.rate[L], now = b.status === 'ok' ? base * e : 0;
  const why = [];
  if ((b.staff || 0) < jobs(d, L)) why.push(`👷 ${Math.round((b.staff || 0) / jobs(d, L) * 100)}%`);
  const tb = terrainBonus(b); if (tb !== 1) why.push(`${d.bonus === 'forest' ? '🌲' : '🌱'} ×${tb.toFixed(2).replace(/0$/, '')}`);
  return { now, base, why };
}
const rateLine = (sp, unit) => `<small class="${sp.now < sp.base * 0.5 ? 'bad' : ''}">${per(sp.now)}${sp.now !== sp.base ? ` of ${sp.base}` : ''}${unit}/day</small>${sp.why.length ? `<small> ${sp.why.join(' ')}</small>` : ''}`;
const outChip = (g, have, cap) => `<div class="chips">${chip(g, `${fmt(have)}/${cap}`, have >= cap ? 'miss' : '')}</div>${bar(have / cap, have >= cap ? 'warn' : '')}`;

function producerSec(b, d, L) {
  const have = b.inv[d.out] || 0, t = tileAt(b.q, b.r), sp = speed(b, d, L);
  let src = `<div class="chips"><span class="chip">${TERRAIN[t.terrain].name}</span></div>`;
  if (d.bonus === 'fertile') src += `<small>${t.terrain === 'fertile' ? '🌱 fertile +30%' : 'fertile soil +30%'}</small>`;
  if (d.bonus === 'forest') src += `<small>🌲 forest nearby ×${terrainBonus(b).toFixed(1)}</small>`;
  return flow(src, `<div class="rec">➜ 1 ${GOODS[d.out].icon}</div>${rateLine(sp, '')}`,
      outChip(d.out, have, d.buf[L]) + `<small>${have >= d.buf[L] ? 'full: waiting for trucks' : 'trucks collect'}</small>`)
    + kvs(staffKv(b, d, L));
}
function processorSec(b, d, L) {
  const r = d.recipe, sp = speed(b, d, L), cyc = sp.now;
  const ins = Object.entries(r.in).map(([g, n]) => chip(g, fmt(b.inv[g] || 0) + ((b.incoming[g] || 0) > 0 ? ' 🚚' : ''), (b.inv[g] || 0) < n ? 'miss' : '')).join(' ');
  const use = Object.entries(r.in).map(([g, n]) => `${GOODS[g].icon}${per(n * (cyc || sp.base))}`).join(' ');
  const outT = Object.keys(r.out).reduce((a, g) => a + (b.inv[g] || 0), 0);
  const outs = Object.keys(r.out).map((g) => chip(g, `${fmt(b.inv[g] || 0)}/${d.buf[L]}`, outT >= d.buf[L] ? 'miss' : '')).join(' ');
  const recipe = `${Object.entries(r.in).map(([g, n]) => n + GOODS[g].icon).join(' + ')} ➜ ${Object.entries(r.out).map(([g, n]) => n + GOODS[g].icon).join(' + ')}`;
  return flow(`<div class="chips">${ins}</div><small>${cyc ? 'uses' : 'needs'} ${use}/day</small>`,
      `<div class="rec">${recipe}</div>${rateLine(sp, '×')}`,
      `<div class="chips">${outs}</div>${bar(outT / d.buf[L], outT >= d.buf[L] ? 'warn' : '')}<small>${outT >= d.buf[L] ? 'full: waiting for trucks' : 'trucks collect'}</small>`)
    + kvs(staffKv(b, d, L));
}
const PRIO_SHORT = { balanced: '⚖️ Balanced', construction: '🏗️ Build', supply: '🛒 Supply', collect: '📥 Collect' };
function hubSec(b, d, L) {
  const used = Object.values(b.inv).reduce((a, v) => a + v, 0);
  const trucks = hubTrucks(b.id), ti = A.truckInfo(b);
  const busy = trucks.filter((t) => t.steps).length;
  return `<div class="sec"><h4>Storage · ${fmt(used)}/${d.cap[L]}</h4>${bar(used / d.cap[L], used / d.cap[L] > 0.9 ? 'warn' : '')}
      <div class="chips">${Object.entries(b.inv).filter(([, n]) => n >= 1).map(([g, n]) => chip(g, n)).join(' ') || '<span class="note">empty</span>'}</div>
      ${hubFree(b) < 5 ? '<div class="warnbox">Hub is full</div>' : ''}${kvs(staffKv(b, d, L))}</div>`
    + `<div class="sec span2"><h4>${TRUCK.names[L]}s ·${ti.n}/${ti.max} · ${busy} busy</h4>
      <div class="btnrow"><button class="btn" data-act="buytruck" ${ti.n >= ti.max ? 'disabled' : ''} title="Buy a ${TRUCK.names[L]}">🚚 +$${ti.cost}</button><button class="btn sec2 sell" data-act="selltruck" ${ti.n ? '' : 'disabled'} title="Sell a truck">Sell</button>
      <select class="btn sec2" data-chg="prio" title="Transport priority">${Object.keys(PRIORITIES).map((k) => `<option value="${k}" ${b.priority === k ? 'selected' : ''}>${PRIO_SHORT[k]}</option>`).join('')}</select></div></div>`
    + keepSec(b, d, L) + routesSec(b);
}

// depot rules: which goods free trucks bring to this hub, and how many
function keepSec(b, d, L) {
  const step = A.keepStep(b);
  const mode = `<div class="seg"><button data-act="keepmode" data-arg="auto" class="${b.keep ? '' : 'on'}">Any good</button><button data-act="keepmode" data-arg="pick" class="${b.keep ? 'on' : ''}">Chosen goods</button></div>`;
  if (!b.keep) return `<div class="sec wide"><h4>Stores</h4>${mode}${xtra(`<p class="note">Free trucks bring any good here, up to ${Math.round(d.cap[L] * 0.35)} of each.</p>`)}</div>`;
  const grid = `<div class="goods">${Object.keys(GOODS).map((g) => `<button data-act="keepgood" data-arg="${g}" class="${g in b.keep ? 'on' : ''}" title="${GOODS[g].name}">${GOODS[g].icon}</button>`).join('')}</div>`;
  const rows = Object.entries(b.keep).map(([g, max]) => `<span>${GOODS[g].icon} ${GOODS[g].name}</span><span class="n ${(b.inv[g] || 0) >= max ? 'bad' : ''}">${fmt(b.inv[g] || 0)}</span>
    <span class="mini-step"><button data-act="keepmax" data-arg="${g}|${-step}" ${max <= 0 ? 'disabled' : ''}>−</button><b>${max}</b><button data-act="keepmax" data-arg="${g}|${step}">+</button></span>`).join('');
  const sum = Object.values(b.keep).reduce((a, v) => a + v, 0);
  return `<div class="sec wide"><h4>Stores · chosen goods</h4>${mode}${grid}
    ${rows ? `<div class="gtab g3"><small>Good</small><small class="n">Stock</small><small class="n">Max</small>${rows}</div>` : '<p class="note">Tap goods above to store them here.</p>'}
    ${sum > d.cap[L] ? `<p class="note">Limits add up to ${fmt(sum)}, more than the ${d.cap[L]} space.</p>` : ''}
    ${xtra('<p class="note">Free trucks only bring these goods here. Routes can still unload anything.</p>')}</div>`;
}

const stopIcons = (r) => r.stops.map((st) => { const x = S.buildings[st.b]; return x ? def(x).icon : '❔'; }).join('→') || 'no stops';
function routesSec(b) {
  const rs = S.routes.filter((r) => r.hub === b.id);
  const list = rs.map((r) => `<button class="item" data-act="openroute" data-arg="${r.id}"><span class="rdot" style="background:${r.color}"></span><span class="tx"><b>${r.name}</b>
    <small>${stopIcons(r)} · 🚚 ${A.routeTrucks(r).length} · ${fmt(r.lastMoved || 0)}/day</small></span></button>`).join('');
  const free = hubTrucks(b.id).filter((t) => !t.route).length;
  return `<div class="sec wide"><h4>Routes</h4>${list}<button class="btn sec2" data-act="newroute">＋ New route</button>
    ${xtra(`<p class="note">${free} truck${free === 1 ? '' : 's'} without a route drive on their own: construction and everything no route covers.</p>`)}</div>`;
}

// ---------- route editor (map taps add stops while it is open) ----------
const gbtn = (i, way, g, on) => `<button class="g ${on ? 'on' : ''}" data-act="r-good" data-arg="${i}|${way}|${g}" title="${way} ${g === '*' ? 'everything' : GOODS[g].name}">${g === '*' ? 'all' : GOODS[g].icon}</button>`;
function routeEditor(UI) {
  const r = S.routes.find((x) => x.id === UI.tool.rid);
  if (!r) return '<p class="note">This route no longer exists.</p>';
  const hub = S.buildings[r.hub], ts = A.routeTrucks(r), cap = TRUCK.cap[hub.level - 1];
  const free = hubTrucks(hub.id).filter((t) => !t.route).length, ti = A.truckInfo(hub);
  const stops = r.stops.map((st, i) => {
    const x = S.buildings[st.b]; if (!x) return '';
    const o = A.stopOptions(x), dx = def(x);
    const load = o.load.length ? `<span class="way">⬆</span>${o.load.map((g) => gbtn(i, 'load', g, st.load.includes(g))).join('')}` : '';
    const unload = o.unload.length ? `<span class="way">⬇</span>${o.unload.map((g) => gbtn(i, 'unload', g, st.unload.includes(g))).join('')}` : '';
    return `<div class="stop"><span class="num" style="background:${r.color}">${i + 1}</span>
      <div class="sb"><div class="sn">${dx.icon} ${dx.names[x.level - 1]}</div><div class="sg">${unload}${load}</div></div>
      ${st.load.length ? `<button class="g ${st.full ? 'on' : ''}" data-act="r-full" data-arg="${i}" title="Wait for a full load">⏳</button>` : ''}
      <button class="g x" data-act="r-del" data-arg="${i}" title="Remove stop">✕</button></div>`;
  }).join('');
  const hint = r.stops.length < 2 ? `<div class="warnbox">👆 Tap ${r.stops.length ? 'the next building' : 'buildings on the map in order'} to add stops. The trucks loop through them.</div>`
    : '<p class="note">👆 Tap more buildings to add stops. ⬇ unload, ⬆ load, ⏳ wait for a full load.</p>';
  const warn = r.stops.length >= 2 && !ts.length ? '<div class="warnbox">Add a truck to start this route</div>' : '';
  return head('🛣️', r.name, `<span class="sub"><span class="rdot" style="background:${r.color}"></span> ${BUILDINGS.hub.names[hub.level - 1]}</span>`)
    + kvs(kv('📦', fmt(r.lastMoved || 0) + '/d', 'Units delivered yesterday'), kv('⏱️', r.loopT ? r.loopT.toFixed(1) + ' d' : '–', 'Time for one round trip'), kv('🚛', cap, 'Capacity per truck'))
    + `<div class="sec wide"><h4>Trucks</h4><div class="stepper"><button class="btn sec2" data-act="r-truck" data-arg="-1" ${ts.length ? '' : 'disabled'}>−</button>
      <span class="amt"><b>${ts.length}</b> on route · ${free} free${ti.n < ti.max ? ` · +$${ti.cost} new` : ''}</span><button class="btn sec2" data-act="r-truck" data-arg="1" ${free || ti.n < ti.max ? '' : 'disabled'}>+</button></div></div>`
    + `<div class="sec wide"><h4>Stops</h4>${stops}</div>` + hint + warn
    + `<div class="actions"><button class="btn" data-act="r-done">Done</button><button class="btn danger icon" data-act="r-delete" title="Delete route">🗑️</button></div>`;
}

// harbor: pick the export good and the amount shipped per day
function harborSec(b, d, L) {
  const e = b.exp, max = d.maxExport[L], step = max <= 10 ? 1 : 5;
  const price = (g) => GOODS[g].value * d.price[L] * marketFactor(g);
  const goods = Object.keys(GOODS).map((g) => `<button data-act="expgood" data-arg="${g}" class="${e.g === g ? 'on' : ''}" title="${GOODS[g].name}: $${price(g).toFixed(2)} each">${GOODS[g].icon}</button>`).join('');
  let info = '<div class="warnbox">Choose a good to export</div>';
  if (e.g) {
    const inHubs = activeHubs().reduce((a, h) => a + (h.inv[e.g] || 0), 0);
    const target = Math.min(d.stock[L], Math.max(8, e.amt * 2));
    info = kvs(kv('🚢', `${fmt(b.inv[e.g] || 0)}/${target}`, 'Waiting at the quay'), kv('🏙️', fmt(inHubs), `${GOODS[e.g].name} in your hubs`),
      kv('💰', `$${fmt(price(e.g) * e.amt)}/d`, 'Income at full rate'), kv('Σ', '$' + fmt(b.sold || 0), 'Earned so far'), staffKv(b, d, L));
    const f = marketFactor(e.g);
    if (f < 0.9) info += `<p class="note">📉 ${GOODS[e.g].name} market saturated: price −${Math.round((1 - f) * 100)}%. Exporting a second good pays more; prices recover over a few days.</p>`;
  }
  return `<div class="sec wide"><h4>Export${e.g ? ' · ' + GOODS[e.g].name + ' · $' + price(e.g).toFixed(2) + ' each' : ''}</h4><div class="goods">${goods}</div></div>
    <div class="sec wide"><h4>Sell per day</h4><div class="stepper"><button class="btn sec2" data-act="expamt" data-arg="${-step}" ${e.amt <= 0 ? 'disabled' : ''}>−</button>
      <span class="amt"><b>${e.amt}</b> / ${max}</span><button class="btn sec2" data-act="expamt" data-arg="${step}" ${e.amt >= max ? 'disabled' : ''}>+</button></div>${info}</div>`;
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
    if (d.maxExport) gains.push(`export ${d.maxExport[next - 1]}→${d.maxExport[next]}/day`);
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
