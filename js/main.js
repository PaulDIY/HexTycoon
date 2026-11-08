// Entry point: boot, game loop, autosave.
import { S, C, newGame, serialize, deserialize } from './state.js';
import { TICK, MAP_RADIUS } from './config.js';
import { tick, computeStats, refreshDerived } from './sim.js';
import { initRender, frame, V, centerOn } from './render.js';
import { initInput, zoomAt, rotateBy } from './input.js';
import { initUI, updateUI, mapHandlers, toast, setSpeed, showModal, HELP, UI, closeInspector, setTool } from './ui.js';
import { BUILDINGS } from './config.js';
import * as Actions from './actions.js';
import { tileAt } from './state.js';

const SAVE_KEY = 'hexaverde-save-v1';
const canvas = document.getElementById('view');

function save() {
  try { localStorage.setItem(SAVE_KEY, serialize()); } catch (e) { /* storage unavailable */ }
}
function load() {
  try { const j = localStorage.getItem(SAVE_KEY); if (j) { deserialize(j); return true; } } catch (e) { console.warn('save load failed', e); }
  return false;
}
function startNew() {
  newGame();
  refreshDerived();
  V.selected = null; UI.fleet = false; setTool({ kind: 'select' }); closeInspector();
  centerOn(0, 1); V.zoom = 1.7; V.angle = -0.35;
  setSpeed(1);
  save();
}

initRender(canvas);
initUI();
const loaded = load();
if (!loaded) { startNew(); showModal(HELP); } else { refreshDerived(); centerOn(0, 1); setSpeed(S.speed ?? 1); }
if (innerWidth < 700 || innerHeight < 500) V.zoom = 1.25;

initInput(canvas, mapHandlers);

document.getElementById('mapctl').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const c = b.dataset.ctl, cx = innerWidth / 2, cy = innerHeight / 2;
  if (c === 'rotl') rotateBy(-Math.PI / 6); else if (c === 'rotr') rotateBy(Math.PI / 6);
  else if (c === 'zin') zoomAt(cx, cy, 1.25); else if (c === 'zout') zoomAt(cx, cy, 0.8);
  else if (c === 'home') { centerOn(0, 1); }
  else if (c === 'eco') { V.overlay = V.overlay === 'eco' ? null : 'eco'; b.classList.toggle('on', !!V.overlay); if (V.overlay) toast('Pollution overlay: red = polluted, green = clean air'); }
});
addEventListener('hv-save', save);
addEventListener('hv-new', startNew);
addEventListener('hv-toast', (e) => toast(e.detail.text, e.detail.kind));
setInterval(save, 20000);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

function handleEvents() {
  for (const ev of C.events) {
    if (ev.type === 'toast') toast(ev.text, ev.kind);
    else if (ev.type === 'built' || ev.type === 'upgraded') {
      const b = S.buildings[ev.b];
      if (b && (BUILDINGS[b.type].player || ev.type === 'upgraded')) toast(`${BUILDINGS[b.type].icon} ${BUILDINGS[b.type].names[b.level - 1]} ${ev.type === 'built' ? 'completed' : 'upgraded'}!`);
      UI.inspDirty = true;
    }
  }
  C.events.length = 0;
}

let last = performance.now(), acc = 0;
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  acc += dt * (S.speed || 0);
  let n = 0;
  while (acc >= TICK && n < 40) { tick(TICK); acc -= TICK; n++; }
  if (n >= 40) acc = 0;
  handleEvents();
  frame(dt);
  updateUI(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
window.__hv = { get S() { return S; }, C, V, A: Actions, tick, tileAt, UI };
