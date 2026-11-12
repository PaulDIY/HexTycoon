// Balance report: payback time (game days) of every income building's upgrades.
// Usage: npm run balance   (exits 1 if a row is outside its target band)
//
// Income is counted along the whole chain a good travels: company tax where it is
// made, plus the value it adds further down (processing, store sales, or export).
import { BUILDINGS, GOODS, COMPANY_TAX, SALES_TAX, MARKET } from '../js/config.js';

const TARGET = { 2: [5, 8], 3: [10, 16] }; // payback days for upgrading to level 2 / 3
const HAPPY = 0.75; // assumed average happiness for houses
const EXPORT_GOOD_VALUE = 3; // typical good a harbor ships (food / bricks)
// typical efficiency from placement bonuses (sim.js efficiency): lumber next to forest, farms half on fertile soil
const BONUS = { forest: 1.5, fertile: 1.15 };

const sold = new Set(Object.values(BUILDINGS).filter((d) => d.sells).flatMap((d) => d.sells.flat()));
const processors = Object.values(BUILDINGS).filter((d) => d.kind === 'processor');

// $ earned per unit of good g from the moment it is produced to its end use
const memo = {};
function chainValue(g) {
  if (memo[g] !== undefined) return memo[g];
  let down = 0;
  const p = processors.find((d) => d.recipe.in[g]);
  if (p) {
    const inN = p.recipe.in[g];
    down = Object.entries(p.recipe.out).reduce((a, [o, n]) => a + chainValue(o) * n, 0) / inN;
  } else if (sold.has(g)) down = GOODS[g].value * SALES_TAX;
  else down = GOODS[g].value; // construction / export-only goods: worth their export price
  return (memo[g] = GOODS[g].value * COMPANY_TAX + down);
}
// number of production buildings along the chain that g is part of (raw producer + processors)
const maker = (g) => processors.find((d) => d.recipe.out[g]);
function stagesUp(g) { const m = maker(g); return m ? 1 + stagesUp(Object.keys(m.recipe.in)[0]) : 1; }
function stagesDown(g) { const p = processors.find((d) => d.recipe.in[g]); return p ? 1 + stagesDown(Object.keys(p.recipe.out)[0]) : 0; }
const stages = (g) => stagesUp(g) + stagesDown(g);

// income per day at level index L (0..2), or null for buildings that only enable others.
// Each production stage of a chain is credited an equal share of the chain's value.
function income(d, L) {
  if (d.kind === 'producer') return d.rate[L] * (BONUS[d.bonus] || 1) * chainValue(d.out) / stages(d.out);
  if (d.kind === 'processor') {
    const perCycle = Object.entries(d.recipe.in).reduce((a, [g, n]) => a + chainValue(g) * n / stages(g), 0);
    return d.rate[L] * perCycle;
  }
  if (d.kind === 'house') return d.cap[L] * d.tax[L] * HAPPY;
  if (d.kind === 'harbor') {
    const x = d.maxExport[L], f = MARKET ? 1 / (1 + (x / (1 - MARKET.decay)) / MARKET.sat) : 1;
    return x * EXPORT_GOOD_VALUE * d.price[L] * f;
  }
  return null;
}
const matsValue = (m) => Object.entries(m || {}).reduce((a, [g, n]) => a + GOODS[g].value * n, 0);

let bad = 0;
const rows = [];
for (const [type, d] of Object.entries(BUILDINGS)) {
  if (income(d, 0) === null) continue;
  const inc = [0, 1, 2].map((L) => income(d, L));
  const pay = [2, 3].map((lvl) => {
    const cost = d.upCost[lvl - 1] + matsValue(d.mats[lvl - 1]);
    const days = cost / (inc[lvl - 1] - inc[lvl - 2]);
    const [lo, hi] = TARGET[lvl];
    const ok = days >= lo && days <= hi;
    return { cost, days, ok };
  });
  const order = pay[1].days >= pay[0].days;
  const flag = pay.every((p) => p.ok) && order ? '' : ' <<';
  if (flag) bad++;
  // suggested money cost so payback lands mid-band (materials count toward the cost)
  const sug = [2, 3].map((lvl) => {
    const mid = (TARGET[lvl][0] + TARGET[lvl][1]) / 2, delta = inc[lvl - 1] - inc[lvl - 2];
    return Math.max(lvl === 2 ? 25 : 75, Math.round((delta * mid - matsValue(d.mats[lvl - 1])) / 5) * 5);
  });
  rows.push([type.padEnd(12), inc.map((v) => v.toFixed(1).padStart(6)).join(''),
    pay.map((p) => `$${Math.round(p.cost)}`.padStart(6) + `${p.days.toFixed(1)}d`.padStart(7) + (p.ok ? ' ' : '!')).join('  '),
    flag ? `→ upCost [0, ${sug.join(', ')}]` : ''].join('  '));
}
console.log('building      inc/day L1 L2 L3          L2: cost  payback   L3: cost  payback');
for (const r of rows) console.log(r);
console.log(`\ntargets: L2 ${TARGET[2].join('–')}d, L3 ${TARGET[3].join('–')}d, L3 ≥ L2. chain $/unit:`,
  Object.keys(GOODS).map((g) => `${g} ${chainValue(g).toFixed(2)}`).join(', '));
if (bad) { console.log(`${bad} building(s) off target`); process.exit(1); }
console.log('all on target');
