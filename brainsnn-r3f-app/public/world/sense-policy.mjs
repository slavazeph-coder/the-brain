import {createSenseRoom, senseActionCost, SENSES} from './sense-room.mjs';

export const SENSE_STRATEGIES = Object.freeze(['baseline', 'active', 'memory']);
const TRAINING_SEEDS = Object.freeze(Array.from({length: 12}, (_, i) => i + 1));
const TEST_SEEDS = Object.freeze(Array.from({length: 18}, (_, i) => i + 101));
const CLEAR_VIEW_SEEDS = Object.freeze([211, 212, 213, 214, 215, 216]);
let defaultMemory;

function channels(enabled) {
  if (enabled == null) return [...SENSES];
  if (!Array.isArray(enabled) || enabled.some(sense => !SENSES.includes(sense))) {
    throw new RangeError('Choose available senses from the five trial channels.');
  }
  return SENSES.filter(sense => enabled.includes(sense));
}

// Freeze the goals as well as the rooms before running the policies.
const TEST_MODES = Object.freeze(['present', 'absent', 'ambiguous', 'present']);

/** Project the operator snapshot to the exact policy interface. No geometry, seed, family or score passes through. */
export function senseDecisionInput(state) {
  const delivery = state.task === 'delivery' || state.goal?.task === 'delivery';
  const required = delivery ? state.goal.senses : SENSES;
  const reference = Object.fromEntries(required.map(sense => [sense, state.reference[sense]]));
  const candidates = state.candidates.map(({id, label, dockWidth}) =>
    delivery ? {id, label, dockWidth} : {id, label});
  const observations = state.observations.map(({candidateId, sense, view, value}) => ({candidateId, sense, view, value}));
  return {reference, candidates, observations, remaining: state.remaining, budget: state.budget,
    question: Boolean(state.question), delivery, minWidth: delivery ? state.goal.minWidth : null};
}

/** Each label is a local observation at one named evidence station. A null cue proves nothing. */
function evidence(publicState, usable) {
  const eligible = publicState.candidates.filter(c => !publicState.delivery || c.dockWidth >= publicState.minWidth);
  return eligible.map(({id, label}) => {
    const reads = publicState.observations.filter(read => read.candidateId === id && usable.includes(read.sense));
    const matches = new Set();
    const conflicts = new Set();
    for (const read of reads) {
      if (read.value == null || publicState.reference[read.sense] == null) continue;
      if (read.value === publicState.reference[read.sense]) matches.add(read.sense);
      else conflicts.add(read.sense);
    }
    return {id, label, reads, matches, conflicts};
  });
}

function possibleInspect(station, sense) {
  if (station.matches.has(sense)) return null;
  const previous = station.reads.filter(read => read.sense === sense);
  if (!previous.length) return {type: 'inspect', candidateId: station.id, sense};
  if (sense === 'sight' && !previous.some(read => read.view === 'side')) {
    return {type: 'inspect', candidateId: station.id, sense, view: 'side'};
  }
  return null;
}

function choice(candidate, reason, confidence) {
  return {action: {type: 'choose', candidateId: candidate.id}, reason, confidence};
}

function abstain(reason, detail) {
  return {action: {type: 'abstain', reason}, reason: detail};
}

/**
 * Decide from the immutable public observation only. A stored cue preference contains aggregated
 * training results; it carries no room coordinates, station IDs, policies or evaluation labels.
 */
export function decideSenseAction(state, {strategy = 'memory', enabledSenses, memory} = {}) {
  if (!SENSE_STRATEGIES.includes(strategy)) throw new RangeError('Unknown trial strategy.');
  const usable = channels(enabledSenses).filter(s => state.reference[s] != null && (strategy !== 'baseline' || s === 'sight'));
  const possible = evidence(state, usable).filter(candidate => !candidate.conflicts.size);
  if (!possible.length) return abstain('absent', state.delivery
    ? 'Each bay is too narrow or has a conflicting service clue.'
    : 'Every cart has a checked clue that differs from the target.');
  if (!usable.length) return abstain('uncertain', 'No enabled sense can check a clue on the target card.');
  const required = Object.keys(state.reference);
  if (!state.delivery && possible.filter(c => required.every(s => c.matches.has(s))).length >= 2) {
    return abstain('uncertain', 'Two carts match every clue on the card. The evidence cannot identify a unique cart.');
  }
  const complete = possible.find(candidate => candidate.matches.size === usable.length);
  if (complete && (possible.length === 1 || state.delivery)) {
    if (state.delivery) {
      const full = usable.length === required.length;
      return choice(complete, full ? 'This bay fits the robot and matches the service request.'
        : 'This bay fits and matches the enabled service clues. Other clues remain unchecked.', full ? 'complete' : 'partial');
    }
    return choice(complete, 'Every enabled target clue matches here. The alternatives have been ruled out.',
      usable.length === required.length ? 'complete' : 'partial');
  }
  // Inspect the most supported hypothesis first. When it matches on every clue, inspect competitors.
  const ordered = [...possible].sort((a, b) => b.matches.size - a.matches.size);
  const preference = strategy === 'memory'
    ? [...usable].sort((a, b) => (memory?.utility?.[b] ?? 0) - (memory?.utility?.[a] ?? 0))
    : usable;
  // Compare a promising clue across remaining candidates before spending additional observations.
  for (const sense of preference) {
    for (const candidate of ordered) {
      const action = possibleInspect(candidate, sense);
      if (action && senseActionCost(action) <= state.remaining) {
        const reason = action.view === 'side'
          ? 'The front view was unclear. Look from the other side.'
          : 'Check ' + sense + ' at ' + candidate.label + ' against the target card.';
        return {action, reason};
      }
    }
  }
  // Only ask about a cue that our own observations failed to read. The visitor may also be unsure.
  if (!state.question && strategy !== 'baseline') {
    for (const candidate of ordered) {
      const sense = preference.find(s => !candidate.matches.has(s) &&
        candidate.reads.some(read => read.sense === s && read.value == null));
      if (!sense) continue;
      const action = {type: 'ask', candidateId: candidate.id, sense};
      if (senseActionCost(action) <= state.remaining) {
        return {action, reason: 'The sensor could not read this clue. Ask the visitor about ' + candidate.label + '.'};
      }
    }
  }
  // Budget-limited identification is explicitly tentative; a mismatch never counts as positive evidence.
  if (possible.length === 1 && possible[0].matches.size >= Math.min(3, usable.length)) {
    return choice(possible[0], 'Only one option still fits. Some clues remain unchecked within this budget.', 'partial');
  }
  return abstain('uncertain', possible.length > 1
    ? 'More than one cart still fits the evidence.'
    : 'There are too few matching clues to identify the remaining cart.');
}

