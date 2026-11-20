import test from 'node:test';
import assert from 'node:assert/strict';
import {createSenseRoom, senseActionCost, SENSES} from '../../brainsnn-r3f-app/public/world/sense-room.mjs';
import {decideSenseAction, runSenseBenchmark, runSenseTrial, senseDecisionInput, SENSE_STRATEGIES, trainSenseMemory} from '../../brainsnn-r3f-app/public/world/sense-policy.mjs';

test('a policy can only see allowed observations and goal attributes', () => {
  const initial = createSenseRoom({seed: 17}).start;
  const expected = senseDecisionInput(initial);
  const excluded = new Set(['room', 'family', 'position', 'approach', 'route', 'walls', 'seed', 'mode', 'targetStatus', 'expectedId']);
  function check(node) {
    for (const [key, value] of Object.entries(node)) {
      assert.equal(excluded.has(key), false, key);
      if (value && typeof value === 'object') check(value);
    }
  }
  check(expected);
  const altered = {...initial, seed: 9, room: {name: 'Wrong answer', walls: [{x: 0}]}, expectedId: 'cart-B',
    candidates: initial.candidates.map(candidate => ({...candidate, expectedId: candidate.id, position: {x: 10}, approach: {z: 22}}))};
  assert.deepEqual(senseDecisionInput(altered), expected);
  assert.deepEqual(decideSenseAction(senseDecisionInput(altered)), decideSenseAction(expected));
});

test('asking is grounded in an unread cue, costs budget, and with no enabled senses the agent withholds', () => {
  const state = {delivery: false, reference: {smell: 'mint'}, candidates: [{id: 'A', label: 'A'}],
    remaining: 2, budget: 2, observations: [{sense: 'smell', candidateId: 'A', value: null}], question: false};
  const options = {strategy: 'active', enabledSenses: ['smell']};
  assert.deepEqual(decideSenseAction(state, options).action, {type: 'ask', candidateId: 'A', sense: 'smell'});
  assert.equal(decideSenseAction({...state, remaining: 1}, options).action.type, 'abstain');
  assert.equal(decideSenseAction({...state, question: true}, options).action.type, 'abstain');
  for (const strategy of SENSE_STRATEGIES) {
    const run = runSenseTrial({strategy, enabledSenses: [], seed: 1, mode:'absent'});
    assert.equal(run.steps.length, 1);
    assert.equal(run.steps[0].action.reason, 'uncertain');
    assert.equal(run.outcome.correctDecision, false, 'blanket abstention cannot establish absence');
  }
});

test('training memory is a frozen estimate calculated exclusively from observed training clues', () => {
  const learned = trainSenseMemory();
  assert.ok(Object.isFrozen(learned.utility));
  assert.deepEqual(Object.keys(learned.utility).sort(), [...SENSES].sort());
  assert.equal(new Set(learned.trainingFamilies).size, 3);
  for (const sense of SENSES) {
    const row = learned.stats[sense];
    assert.ok(row.checks > 0);
    assert.equal(learned.utility[sense], (row.conflicts + 1) / (row.cost + 2));
  }
  assert.equal(new Set(learned.trainingSeeds).size, learned.trainingCases);
  const run = runSenseTrial({split: 'test', seed: 101});
  assert.ok(!learned.trainingFamilies.includes(run.initial.room.name));
});

test('decision transcript is deterministic, bounded, and attempts only enabled cues', () => {
  for (const strategy of SENSE_STRATEGIES) {
    for (const budget of [1, 4, 14, 30]) {
      const enabled = ['touch','hearing'];
      const options = {strategy, seed: 116, budget, enabledSenses: enabled};
      const result = runSenseTrial(options);
      assert.deepEqual(result, runSenseTrial(options));
      for (const {before, after, action} of result.steps) {
        assert.equal(before.remaining - after.remaining, senseActionCost(action));
        assert.ok(action.sense == null || enabled.includes(action.sense));
      }
      assert.ok(result.steps.length <= budget + 1);
      assert.equal(result.steps.at(-1).after.done, true);
      assert.ok(result.outcome.queries <= 1);
    }
  }
});

test('paired benchmark includes all trials, route outcomes, separate robot and channel ablations', () => {
  const result = runSenseBenchmark();
  assert.ok(result.cases.length >= 12);
  assert.deepEqual(result.rows.map(r => r.strategy), [...SENSE_STRATEGIES]);
  assert.equal(new Set(result.cases.map(c => c.room)).size, 3);
  assert.equal(new Set(result.cases.map(c => c.mode)).size, 3);
  for (const row of result.rows) {
    const outcomes = result.cases.map(c => c.outcomes[row.strategy]);
    assert.equal(row.trials, result.cases.length);
    assert.equal(row.reached, outcomes.filter(s => s.outcome === 'reached').length);
    assert.equal(row.correctDecisions, row.reached + row.confirmedAbsent + row.confirmedAmbiguous);
    assert.equal(Object.values(row.strata).reduce((sum, s) => sum + s.trials, 0), row.trials);
    assert.ok(row.meanCost <= result.budget);
    for (const c of result.cases) {
      assert.ok(!result.training.trainingSeeds.includes(c.seed));
      assert.ok(!result.training.trainingFamilies.includes(c.room));
      assert.deepEqual(Object.keys(c.outcomes), [...SENSE_STRATEGIES]);
    }
  }
  assert.equal(result.robotComparison.robot, 'forklift');
  assert.deepEqual(result.ablations.map(r => r.disabled), [...SENSES]);
  assert.ok(result.ablations.every(r => r.trials === result.cases.length));
});

test('transfer uses a different job specification and the same frozen training estimates', () => {
  const run = runSenseTrial({task: 'delivery', seed: 14});
  assert.equal(run.initial.task, 'delivery');
  const percept = senseDecisionInput(run.initial);
  assert.equal(percept.delivery, true);
  assert.deepEqual(Object.keys(percept.reference).sort(), ['hearing', 'taste']);
  assert.ok(percept.candidates.every(b => Number.isFinite(b.dockWidth)));
  const suite = runSenseBenchmark();
  assert.ok(suite.transfer.cases.every(c => c.task === 'delivery'));
  assert.deepEqual(suite.transfer.cases.map(c => c.seed), suite.cases.map(c => c.seed));
  assert.ok(suite.transfer.rows.every(r => r.trials === suite.cases.length));
});

test('a separate visually solvable control verifies the fixed sight policy on unseen seeds', () => {
  const suite = runSenseBenchmark();
  const control = suite.visualControl;
  assert.equal(control.cases.length, 6);
  assert.ok(control.cases.every(c => c.outcomes.baseline.control === 'visual'));
  assert.ok(control.cases.every(c => !suite.cases.some(hard => hard.seed === c.seed)));
  assert.equal(control.rows[0].reached, 3);
  assert.equal(control.rows[0].confirmedAbsent, 3);
  assert.equal(control.rows[0].correctDecisions, 6);
});

test('two fully verified equal signatures are reported as ambiguous without a guessed ID', () => {
  const ref = {sight:'teal', hearing:'bell'};
  const candidates = [{id:'A',label:'A'}, {id:'B',label:'B'}];
  const state = {delivery:false, reference:ref, candidates, question:false, remaining:6, budget:14,
    observations:candidates.flatMap(({id}) => Object.entries(ref).map(([sense,value]) => ({candidateId:id, sense, value})))};
  const decision = decideSenseAction(state,{strategy:'active'});
  assert.equal(decision.action.type,'abstain');
  assert.equal(decision.action.reason,'uncertain');
  assert.match(decision.reason,/Two carts match every clue/);
});
