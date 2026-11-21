// A unitless disk of batter columns. Each column carries ingredients and two
// material faces, whose identities stay fixed when the pancake turns over.
const radius = 4;
const sites = [];
for (let y = -radius; y <= radius; y++) {
  for (let x = -radius; x <= radius; x++) {
    if (x*x + y*y <= radius*radius) sites.push({x, y});
  }
}
const siteAt = new Map(sites.map(({x, y}, i) => [`${x},${y}`, i]));
const neighbours = sites.map(({x, y}) => [[1,0],[-1,0],[0,1],[0,-1]]
  .map(([dx, dy]) => siteAt.get(`${x+dx},${y+dy}`)).filter(i => i !== undefined));
const opposites = sites.map(({x, y}) => siteAt.get(`${-x},${-y}`));
const initialContrast = sites.reduce((sum, {x}) => sum + (x ? .42 : 0), 0);
const actions = new Set(['stir', 'heat', 'flip', 'cool', 'press', 'serve']);
export const PANCAKE_ACTION_LIMIT = 128;
const schema = 'brainsnn.pancake-episode.v1';
const mixedTarget = .82;
const setTarget = .72;
const burntLimit = .30;
const unit = value => Math.min(1, Math.max(0, value));

export function createPancake() {
  const cells = sites.map(({x, y}) => {
    const flour = .5 - .42 * Math.sign(x);
    return {x, y, flour, liquid: 1 - flour, heat: [0, 0], set: [0, 0], char: [0, 0], indent: 0};
  });
  return {cells, sideDown: 0, served: false, actions: []};
}

// The spoon swaps equal amounts of material between columns, first folding
// opposite edges together and then smoothing adjacent columns. Set batter resists it.
function exchange(a, b, amount) {
  const mobility = 1 - Math.max(...a.set, ...b.set);
  const flourTransfer = amount * mobility * (b.flour - a.flour);
  a.flour += flourTransfer;
  b.flour -= flourTransfer;
  a.liquid -= flourTransfer;
  b.liquid += flourTransfer;
}

function stir(cells) {
  for (let i = 0; i < cells.length; i++) {
    const j = opposites[i];
    if (i < j) exchange(cells[i], cells[j], .27);
  }
  for (let i = 0; i < cells.length; i++) {
    for (const j of neighbours[i]) {
      if (i < j) exchange(cells[i], cells[j], .10);
    }
  }
}

function thermalStep(cells, sideDown, heating) {
  // Sample the same previous field for every site, so the diffusion does
  // not depend on which row is visited first.
  const previous = cells.map(cell => cell.heat);
  for (const [i, cell] of cells.entries()) {
    const old = previous[i];
    const next = [0, 0];
    const radialFraction = (cell.x*cell.x + cell.y*cell.y) / (radius*radius);
    const plate = 1 - .10 * radialFraction;
    for (let side = 0; side < 2; side++) {
      const t = old[side];
      const lateral = neighbours[i].reduce((sum, j) => sum + previous[j][side] - t, 0);
      const boundary = heating && side === sideDown ? .32 * (plate - t) : -(heating ? .025 : .18) * t;
      next[side] = unit(t + boundary + .065*(old[1-side] - t) + .025*lateral);
      const hydration = 1 - Math.abs(cell.flour - cell.liquid);
      const settingRate = .30 * Math.max(0, next[side] - .30) * (.45 + .55 * hydration);
      cell.set[side] += (1 - cell.set[side]) * settingRate;
      const charringRate = .32 * Math.max(0, next[side] - .76) * cell.set[side];
      cell.char[side] += (1 - cell.char[side]) * charringRate;
    }
    cell.heat = next;
  }
}

