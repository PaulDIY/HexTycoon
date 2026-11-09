// Build menu (left), tools, HUD, toasts and modals.
import { S, C, def, bAt } from './state.js';
import { BUILDINGS, ZONES, ROAD, GOALS, DAY, ZONE_COST, LEVEL_UNLOCK } from './config.js';
import { V } from './render.js';
import { hexLine } from './hex.js';
import { tileAt } from './state.js';
import * as A from './actions.js';
import { isUnlocked, computeStats } from './sim.js';
import { renderInspector } from './inspector.js';

export const UI = { tool: { kind: 'select' }, cat: null, stroke: [], inspDirty: true, fleet: false };
const $ = (id) => document.getElementById(id);
const fmt = (n) => (Math.abs(n) >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toLocaleString());
export { fmt };

// ---------- categories ----------
const CATS = [
  { id: 'select', ic: '👆', lb: 'Select', tool: { kind: 'select' } },
  { id: 'zones', ic: '🗺️', lb: 'Zones', items: () => [
    ...Object.entries(ZONES).map(([z, d]) => ({ ic: d.icon, name: d.name, sub: `$${ZONE_COST}/tile · ${d.terrain.join(', ')}`, sw: d.color, tool: { kind: 'zone', zone: z, spec: 'auto' } })),
    { ic: '🧽', name: 'Remove zone', sub: 'Clears zoning only', tool: { kind: 'unzone' } }] },
  { id: 'roads', ic: '🛣️', lb: 'Roads', items: () => ROAD.names.map((n, i) => ({
    ic: ['🟫', '⬛', '🟩'][i], name: n, sub: `$${ROAD.cost[i]}/tile · speed ×${ROAD.speed[i]}`, locked: LEVEL_UNLOCK[i] > S.maxPop,
    lockMsg: `Unlocks at ${LEVEL_UNLOCK[i]} citizens`, tool: { kind: 'road', level: i + 1 } })) },
  { id: 'logi', ic: '📦', lb: 'Logistics', items: () => [
    { ic: '📦', name: BUILDINGS.hub.names[0], sub: `$${BUILDINGS.hub.cost[0]} · storage + trucks`, tool: { kind: 'build', type: 'hub' } },
    { ic: '🚚', name: 'Fleet overview', sub: 'All hubs and trucks', action: () => { UI.fleet = true; V.selected = null; setTool({ kind: 'select' }); UI.inspDirty = true; openInspector(); } }] },
  { id: 'eco', ic: '🌳', lb: 'Eco', items: () => [
    { ic: '🌳', name: BUILDINGS.park.names[0], sub: `$${BUILDINGS.park.cost[0]} · absorbs pollution`, tool: { kind: 'build', type: 'park' } },
    { ic: '☀️', name: 'Solar Farm', sub: 'Coming soon: power grid', locked: true, lockMsg: 'Power supply is coming in a future update' },
    { ic: '🔌', name: 'Power Line', sub: 'Coming soon: power grid', locked: true, lockMsg: 'Power grid is coming in a future update' }] },
  { id: 'bulldoze', ic: '🧨', lb: 'Remove', tool: { kind: 'bulldoze' } },
];

export function initUI() {
  const menu = $('buildmenu');
  menu.innerHTML = CATS.map((c) => `<button class="cat" data-cat="${c.id}"><span class="ic">${c.ic}</span><span class="lb">${c.lb}</span></button>`).join('');
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('.cat'); if (!btn) return;
    const c = CATS.find((x) => x.id === btn.dataset.cat);
    if (c.tool) { closeFlyout(); setTool(c.tool); return; }
    if (UI.cat === c.id) { closeFlyout(); return; }
    openFlyout(c);
  });
  $('flyout').addEventListener('click', (e) => {
    const btn = e.target.closest('.item'); if (!btn) return;
    const c = CATS.find((x) => x.id === UI.cat), it = c.items()[+btn.dataset.i];
    if (it.locked) { toast(it.lockMsg || 'Locked', 'err'); return; }
    closeFlyout();
    if (it.action) it.action(); else setTool(it.tool);
  });
  $('insp-close').addEventListener('click', () => { V.selected = null; UI.fleet = false; V.range = null; if (UI.tool.kind !== 'select') setTool({ kind: 'select' }); closeInspector(); });
  $('speed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSpeed(+b.dataset.speed); });
  $('btn-menu').addEventListener('click', showMenu);
  $('btn-goal').addEventListener('click', showGoals);
  $('hud-money').addEventListener('click', showFinance);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  syncMenu();
}

