import { ROBOTS, SCHEMA, routeWorld } from './core.mjs';

export const SENSES = Object.freeze(['sight', 'hearing', 'touch', 'smell', 'taste']);
export const SENSE_EXTRA_POINTS = 14;
const clues = {
  sight: ['amber', 'teal', 'purple', 'white'],
  hearing: ['bell', 'click', 'hum', 'rattle'],
  touch: ['ribbed', 'smooth', 'bumpy', 'woven'],
  smell: ['mint', 'vanilla', 'lemon', 'rose'],
  taste: ['pear', 'apple', 'berry', 'peach'],
};
const captions = {
  hearing: 'A simulated bay microphone heard the cart chime.',
  touch: 'A simulated contact pad read the handle texture.',
  smell: 'A local simulated aroma pad at this bay reported a category.',
};
// These invented reference responses are in arbitrary simulation units, not food chemistry.
const tasteStandards = {
  pear: [.72, .15], apple: [.54, .53], berry: [.76, .74], peach: [.94, .30],
};
export function classifyTasteSample({sweet, sour}) {
  if (![sweet, sour].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Use taste readings from zero to one.');
  let closest = null, best = Infinity;
  for (const [name, reference] of Object.entries(tasteStandards)) {
    const distance = Math.hypot(sweet - reference[0], sour - reference[1]);
    if (distance < best) { best = distance; closest = name; }
  }
  return best <= .12 ? closest : null;
}

const layouts = {
  'open-workshop': ['Open workshop', [[4, 3.1, 3, .8], [9.2, 5.2, 1.1, 1.4]]],
  'corner-store': ['Corner store', [[4.0, 1.0, .8, 4], [8.2, 4.3, 2.0, .9]]],
  'studio': ['Design studio', [[3.8, 4.7, 2.3, .8], [8.3, 3.6, 2.0, .8]]],
  'split-gallery': ['Split gallery', [[0, 4.5, 5.7, .7], [8.1, 4.5, 5.9, .7]]],
  'market-hall': ['Market hall', [[4.2, 1.8, 1.2, 3.4], [8.4, 3.4, 1.1, 3.3]]],
  'library': ['Library annex', [[0, 4.3, 3.6, 1.0], [7.35, 4.2, 3.3, .8]]],
};
export const SENSE_ROOM_FAMILIES = Object.freeze({
  train: Object.freeze(['open-workshop', 'corner-store', 'studio']),
  test: Object.freeze(['split-gallery', 'market-hall', 'library']),
});

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function randomSource(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const other = Math.floor(random() * (i + 1));
    [copy[i], copy[other]] = [copy[other], copy[i]];
  }
  return copy;
}
function variant(base, sense, random) {
  const options = clues[sense].filter(value => value !== base[sense]);
  return {...base, [sense]: options[Math.floor(random() * options.length)]};
}
function obstacle(id, name, x, z, w, d, kind = 'obstacle') {
  return {id, name, x, z, w, d, h: 1, kind};
}

export function senseActionCost(action) {
  if (['choose', 'abstain', 'extend'].includes(action.type)) return 0;
  if (action.type === 'ask') return 2;
  if (action.type !== 'inspect' || !SENSES.includes(action.sense)) throw new Error('Choose an available sense.');
  if ((action.sense === 'sight' && action.view !== 'side') || action.sense === 'hearing') return 1;
  return 2;
}

// Test each complete line segment against a closed inflated rectangle so the scorer can detect
// a crossing between waypoints as well as a collision at a waypoint.
function crosses(a, b, box, radius) {
  let entry = 0, exit = 1;
  for (const [axis, size] of [['x','w'], ['z','d']]) {
    const low = box[axis] - radius, high = box[axis] + box[size] + radius;
    const delta = b[axis] - a[axis];
    if (delta === 0) {
      if (a[axis] < low || a[axis] > high) return false;
    } else {
      const t1 = (low - a[axis]) / delta, t2 = (high - a[axis]) / delta;
      entry = Math.max(entry, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (entry > exit) return false;
    }
  }
  return true;
}

export function auditSenseRoute(room, route, robot) {
  if (!Array.isArray(route) || !route.length || !route.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.z))) {
    throw new Error('A scored route needs finite floor points.');
  }
  const radius = Math.hypot(robot.width, robot.depth) / 2 + (robot.margin ?? .1);
  const hits = new Set();
  const restricted = new Set();
  for (const [index, p] of route.entries()) {
    if (p.x < radius || p.z < radius || p.x > room.width - radius || p.z > room.depth - radius) hits.add('boundary');
    const prior = index ? route[index - 1] : p;
    for (const box of room.objects) {
      if (!crosses(prior, p, box, radius)) continue;
      hits.add(box.id);
      if (box.kind === 'no-go' || box.kind === 'unknown') restricted.add(box.id);
    }
  }
  return {collisions: hits.size, keepOutCrossings: restricted.size};
}