/** Train on disjoint layout families. Each sensor gets the same training seeds and observation budget. */
export function trainSenseMemory() {
  if (defaultMemory) return defaultMemory;
  const stats = Object.fromEntries(SENSES.map(s => [s, {checks: 0, informative: 0, conflicts: 0, cost: 0}]));
  const utility = {};
  const families = new Set();
  for (const seed of TRAINING_SEEDS) {
    for (const sense of SENSES) {
      const env = createSenseRoom({seed, split: 'train', mode: 'mixed', budget: 14, robot: 'rover'});
      const start = env.start;
      families.add(start.room.name);
      const row = stats[sense];
      const viable = evidence(senseDecisionInput(start), ['sight']).filter(candidate => !candidate.conflicts.size);
      let state = start;
      for (const candidate of viable) {
        const action = {type: 'inspect', candidateId: candidate.id, sense};
        if (sense === 'sight') action.view = 'side';
        const cost = senseActionCost(action);
        if (state.remaining < cost) break;
        state = env.step(action);
        const read = state.observations.at(-1);
        row.checks++;
        row.cost += cost;
        if (read?.sense === sense && read.candidateId === candidate.id && read.value != null) {
          row.informative++;
          if (read.value !== start.reference[sense]) row.conflicts++;
        }
      }
    }
  }
  for (const sense of SENSES) {
    const row = stats[sense];
    // Smoothed observed eliminations per unit spent. This learns which check to try first.
    utility[sense] = (row.conflicts + 1) / (row.cost + 2);
    Object.freeze(row);
  }
  defaultMemory = Object.freeze({
    trainingCases: TRAINING_SEEDS.length, trainingEpisodes: TRAINING_SEEDS.length * SENSES.length, trainingSeeds: TRAINING_SEEDS,
    trainingFamilies: Object.freeze([...families]), stats: Object.freeze(stats), utility: Object.freeze(utility),
  });
  return defaultMemory;
}

export function runSenseTrial({
  strategy = 'memory', enabledSenses, seed = 101, split = 'test', mode = 'mixed',
  budget = 14, robot = 'rover', task = 'find', visualControl = false, family, memory,
} = {}) {
  if (!SENSE_STRATEGIES.includes(strategy)) throw new RangeError('Unknown trial strategy.');
  const enabled = channels(enabledSenses);
  const learned = strategy === 'memory' ? memory ?? trainSenseMemory() : undefined;
  const env = createSenseRoom({seed, split, mode, budget, robot, family, task, visualControl, enabledSenses: enabled});
  const initial = env.start, steps = [];
  let state = initial;
  // Every inspection spends at least one unit. A final choice or abstention consumes one turn.
  while (!state.done) {
    if (steps.length > initial.budget) throw new Error('Trial did not terminate within its observation budget.');
    const {action, reason, confidence} = decideSenseAction(senseDecisionInput(state), {strategy, enabledSenses: enabled, memory: learned && {utility: learned.utility}});
    const before = state;
    state = env.step(action);
    steps.push({before, after: state, action, reason, ...(confidence && {confidence})});
  }
  const terminal = steps.at(-1);
  const report = env.score();
  const lastPercept = senseDecisionInput(terminal.before);
  const allGoalSenses = SENSES.filter(sense => lastPercept.reference[sense] != null);
  const possible = evidence(lastPercept, enabled).filter(candidate => !candidate.conflicts.size);
  const verified = possible.filter(candidate => allGoalSenses.length && allGoalSenses.every(sense => candidate.matches.has(sense)));
  const confirmedAbsent = report.caseType === 'absent' && terminal.action.reason === 'absent' && possible.length === 0;
  const confirmedAmbiguous = report.caseType === 'ambiguous' && terminal.action.type === 'abstain' && verified.length >= 2;
  return {initial, steps, outcome: {...report, confidence: terminal.confidence ?? null, confirmedAbsent, confirmedAmbiguous,
    correctDecision: report.success || confirmedAbsent || confirmedAmbiguous}, strategy};
}

