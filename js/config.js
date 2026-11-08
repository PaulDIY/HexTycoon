// Game data: terrain, goods, buildings (3 levels each), roads, trucks, goals.
export const DAY = 12;          // real seconds per game day at 1x speed
export const TICK = 0.1;        // simulation step (game seconds)
export const MAP_RADIUS = 20;
export const START_MONEY = 2500;
export const ZONE_COST = 2;
export const LEVEL_UNLOCK = [0, 40, 200]; // population needed for level 1/2/3

export const TERRAIN = {
  water:   { name: 'Water',        colors: ['#4c93bb', '#5199c1', '#478cb3'] },
  sand:    { name: 'Sand',         colors: ['#e7d49b', '#ecdaa6', '#e0cc90'] },
  grass:   { name: 'Grassland',    colors: ['#8dc366', '#94ca6c', '#87bc60'] },
  fertile: { name: 'Fertile soil', colors: ['#6aa94a', '#71b04f', '#64a245'] },
  forest:  { name: 'Forest',       colors: ['#5d9846', '#629e4a', '#589141'] },
  hills:   { name: 'Hills',        colors: ['#aaa47f', '#b2ac87', '#a29c77'] },
};

export const GOODS = {
  grain:     { name: 'Grain',      icon: '🌾', value: 1 },
  veg:       { name: 'Vegetables', icon: '🥕', value: 1.2 },
  wood:      { name: 'Wood',       icon: '🪵', value: 1 },
  stone:     { name: 'Stone',      icon: '🪨', value: 1 },
  clay:      { name: 'Clay',       icon: '🟫', value: 1 },
  cotton:    { name: 'Cotton',     icon: '☁️', value: 1.3 },
  food:      { name: 'Food',       icon: '🍞', value: 3 },
  planks:    { name: 'Planks',     icon: '🪚', value: 2.5 },
  bricks:    { name: 'Bricks',     icon: '🧱', value: 3 },
  clothes:   { name: 'Clothes',    icon: '👕', value: 6 },
  furniture: { name: 'Furniture',  icon: '🪑', value: 9 },
};

// consumption per resident per day
export const NEED_RATE = { food: 0.25, clothes: 0.12, furniture: 0.06 };
export const COMPANY_TAX = 0.4; // share of produced value
export const SALES_TAX = 0.5;   // share of sold value

export const ZONES = {
  res:    { name: 'Residential', icon: '🏠', color: '#7ccf6a', terrain: ['grass', 'fertile'], types: ['house'] },
  com:    { name: 'Commercial',  icon: '🏪', color: '#4fa8e8', terrain: ['grass', 'fertile', 'sand'], types: ['store'] },
  agri:   { name: 'Farmland',    icon: '🌾', color: '#f0c840', terrain: ['grass', 'fertile'], types: ['farm_grain', 'farm_veg', 'farm_cotton'] },
  forest: { name: 'Forestry',    icon: '🌲', color: '#1f8a57', terrain: ['forest', 'grass'], types: ['lumber'] },
  mine:   { name: 'Mining',      icon: '⛏️', color: '#b5835a', terrain: ['hills', 'sand'], types: ['quarry', 'claypit'] },
  ind:    { name: 'Industry',    icon: '🏭', color: '#b27fd0', terrain: ['grass', 'sand', 'fertile'], types: ['bakery', 'cannery', 'sawmill', 'brickworks', 'textile', 'furniture'] },
};

const MATS_S = [{ wood: 4, stone: 2 }, { planks: 5, stone: 3 }, { bricks: 6, planks: 4 }];
const MATS_M = [{ wood: 6, stone: 4 }, { planks: 8, stone: 5 }, { bricks: 10, planks: 6 }];
const MATS_L = [{ wood: 8, stone: 8 }, { planks: 12, stone: 8 }, { bricks: 16, planks: 10 }];

const producer = (o) => ({ kind: 'producer', rate: [4, 7, 11], workers: [2, 3, 4], buf: [12, 20, 30],
  mats: MATS_S, upCost: [0, 150, 400], poll: [0.4, 0.3, 0.05], unlock: 0, ...o });
const processor = (o) => ({ kind: 'processor', zone: 'ind', rate: [3, 5, 8], workers: [3, 5, 7], buf: [10, 20, 30],
  mats: MATS_M, upCost: [0, 220, 550], poll: [1.4, 1.0, 0.2], unlock: 0, ...o });