function respondToPressure(cell, pressing) {
  // Normalized height loss under a centered round press. Heat-set and charred
  // faces stiffen each column. Unloaded columns relax on subsequent actions.
  if (!pressing) {
    cell.indent *= .48;
    return;
  }
  const stiffness = 1 + 3*(cell.set[0] + cell.set[1]) + 2*(cell.char[0] + cell.char[1]);
  const load = Math.exp(-.15*(cell.x*cell.x + cell.y*cell.y));
  cell.indent = load / stiffness;
}

export function stepPancake(state, action) {
  if (!actions.has(action)) throw new Error('Unknown pancake action.');
  if (state.served) throw new Error('This pancake has already been served.');
  if (state.actions.length >= PANCAKE_ACTION_LIMIT - 1 && action !== 'serve') {
    throw new Error('Serve this pancake to finish the experiment.');
  }
  const next = {...state, actions: [...state.actions, action]};
  if (action === 'serve') return {...next, served: true};
  const cells = state.cells.map(cell => ({
    ...cell, heat: [...cell.heat], set: [...cell.set], char: [...cell.char],
  }));
  if (action === 'flip') next.sideDown = 1 - state.sideDown;
  if (action === 'stir') stir(cells);
  if (action === 'heat' || action === 'cool') {
    for (let tick = 0; tick < 5; tick++) thermalStep(cells, next.sideDown, action === 'heat');
  }
  for (const cell of cells) respondToPressure(cell, action === 'press');
  return {...next, cells};
}

export function readPancake(state) {
  const {cells, sideDown, served} = state;
  const avg = measure => cells.reduce((sum, c) => sum + measure(c), 0) / cells.length;
  const mix = unit(1 - cells.reduce((sum, c) => sum + Math.abs(c.flour - .5), 0) / initialContrast);
  const top = 1 - sideDown;
  const topSet = avg(c => c.set[top]);
  const bottomSet = avg(c => c.set[sideDown]);
  const topChar = avg(c => c.char[top]);
  const bottomChar = avg(c => c.char[sideDown]);
  const char = Math.max(topChar, bottomChar);
  const leastSet = Math.min(topSet, bottomSet);
  const burnt = char >= burntLimit;
  const mixed = mix >= mixedTarget;
  const ready = mixed && leastSet >= setTarget && !burnt;
  let outcome = ready ? 'ready' : 'cooking';
  if (served) {
    if (burnt) outcome = 'burnt';
    else if (leastSet < setTarget) outcome = 'undercooked';
    else outcome = mixed ? 'cooked' : 'unmixed';
  }
  let stage = 'cooking';
  if (served) stage = 'served';
  else if (burnt) stage = 'burnt';
  else if (ready) stage = 'ready';
  else if (leastSet >= setTarget) stage = 'unmixed';
  else if (!mixed && bottomSet < .15 && topSet < .15) stage = 'mixing';
  let nextAction = 'heat';
  if (served) nextAction = null;
  else if (leastSet >= setTarget || burnt || state.actions.length >= PANCAKE_ACTION_LIMIT - 1) nextAction = 'serve';
  else if (!mixed && Math.max(topSet, bottomSet) < setTarget) nextAction = 'stir';
  else if (bottomSet >= .65 && bottomSet > topSet && topSet < setTarget) nextAction = 'flip';
  const score = Math.round(100 * unit(mix / mixedTarget) * unit(leastSet / setTarget) * unit(1 - char));
  return {
    mix, topSet, bottomSet, topChar, bottomChar, char, temperature: avg(c => (c.heat[0] + c.heat[1])/2),
    indent: Math.max(...cells.map(c => c.indent)), score, stage, outcome, nextAction,
  };
}

export function pancakeEpisode(state) {
  return {schema, actions: [...state.actions], result: readPancake(state)};
}

export function replayPancake(episode) {
  if (episode?.schema !== schema || !Array.isArray(episode.actions) || episode.actions.length > PANCAKE_ACTION_LIMIT) {
    throw new Error('Expected a version 1 pancake action log of at most 128 actions.');
  }
  let state = createPancake();
  for (const action of episode.actions) state = stepPancake(state, action);
  return state;
}