function openFlyout(c) {
  UI.cat = c.id;
  const items = c.items();
  const fly = $('flyout');
  fly.innerHTML = `<h3>${c.lb}</h3>` + items.map((it, i) => {
    const on = it.tool && sameTool(it.tool, UI.tool);
    return `<button class="item ${on ? 'on' : ''} ${it.locked ? 'locked' : ''}" data-i="${i}"><span class="ic">${it.ic}</span><span class="tx"><b>${it.name}</b><small>${it.locked && it.lockMsg ? '🔒 ' + it.lockMsg : it.sub}</small></span>${it.sw ? `<span class="sw" style="background:${it.sw}"></span>` : ''}</button>`;
  }).join('');
  fly.classList.remove('hidden');
  syncMenu(); syncPanelClass();
}
export function closeFlyout() { UI.cat = null; $('flyout').classList.add('hidden'); syncMenu(); syncPanelClass(); }
function syncPanelClass() { document.body.classList.toggle('panel-open', !!UI.cat || !$('inspector').classList.contains('collapsed')); syncSheet(); }
// expose the bottom sheet's height so toasts and the build menu stay clear of it
export function syncSheet() {
  const ins = $('inspector');
  if (!ins) return;
  const h = ins.classList.contains('collapsed') ? 0 : Math.ceil(ins.offsetHeight + 6);
  document.documentElement.style.setProperty('--sheet-h', h + 'px');
}
if (typeof ResizeObserver !== 'undefined') queueMicrotask(() => { const el = $('inspector'); if (el) new ResizeObserver(syncSheet).observe(el); });
window.addEventListener('resize', () => syncSheet());
const sameTool = (a, b) => a.kind === b.kind && a.zone === b.zone && a.level === b.level && a.type === b.type;

function syncMenu() {
  const active = CATS.find((c) => c.tool ? sameTool(c.tool, UI.tool) : c.items && c.items().some((it) => it.tool && sameTool(it.tool, UI.tool)));
  document.querySelectorAll('.cat').forEach((b) => b.classList.toggle('on', b.dataset.cat === UI.cat || (!UI.cat && active && b.dataset.cat === active.id)));
}

export function setTool(t) {
  UI.tool = t; UI.stroke = []; V.preview = [];
  if (t.kind !== 'select') { V.selected = null; UI.fleet = false; }
  V.range = null;
  if (t.kind === 'build' && t.type === 'park') V.range = null;
  UI.inspDirty = true;
  if (t.kind === 'select' && !V.selected && !UI.fleet) closeInspector(); else openInspector();
  syncMenu();
}
export function openInspector() { $('inspector').classList.remove('collapsed'); UI.inspDirty = true; syncPanelClass(); }
export function closeInspector() { $('inspector').classList.add('collapsed'); syncPanelClass(); }

export function setSpeed(n) {
  S.speed = n;
  document.querySelectorAll('#speed button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === n));
}

// ---------- toasts ----------
let lastErr = '', lastErrT = 0;
export function toast(text, kind = '') {
  if (kind === 'err') { const now = performance.now(); if (text === lastErr && now - lastErrT < 1500) return; lastErr = text; lastErrT = now; }
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = text;
  const box = $('toasts'); box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), kind === 'err' ? 1800 : 3600);
}

// ---------- map interaction handlers (used by input.js) ----------
const paintKinds = ['zone', 'unzone', 'road', 'bulldoze'];
function applyTile(t) {
  const tool = UI.tool;
  if (!t) return { ok: false, msg: 'Outside the map' };
  switch (tool.kind) {
    case 'zone': return A.zoneTile(t, tool.zone, tool.spec);
    case 'unzone': if (t.zone && !t.b) { t.zone = null; t.spec = null; C.groundDirty = true; return { ok: true }; } return { ok: false, msg: 'No zone here' };
    case 'road': return A.buildRoad(t, tool.level);
    case 'bulldoze': return A.demolish(t);
    case 'build': return A.place(tool.type, t);
  }
  return { ok: false };
}
function previewOk(t) {
  const tool = UI.tool;
  if (!t) return false;
  if (tool.kind === 'zone') return A.canZone(t, tool.zone).ok || (t.zone === tool.zone);
  if (tool.kind === 'road') return A.canRoad(t, tool.level).ok || t.road >= tool.level;
  if (tool.kind === 'build') return A.canPlace(tool.type, t).ok;
  if (tool.kind === 'bulldoze') return !!(t.b || t.road || t.zone);
  if (tool.kind === 'unzone') return !!t.zone;
  return true;
}