export const BUILDINGS = {
  house: { kind: 'house', zone: 'res', icon: '🏠', names: ['Cottage', 'Townhouse', 'Eco Apartments'],
    cap: [4, 10, 24], needs: [['food'], ['food', 'clothes'], ['food', 'clothes', 'furniture']],
    tax: [1.5, 2.2, 3.2], mats: MATS_S, upCost: [0, 120, 380], poll: [0.1, 0.1, 0], unlock: 0,
    desc: 'Citizens live here and shop at stores within walking range.' },
  store: { kind: 'store', zone: 'com', icon: '🏪', names: ['Market Stall', 'General Store', 'Eco Mall'],
    sells: [['food'], ['food', 'clothes'], ['food', 'clothes', 'furniture']], stock: [24, 48, 96],
    range: [5, 6, 8], workers: [2, 4, 7], mats: MATS_S, upCost: [0, 180, 450], poll: [0.2, 0.2, 0.05], unlock: 0,
    desc: 'Sells goods to nearby residents. Needs supply deliveries.' },

  farm_grain: producer({ zone: 'agri', out: 'grain', icon: '🌾', bonus: 'fertile',
    names: ['Grain Field', 'Grain Farm', 'Agro-Eco Farm'], desc: 'Grows grain. +30% on fertile soil.' }),
  farm_veg: producer({ zone: 'agri', out: 'veg', icon: '🥕', bonus: 'fertile',
    names: ['Vegetable Patch', 'Market Garden', 'Greenhouse Farm'], desc: 'Grows vegetables. +30% on fertile soil.' }),
  farm_cotton: producer({ zone: 'agri', out: 'cotton', icon: '☁️', unlock: 120, bonus: 'fertile',
    names: ['Cotton Field', 'Cotton Farm', 'Organic Cotton'], desc: 'Grows cotton for textiles.' }),
  lumber: producer({ zone: 'forest', out: 'wood', icon: '🪵', bonus: 'forest', poll: [0.3, 0.2, 0],
    mats: [{}, MATS_S[1], MATS_S[2]],
    names: ['Lumber Camp', 'Timber Yard', 'Sustainable Forestry'], desc: 'Harvests wood. Faster next to forest.' }),
  quarry: producer({ zone: 'mine', terrain: ['hills'], out: 'stone', icon: '🪨', poll: [1.5, 1.2, 0.4],
    mats: [{ wood: 3 }, MATS_S[1], MATS_S[2]],
    names: ['Stone Quarry', 'Quarry Works', 'Low-Impact Quarry'], desc: 'Cuts stone. Must be on hills.' }),
  claypit: producer({ zone: 'mine', terrain: ['sand'], out: 'clay', icon: '🟫', unlock: 40, poll: [1.0, 0.8, 0.2],
    names: ['Clay Pit', 'Clay Works', 'Restored Clay Pit'], desc: 'Digs clay. Must be on sand.' }),

  bakery:     processor({ icon: '🍞', recipe: { in: { grain: 2 }, out: { food: 2 } },
    names: ['Bakery', 'Industrial Bakery', 'Solar Bakery'], desc: 'Bakes grain into food.' }),
  cannery:    processor({ icon: '🥫', unlock: 40, recipe: { in: { veg: 2 }, out: { food: 3 } },
    names: ['Cannery', 'Food Plant', 'Zero-Waste Cannery'], desc: 'Preserves vegetables as food.' }),
  sawmill:    processor({ icon: '🪚', recipe: { in: { wood: 2 }, out: { planks: 1 } },
    names: ['Sawmill', 'Timber Mill', 'Circular Sawmill'], desc: 'Cuts wood into planks.' }),
  brickworks: processor({ icon: '🧱', unlock: 40, recipe: { in: { clay: 2 }, out: { bricks: 1 } },
    names: ['Brickworks', 'Brick Factory', 'Green Kiln'], desc: 'Fires clay into bricks.' }),
  textile:    processor({ icon: '👕', unlock: 120, recipe: { in: { cotton: 2 }, out: { clothes: 1 } },
    names: ['Textile Shop', 'Textile Mill', 'Fair Fashion Mill'], desc: 'Weaves cotton into clothes.' }),
  furniture:  processor({ icon: '🪑', unlock: 250, recipe: { in: { planks: 2 }, out: { furniture: 1 } },
    names: ['Carpentry', 'Furniture Factory', 'Upcycling Workshop'], desc: 'Builds furniture from planks.' }),

  hub: { kind: 'hub', player: true, icon: '📦', names: ['Storage Depot', 'Logistics Hub', 'Smart Eco Hub'],
    cap: [150, 400, 1000], trucks: [4, 6, 9], truckCost: [120, 200, 300], workers: [2, 4, 6],
    cost: [300, 600, 1200], mats: MATS_L, upkeep: [4, 8, 12], poll: [0.6, 0.5, 0.1], unlock: 0, needsRoad: true,
    desc: 'Stores goods and runs your truck fleet. Must touch a road.' },
  park: { kind: 'park', player: true, icon: '🌳', names: ['Pocket Park', 'Garden Park', 'Nature Reserve'],
    radius: [2, 3, 4], strength: [1.5, 3, 5], cost: [60, 150, 320], workers: [0, 0, 0],
    mats: [{ wood: 2 }, { wood: 3, stone: 3 }, { planks: 4, stone: 4 }], upkeep: [0.5, 1, 2], poll: [0, 0, 0], unlock: 0,
    desc: 'Absorbs pollution and makes neighbours happier.' },
};