function verifyTrip(world, robot, goal) {
  try {
    const result = routeWorld(world, robot, goal);
    const audit = auditSenseRoute(world, result.route, robot);
    const end = result.route.at(-1);
    const reached = audit.collisions === 0 && Math.hypot(end.x - goal.x, end.z - goal.z) < 1e-6;
    return {route: result.route, routeMeters: result.distance, reached, ...audit, routeNote: 'Route to the cart bay checked against the room and robot footprint.'};
  } catch (error) {
    return {route: [], routeMeters: 0, reached: false, collisions: 0, keepOutCrossings: 0, routeNote: error.message};
  }
}

/** Three instrumented bays and a sealed-sample reader are simulated. Observation queries read
 * those instruments; only the final navigation action drives the ground simulation. */
export function createSenseRoom({seed = 1, split = 'test', family, mode = 'mixed', robot = 'rover', budget = 14, enabledSenses = SENSES, task = 'find', visualControl = false} = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Choose an unsigned integer seed.');
  if (!Number.isInteger(budget) || budget < 1 || budget > 100) throw new Error('Use a budget from 1 to 100.');
  if (!Array.isArray(enabledSenses) || enabledSenses.some(sense => !SENSES.includes(sense))) throw new Error('Choose valid senses.');
  const enabled = SENSES.filter(sense => enabledSenses.includes(sense));
  const families = SENSE_ROOM_FAMILIES[split];
  if (!Array.isArray(families)) throw new Error('Choose train or test rooms.');
  const familyId = family ?? families[seed % families.length];
  if (!families.includes(familyId)) throw new Error('This room family belongs to another split.');
  if (!['mixed','absent','present','ambiguous'].includes(mode)) throw new Error('Unsupported trial mode.');
  if (!['find', 'delivery'].includes(task)) throw new Error('Choose a cart search or a delivery job.');
  if (typeof visualControl !== 'boolean' || visualControl && (task !== 'find' || mode === 'ambiguous')) {
    throw new Error('The visual control is for present or absent cart searches.');
  }
  if (!['rover','forklift'].includes(robot)) throw new Error('Choose rover or forklift.');
  // Mix the integer so consecutive seeds do not have almost identical first observations.
  const random = randomSource(Math.imul((seed ^ 0xa1f2e3d4) >>> 0, 0x9e3779b1));
  const draw = random();
  let actualMode = mode;
  if (mode === 'mixed') {
    if (draw < .6) actualMode = 'present';
    else if (draw < .83 || visualControl) actualMode = 'absent';
    else actualMode = 'ambiguous';
  }
  const reference = Object.fromEntries(SENSES.map(sense => [sense, clues[sense][Math.floor(random() * clues[sense].length)]]));
  const pick = values => values[Math.floor(random() * values.length)];
  // Some rooms require an audio, touch or sample comparison even when front colors agree.
  const diagnostic = pick(['hearing','hearing','touch','smell','taste','sight']);
  const other = pick(SENSES.filter(s => s !== diagnostic));
  const alternatives = [variant(reference, diagnostic, random), variant(reference, other, random)];
  const cards = shuffled([
    actualMode === 'absent' ? variant(reference, diagnostic, random) : {...reference},
    actualMode === 'ambiguous' ? {...reference} : alternatives[0],
    alternatives[1],
  ], random);
  if (visualControl) {
    const otherColors = clues.sight.filter(color => color !== reference.sight);
    for (const [index, card] of cards.entries()) {
      if (SENSES.some(sense => card[sense] !== reference[sense])) card.sight = otherColors[index];
    }
  }
  const delivery = task === 'delivery';
  const body = robot === 'forklift' ? ROBOTS.forklift : ROBOTS.cleaner;
  const minWidth = delivery ? (robot === 'forklift' ? 3.25 : 1.8) : null;
  const requiredSenses = delivery ? ['hearing','taste'] : SENSES;
  const goal = delivery ? {task, senses: requiredSenses, minWidth,
    description: 'Deliver the load to any bay with the requested chime, food sample and clear opening.'}
    : {task, senses: requiredSenses, minWidth, description:'Reach the one cart matching the reference.'};
  let openings;
  if (delivery) {
    // The order specifies two attributes. Other attributes can vary freely. A narrow bay
    // can carry both requested signals and still be unable to accept the load.
    const compatible = () => ({...reference, sight:pick(clues.sight), touch:pick(clues.touch), smell:pick(clues.smell)});
    const wrongSignal = () => variant(compatible(), pick(requiredSenses), random);
    const clearOpening = () => Math.round((minWidth + .28 + random() * .13) * 100) / 100;
    const docks = shuffled([
      {card:actualMode === 'absent' ? wrongSignal() : compatible(), width:clearOpening()},
      {card:compatible(), width:minWidth - .55},
      {card:actualMode === 'ambiguous' ? compatible() : wrongSignal(), width:clearOpening()},
    ], random);
    openings = docks.map(dock => dock.width);
    for (let i = 0; i < docks.length; i++) cards[i] = docks[i].card;
  }
  const candidateList = cards.map((card, index) => {
    const x = [2.2, 7, 11.8][index] + (random() - .5) * .18;
    const id = (delivery ? 'bay-' : 'cart-') + (index + 1);
    return {id, label:(delivery ? 'Bay ' : 'Cart ') + 'ABC'[index], position:{x, z:9.7},
      approach:{x, z: delivery ? 8.95 : 7.5}, ...(delivery && {dockWidth:openings[index]})};
  });
  const [name, shelves] = layouts[familyId];
  const walls = shelves.map((box, i) => obstacle('shelf-' + i, 'Shelf', ...box));
  walls.push(obstacle('unknown', 'Unseen floor', 11.8, .2, 1.9, 1.3, 'unknown'));
  walls.push(obstacle('no-go', 'Reserved corner', .2, 9.8, .6, .9, 'no-go'));
  const startPosition = {x: 2.1 + random() * .2, z: 1.9};
  const room = {name, width: 14, depth: 11, start: startPosition, walls, station: {x: 1.5, z: 2.2, label:'Sealed food sample station'}};
  const cartBoxes = delivery ? [] : candidateList.map(c => obstacle(c.id, c.label, c.position.x - .55, c.position.z - .4, 1.1, .8));
  if (delivery) {
    for (const c of candidateList) {
      for (const side of [-1, 1]) {
        const edge = c.position.x + side * c.dockWidth / 2;
        walls.push(obstacle(c.id + '-rail-' + side, c.label + ' guide rail', edge - (side === -1 ? .10 : 0), 8.35, .10, 2.4));
      }
    }
  }
  const world = {schema: SCHEMA, name, width: room.width, depth: room.depth, start: startPosition, objects: [...walls, ...cartBoxes], provenance: 'authored', scaleReviewed: true, mapReviewed: true};
  const tasteReadings = cards.map(card => {
    const [sweet, sour] = tasteStandards[card.taste];
    const sample = value => Math.round((value + (random() - .5) * .06) * 100) / 100;
    return freeze({sweet:sample(sweet), sour:sample(sour)});
  });
  const dim = candidateList.map(() => random() < .4);
  const offline = candidateList.map(() => random() < .3 ? pick(SENSES.filter(s => s !== 'sight')) : null);
  function read(index, sense, view, source, cost) {
    const missing = source !== 'visitor' && (offline[index] === sense || sense === 'sight' && view === 'front' && dim[index]);
    const channels = !missing && sense === 'taste' && source === 'simulated' ? tasteReadings[index] : null;
    const value = missing ? null : channels ? classifyTasteSample(channels) : cards[index][sense];
    const note = source === 'visitor' ? 'A simulated visitor checked this one feature at the bay.'
      : missing ? 'This instrument gave no usable reading.'
      : channels ? `The fixed station sampled a known food standard. Simulated sweetness ${channels.sweet.toFixed(2)}, sourness ${channels.sour.toFixed(2)} on a 0–1 scale.`
      : sense === 'sight' ? 'Color reported by the simulated ' + view + ' camera.' : captions[sense];
    return freeze({candidateId: candidateList[index].id, sense, view, value, cost, note, source, ...(channels && {channels})});
  }
  const frontReadings = enabled.includes('sight')
    ? cards.map((_, index) => read(index, 'sight', 'front', 'simulated', 0)) : [];

  // Both allowances use the exact same room and instruments. A continuation receives
  // the paid observation record and the visitor's existing answer before any scoring.
  function session(allowance, remaining, observed, question, extended) {
    let done = false, result = null, reserved = false;
    function snapshot() {
      return freeze({reference, goal, task, enabledSenses:enabled, candidates: candidateList, observations: [...observed], remaining, budget:allowance, done, room, robot, question});
    }
    function finish(chosen, reason = null) {
      const matches = cards.map((card, i) => {
        const acceptable = requiredSenses.every(s => card[s] === reference[s]) &&
          (!delivery || openings[i] >= minWidth);
        return acceptable ? i : -1;
      }).filter(i => i >= 0);
      const unique = matches.length === 1;
      const solvable = delivery ? matches.length > 0 : unique;
      const c = candidateList[chosen];
      const tooNarrow = c && delivery && c.dockWidth < minWidth;
      const travel = c && !tooNarrow ? verifyTrip(world, body, c.approach)
        : {route:[], routeMeters:0, reached:false, collisions:0, keepOutCrossings:0, routeNote:tooNarrow ? 'The bay opening is narrower than the job requires.' : 'No navigation requested.'};
      let outcome;
      if (!c) {
        if (reason === 'absent' && !delivery && matches.length > 1) outcome = 'false_absence';
        else outcome = solvable ? 'missed_target' : 'correct_abstention';
      }
      else if (tooNarrow) outcome = 'incompatible_bay';
      else if (!delivery && matches.length > 1 && matches.includes(chosen)) outcome = 'ambiguous_choice';
      else if (!matches.includes(chosen)) outcome = delivery ? 'incompatible_bay' : 'wrong_cart';
      else outcome = travel.reached ? 'reached' : 'blocked';
      result = freeze({...travel, outcome, success:outcome === 'reached', correctAbstention:outcome === 'correct_abstention',
        wrongChoice:outcome === 'wrong_cart' || outcome === 'ambiguous_choice' || outcome === 'incompatible_bay', cost:allowance - remaining,
        observations:observed.filter(o => o.cost > 0 && o.source === 'simulated').length, queries:question ? 1 : 0,
        chosenId:c?.id ?? null, expectedId:unique ? candidateList[matches[0]].id : null, expectedIds:matches.map(i => candidateList[i].id), targetStatus:actualMode, caseType:delivery ? (solvable ? 'present' : 'absent') : actualMode, task, abstainReason:reason, family:familyId, ...(visualControl && {control:'visual'})});
      done = true;
    }
    return Object.freeze({
      start:snapshot(),
      step(action) {
        if (done) throw new Error('This trial has already finished.');
        if (!action || typeof action !== 'object') throw new Error('Select a trial action.');
        if (action.type === 'abstain') {
          const reason = action.reason ?? 'uncertain';
          if (!['uncertain','absent'].includes(reason)) throw new Error('Choose absent or uncertain.');
          finish(-1, reason); return snapshot();
        }
        const index = candidateList.findIndex(c => c.id === action.candidateId);
        if (index < 0) throw new Error('Choose a cart in this room.');
        if (action.type === 'choose') { finish(index); return snapshot(); }
        if (action.type !== 'inspect' && action.type !== 'ask' || !SENSES.includes(action.sense)) throw new Error('Choose one of the five senses.');
        if (!enabled.includes(action.sense)) throw new Error('This sense is switched off for this trial.');
        const view = action.view ?? 'front';
        if (!['front', 'side'].includes(view) || view === 'side' && (action.type !== 'inspect' || action.sense !== 'sight')) throw new Error('Only sight has a second view.');
        if (action.type === 'ask' && question) throw new Error('The visitor can answer once per room.');
        const cost = senseActionCost(action);
        if (remaining < cost) throw new Error('No budget for this observation. Choose a cart or finish without a choice.');
        const observation = read(index, action.sense, view, action.type === 'ask' ? 'visitor' : 'simulated', cost);
        remaining -= cost;
        observed.push(observation);
        if (action.type === 'ask') question = observation;
        return snapshot();
      },
      withExtraPoints() {
        if (done || extended || reserved || allowance + SENSE_EXTRA_POINTS > 100) {
          throw new Error('Extra clue points are unavailable for this trial.');
        }
        reserved = true;
        return session(allowance + SENSE_EXTRA_POINTS, remaining + SENSE_EXTRA_POINTS, [...observed], question, true);
      },
      score: () => result,
    });
  }
  return session(budget, budget, frontReadings, null, false);
}