export const mapHandlers = {
  paints: () => paintKinds.includes(UI.tool.kind),
  hover(t) { V.hover = t; if (t && UI.tool.kind !== 'select' && !UI.stroke.length) { V.preview = [t]; V.previewOk = previewOk(t); } else if (!UI.stroke.length) V.preview = []; },
  tap(t) {
    if (UI.tool.kind === 'select') { select(t); return; }
    const r = applyTile(t);
    if (!r.ok && r.msg) toast(r.msg, 'err');
    if (r.ok && UI.tool.kind === 'build') { V.selected = r.b.id; setTool({ kind: 'select' }); toast(`🏗️ ${BUILDINGS[r.b.type].names[0]} placed — trucks will bring materials`); }
    UI.inspDirty = true;
  },
  paintStart(t) { UI.stroke = t ? [t] : []; updateStroke(); },
  paintMove(t) {
    if (!t) return;
    const last = UI.stroke[UI.stroke.length - 1];
    if (last === t) return;
    const seg = last ? hexLine(last.q, last.r, t.q, t.r).slice(1).map(([q, r]) => tileAt(q, r)).filter(Boolean) : [t];
    for (const x of seg) if (!UI.stroke.includes(x)) UI.stroke.push(x);
    updateStroke();
  },
  paintEnd() {
    let n = 0, err = null;
    for (const t of UI.stroke) { const r = applyTile(t); if (r.ok) n++; else if (!err && r.msg && r.msg !== 'Already zoned' && r.msg !== 'Already built') err = r.msg; }
    if (err && !n) toast(err, 'err'); else if (err) toast(`${n} applied · some skipped: ${err}`, 'err');
    UI.stroke = []; V.preview = []; UI.inspDirty = true;
  },
  paintCancel() { UI.stroke = []; V.preview = []; },
  escape() { closeFlyout(); V.selected = null; UI.fleet = false; setTool({ kind: 'select' }); closeInspector(); },
  togglePause() { setSpeed(S.speed ? 0 : 1); },
};
function updateStroke() {
  V.preview = UI.stroke.filter(previewOk);
  V.previewOk = true;
  UI.inspDirty = true;
}
export function strokeCost() {
  const tool = UI.tool;
  if (tool.kind === 'road') return UI.stroke.reduce((a, t) => a + (A.canRoad(t, tool.level).ok ? A.roadCost(t, tool.level) : 0), 0);
  if (tool.kind === 'zone') return UI.stroke.filter((t) => A.canZone(t, tool.zone).ok).length * ZONE_COST;
  return 0;
}

function select(t) {
  UI.fleet = false;
  const b = bAt(t);
  V.selected = b ? b.id : null;
  V.selTile = b ? null : t;
  V.range = null;
  if (b) {
    const d = def(b);
    if (b.type === 'store') V.range = { q: b.q, r: b.r, rad: d.range[b.level - 1], color: '#3d97df' };
    if (b.type === 'park') V.range = { q: b.q, r: b.r, rad: d.radius[b.level - 1], color: '#2f8f4e' };
    if (b.type === 'house') V.range = { q: b.q, r: b.r, rad: 5, color: '#5dbb52' };
  }
  if (b || t) openInspector(); else closeInspector();
  UI.inspDirty = true;
}

// ---------- HUD ----------
let hudT = 0, inspT = 0;
export function updateUI(dt) {
  hudT -= dt; inspT -= dt;
  if (hudT <= 0) {
    hudT = 0.25;
    const st = C.stats || computeStats();
    $('money').textContent = '$' + fmt(S.money);
    const net = S.ledger.lastIncome - S.ledger.lastExpense;
    const n = $('net'); n.textContent = (net >= 0 ? '+' : '') + fmt(net) + '/d'; n.className = net >= 0 ? 'pos' : 'neg';
    $('pop').textContent = fmt(st.pop);
    $('jobs').textContent = `${fmt(st.jobs)} jobs`;
    $('eco').textContent = C.eco ?? 100;
    $('day').textContent = 'Day ' + (Math.floor(S.time / DAY) + 1);
    const bar = (id, v) => { $(id).style.height = Math.max(2, Math.min(22, 11 + v * 11)) + 'px'; $(id).style.opacity = v > 0 ? 1 : 0.35; };
    bar('dR', st.demandR); bar('dC', st.demandC); bar('dI', st.demandI);
    const g = GOALS[S.goal];
    $('goalbar').textContent = g ? `🎯 ${g.text} · +$${g.reward}` : '';
  }
  if (inspT <= 0 || UI.inspDirty) {
    inspT = 0.35;
    if (!$('inspector').classList.contains('collapsed') && !insPointerDown) { renderInspector($('insp-body'), UI); UI.inspDirty = false; }
  }
}
let insPointerDown = false;
document.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('#inspector')) insPointerDown = true; }, true);
document.addEventListener('pointerup', () => { setTimeout(() => (insPointerDown = false), 0); }, true);