export function summarizeSenseRuns(strategy, outcomes) {
  if (!outcomes.length) throw new RangeError('Summarize at least one completed trial.');
  const row = {strategy, trials: outcomes.length, successes: 0, reached: 0, correctDecisions: 0, correctAbstentions: 0,
    confirmedAbsent: 0, confirmedAmbiguous: 0, uncertainAbstentions: 0, wrongChoices: 0, missedTargets: 0,
    wrongWithCompleteEvidence: 0, blocked: 0, ambiguousChoices: 0, collisions: 0, keepOutCrossings: 0,
    observations: 0, queries: 0, cost: 0, strata: {}};
  for (const result of outcomes) {
    const stratum = row.strata[result.caseType] ??= {trials: 0, correctDecisions: 0, reached: 0,
      wrongChoices: 0, withheld: 0, confirmedAbsent: 0, confirmedAmbiguous: 0};
    stratum.trials++;
    stratum.correctDecisions += Number(result.correctDecision);
    stratum.reached += Number(result.success);
    stratum.wrongChoices += Number(result.wrongChoice);
    stratum.withheld += Number(result.chosenId == null);
    stratum.confirmedAbsent += Number(result.confirmedAbsent);
    stratum.confirmedAmbiguous += Number(result.confirmedAmbiguous);
    row.successes += Number(result.success);
    row.reached += Number(result.outcome === 'reached');
    row.correctDecisions += Number(result.correctDecision);
    row.correctAbstentions += Number(result.correctAbstention);
    row.confirmedAbsent += Number(result.confirmedAbsent);
    row.confirmedAmbiguous += Number(result.confirmedAmbiguous);
    row.uncertainAbstentions += Number(result.chosenId == null && !result.confirmedAbsent && !result.confirmedAmbiguous);
    row.wrongChoices += Number(result.wrongChoice);
    row.wrongWithCompleteEvidence += Number(result.wrongChoice && result.confidence === 'complete');
    row.missedTargets += Number(result.outcome === 'missed_target');
    row.ambiguousChoices += Number(result.outcome === 'ambiguous_choice');
    row.blocked += Number(result.outcome === 'blocked');
    for (const key of ['collisions', 'keepOutCrossings', 'observations', 'queries', 'cost']) row[key] += result[key];
  }
  return {...row, presentCases: row.strata.present?.trials ?? 0, successRate: row.successes / row.trials,
    decisionAccuracy: row.correctDecisions / row.trials, meanCost: row.cost / row.trials, meanObservations: row.observations / row.trials};
}

function evaluateCases({enabledSenses, budget, robot, training, task = 'find', strategies = SENSE_STRATEGIES,
  visualControl = false}) {
  const seeds = visualControl ? CLEAR_VIEW_SEEDS : TEST_SEEDS;
  const modes = visualControl ? ['absent', 'present'] : TEST_MODES;
  const cases = seeds.map(seed => {
    const mode = modes[seed % modes.length];
    const outcomes = {};
    let room;
    for (const strategy of strategies) {
      const run = runSenseTrial({seed, mode, budget, robot, task, visualControl, enabledSenses, strategy, memory: training});
      room = run.initial.room.name;
      outcomes[strategy] = run.outcome;
    }
    return {seed, mode, room, task, robot, outcomes};
  });
  const rows = strategies.map(strategy => summarizeSenseRuns(strategy, cases.map(c => c.outcomes[strategy])));
  return {cases, rows};
}

/** Exact paired cases are kept for independent inspection. Uninformative abstention does not earn decision credit. */
export function runSenseBenchmark({enabledSenses, budget = 14, robot = 'rover'} = {}) {
  const enabled = channels(enabledSenses), training = trainSenseMemory();
  const settings = {enabledSenses: enabled, budget, robot, training};
  const primary = evaluateCases(settings);
  const ablations = enabled.map(disabled => {
    const subset = enabled.filter(sense => sense !== disabled);
    const {rows} = evaluateCases({...settings, enabledSenses: subset, strategies: ['memory']});
    return {disabled, ...rows[0]};
  });
  const alternateRobot = robot === 'rover' ? 'forklift' : 'rover';
  const robotComparison = evaluateCases({...settings, robot: alternateRobot});
  const transfer = evaluateCases({...settings, task: 'delivery'});
  const visualControl = evaluateCases({...settings, visualControl: true});
  return {...primary, ablations, transfer, visualControl, robotComparison: {...robotComparison, robot: alternateRobot},
    training, trainingCases: training.trainingCases, enabledSenses: enabled, budget, robot};
}