export const ROAD = { names: ['Dirt Path', 'Paved Road', 'Green Boulevard'], cost: [10, 30, 60],
  speed: [1, 1.5, 2.1], upkeep: [0.02, 0.05, 0.08] };

export const TRUCK = { names: ['Van', 'Truck', 'E-Truck'], cap: [8, 14, 20], speed: [1.6, 2.0, 2.4],
  co2: [0.05, 0.03, 0], upkeep: [2, 3, 3] };

export const PRIORITIES = {
  balanced:     { name: 'Balanced',     con: 1.3, sup: 1.0, col: 1.0 },
  construction: { name: 'Construction', con: 4,   sup: 1.0, col: 0.8 },
  supply:       { name: 'Supply',       con: 1,   sup: 4,   col: 0.8 },
  collect:      { name: 'Collection',   con: 1,   sup: 0.8, col: 4 },
};

export const UNLOCK_MESSAGES = [
  [40, 'Level 2 upgrades, Paved Roads, Clay Pits, Brickworks & Cannery unlocked!'],
  [120, 'Cotton farms and Textile mills unlocked!'],
  [200, 'Level 3 eco upgrades and Green Boulevards unlocked!'],
  [250, 'Furniture workshops unlocked!'],
];

// Onboarding goals. check(s, stats) -> bool
export const GOALS = [
  { text: 'Zone 6 Residential tiles next to the road', reward: 200, check: (s, t) => t.zoned.res >= 6 },
  { text: 'Zone Forestry on forest tiles and Mining on hills', reward: 200, check: (s, t) => t.zoned.forest > 0 && t.zoned.mine > 0 },
  { text: 'Reach 15 citizens', reward: 250, check: (s, t) => t.pop >= 15 },
  { text: 'Zone Commercial so citizens can shop', reward: 200, check: (s, t) => t.count.store > 0 },
  { text: 'Zone Farmland and Industry (Bakery)', reward: 300, check: (s, t) => t.count.bakery > 0 && (t.count.farm_grain > 0) },
  { text: 'Buy an extra truck at a Storage Hub', reward: 150, check: (s, t) => t.trucks >= 3 },
  { text: 'Reach 40 citizens', reward: 400, check: (s, t) => t.pop >= 40 },
  { text: 'Upgrade any building to level 2', reward: 300, check: (s, t) => t.maxLevel >= 2 },
  { text: 'Build a Park', reward: 150, check: (s, t) => t.count.park > 0 },
  { text: 'Build a second Storage Hub', reward: 400, check: (s, t) => t.count.hub >= 2 },
  { text: 'Reach 120 citizens', reward: 800, check: (s, t) => t.pop >= 120 },
  { text: 'Reach 200 citizens with Eco score ≥ 60', reward: 1200, check: (s, t) => t.pop >= 200 && t.eco >= 60 },
  { text: 'Upgrade a building to level 3', reward: 1000, check: (s, t) => t.maxLevel >= 3 },
  { text: 'Reach 500 citizens', reward: 2500, check: (s, t) => t.pop >= 500 },
];