// ---------- modals ----------
export function showModal(html) { $('modal-card').innerHTML = html; $('modal').classList.remove('hidden'); }
export function closeModal() { $('modal').classList.add('hidden'); }

export const HELP = `
<h1>🌿 Hexaverde</h1>
<p>Grow a sustainable city economy. Zone land, connect it with roads and run the trucks that move every good.</p>
<ul>
<li><b>Zones</b> (left menu): paint areas for homes, shops, farms, forestry, mining and industry. Companies move in on their own, but only on tiles <b>next to a road</b>.</li>
<li><b>Construction</b>: every new building and upgrade needs materials. Your trucks bring them from a <b>Storage Hub</b>.</li>
<li><b>Logistics</b>: trucks collect goods from producers, supply factories and stores, and deliver straight from producer to consumer when they can. Buy more trucks and set priorities on a hub.</li>
<li><b>Citizens</b> buy food (later clothes and furniture) at stores within walking range. Happy citizens pay more taxes. Companies pay taxes on what they produce.</li>
<li><b>Eco score</b>: industry and trucks pollute. Forests and parks absorb it. Level 3 upgrades are much cleaner.</li>
<li><b>Upgrades</b>: select anything and upgrade it up to level 3. Level 2 unlocks at 40 citizens, level 3 at 200.</li>
</ul>
<p><b>Controls</b>: one finger pans (Select tool) or paints (zone/road/remove tools). Two fingers move, pinch-zoom and rotate. On desktop: right-drag pans, wheel zooms, Q/E rotates, Space pauses.</p>
<button class="btn" data-close>Let's build</button>`;

function showMenu() {
  showModal(`<h1>Menu</h1>
    <button class="btn" data-close>▶ Resume</button>
    <button class="btn sec2" id="m-save">💾 Save now</button>
    <button class="btn sec2" id="m-help">❓ How to play</button>
    <button class="btn sec2" id="m-full">⛶ Fullscreen</button>
    <button class="btn danger" id="m-new">🔄 New game</button>
    <p class="note">The game autosaves in this browser every 20 seconds.</p>`);
  $('m-save').onclick = () => { window.dispatchEvent(new Event('hv-save')); toast('💾 Saved'); closeModal(); };
  $('m-help').onclick = () => showModal(HELP);
  $('m-full').onclick = () => { const d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen || (() => toast('Fullscreen not supported', 'err'))).call(d); closeModal(); };
  $('m-new').onclick = () => {
    showModal(`<h1>Start a new game?</h1><p>Your current city will be replaced.</p>
      <div class="btnrow"><button class="btn sec2" data-close>Cancel</button><button class="btn danger" id="m-new2">New game</button></div>`);
    $('m-new2').onclick = () => { window.dispatchEvent(new Event('hv-new')); closeModal(); };
  };
}
function showGoals() {
  showModal(`<h1>🎯 Goals</h1><ol class="goal-list">${GOALS.map((g, i) => `<li class="${i < S.goal ? 'done' : i === S.goal ? 'cur' : ''}">${g.text} <small>(+$${g.reward})</small></li>`).join('')}</ol>
    <button class="btn" data-close>Close</button>`);
}
function showFinance() {
  const st = C.stats || computeStats();
  showModal(`<h1>💰 Finances</h1>
    <div class="row"><span>Income yesterday</span><span class="v">+$${fmt(S.ledger.lastIncome)}</span></div>
    <div class="row"><span>Expenses yesterday</span><span class="v">−$${fmt(S.ledger.lastExpense)}</span></div>
    <div class="row"><span>Upkeep (roads, hubs, trucks, parks)</span><span class="v">$${st.upkeep.toFixed(1)}/day</span></div>
    <div class="row"><span>Citizens / jobs</span><span class="v">${st.pop} / ${st.jobs}</span></div>
    <div class="row"><span>Employment</span><span class="v">${Math.round(st.employment * 100)}%</span></div>
    <p class="note">Citizens pay tax by happiness. Companies pay ${Math.round(0.4 * 100)}% of the value they produce, stores ${Math.round(0.5 * 100)}% of sales.</p>
    <button class="btn" data-close>Close</button>`);
}
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-close]')) closeModal(); });
