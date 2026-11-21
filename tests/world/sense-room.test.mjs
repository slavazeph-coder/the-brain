import test from 'node:test';
import assert from 'node:assert/strict';
import {createSenseRoom, auditSenseRoute, classifyTasteSample, SENSES, SENSE_ROOM_FAMILIES, SENSE_EXTRA_POINTS} from '../../brainsnn-r3f-app/public/world/sense-room.mjs';

test('observers receive an immutable partial state and never a target key before committing', () => {
  const trial = createSenseRoom({seed: 83});
  assert.deepEqual(Object.keys(trial).sort(), ['score', 'start', 'step', 'withExtraPoints']);
  assert.equal(trial.score(), null);
  assert.equal(trial.start.observations.length, 3);
  for (const key of ['seed', 'caseType', 'targetStatus', 'expectedId', 'cards', 'score']) {
    assert.equal(key in trial.start, false);
  }
  assert.deepEqual(trial.start, createSenseRoom({seed: 83}).start);
  assert.throws(() => { trial.start.candidates[0].position.x = 99; }, TypeError);
  assert.throws(() => { trial.start.reference.sight = 'secret'; }, TypeError);
  const state = trial.step({type:'inspect', candidateId:'cart-1', sense:'sight', view:'side'});
  assert.notEqual(state.observations.at(-1).value, null);
  assert.equal(state.observations.at(-1).source, 'simulated');
  assert.equal(state.remaining, 12);
  assert.equal(trial.start.remaining, 14);
  assert.equal(trial.start.observations.length, 3);
  assert.equal(trial.score(), null);
});

test('sight, sound, local touch/aroma and fixed-station label each produce categorical observations', () => {
  for (const sense of SENSES) {
    let usable;
    for (let seed = 0; seed < 12 && !usable; seed++) {
      const env = createSenseRoom({seed});
      const action = {type:'inspect', candidateId:'cart-1', sense};
      if (sense === 'sight') action.view = 'side';
      const reading = env.step(action).observations.at(-1);
      if (reading.value !== null) usable = reading;
    }
    assert.equal(typeof usable?.value, 'string');
    assert.equal(usable.sense, sense);
    assert.equal(usable.source, 'simulated');
    if (sense === 'taste') {
      assert.match(usable.note, /fixed station sampled a known food standard/i);
      assert.equal(classifyTasteSample(usable.channels),usable.value);
      assert.ok(Object.values(usable.channels).every(v => v >= 0 && v <= 1));
      assert.equal(classifyTasteSample({sweet:0,sour:1}),null);
      assert.throws(() => classifyTasteSample({sweet:2,sour:.1}));
    }
  }
});

test('disabled channels, over-budget reads, repeats of visitor query and invalid actions cannot reveal information', () => {
  const env = createSenseRoom({enabledSenses: ['smell'], budget: 3});
  assert.deepEqual(env.start.observations, []);
  assert.throws(() => env.step({type:'inspect',candidateId:'cart-2',sense:'hearing'}), /switched off/);
  assert.throws(() => env.step({type:'ask',candidateId:'cart-2',sense:'hearing'}), /switched off/);
  assert.throws(() => env.step({type:'inspect',candidateId:'cart-2',sense:'smell',view:'side'}), /second view/);
  const state = env.step({type:'ask',candidateId:'cart-2',sense:'smell'});
  assert.equal(state.remaining, 1);
  assert.equal(state.observations.length, 1);
  assert.equal(state.question.source, 'visitor');
  assert.throws(() => env.step({type:'ask',candidateId:'cart-1',sense:'smell'}), /once/);
  assert.throws(() => env.step({type:'inspect',candidateId:'cart-1',sense:'smell'}), /budget/);
  const final = env.step({type:'abstain',reason:'uncertain'});
  assert.equal(final.done, true);
  assert.equal(env.score().queries, 1);
  assert.equal(env.score().cost, 2);
  assert.throws(() => env.step({type:'abstain'}), /finished/);
  assert.equal(typeof env.score().caseType,'string');
  assert.deepEqual(createSenseRoom({enabledSenses:[]}).start.observations, []);
});

test('disjoint training and test families vary the obstacle layout and exclude unavailable families', () => {
  const layouts = new Set();
  for (const [split, families] of Object.entries(SENSE_ROOM_FAMILIES)) {
    for (const family of families) {
      const state = createSenseRoom({split, family, seed: 4}).start;
      assert.ok(!layouts.has(JSON.stringify(state.room.walls)));
      layouts.add(JSON.stringify(state.room.walls));
    }
  }
  assert.equal(layouts.size, 6);
  assert.throws(() => createSenseRoom({split:'test',family:SENSE_ROOM_FAMILIES.train[0]}), /another split/);
});

test('independent scorer distinguishes unique, duplicate, absent and unreachable cases', () => {
  for (const mode of ['present','absent','ambiguous']) {
    const env = createSenseRoom({mode, seed: 19, family:'library'});
    env.step({type:'abstain', reason:mode === 'absent' ? 'absent' : 'uncertain'});
    const score = env.score();
    assert.equal(score.correctAbstention, mode !== 'present');
    assert.equal(score.success, false);
    assert.equal(score.caseType, mode);
    const choices = env.start.candidates.map(c => {
      const e = createSenseRoom({mode, seed:19, family:'library'});
      e.step({type:'choose', candidateId:c.id}); return e.score();
    });
    assert.equal(choices.filter(s => s.success).length, mode === 'present' ? 1 : 0);
    assert.equal(choices.filter(s => s.outcome === 'ambiguous_choice').length, mode === 'ambiguous' ? 2 : 0);
    if (mode === 'present') {
      const chosen = choices.find(s => s.success);
      assert.equal(chosen.collisions, 0); assert.equal(chosen.keepOutCrossings, 0);
      assert.equal(chosen.chosenId, score.expectedId);
      assert.deepEqual(chosen.route.at(-1), env.start.candidates.find(c => c.id === chosen.chosenId).approach);
      assert.ok(chosen.routeMeters > 1);
    }
  }
  const duplicate = createSenseRoom({mode:'ambiguous'});
  duplicate.step({type:'abstain',reason:'absent'});
  assert.equal(duplicate.score().outcome, 'false_absence');
  const reference = createSenseRoom({seed:1,mode:'present',family:'split-gallery'});
  reference.step({type:'abstain'});
  for (const robot of ['rover','forklift']) {
    const trial = createSenseRoom({seed:1,mode:'present',family:'split-gallery',robot});
    trial.step({type:'choose',candidateId:reference.score().expectedId});
    assert.equal(trial.score().outcome,robot === 'forklift' ? 'blocked' : 'reached');
  }
});

test('scorer catches a thin no-go region between otherwise clear route endpoints', () => {
  const world = {width:12,depth:8,objects:[{id:'band',kind:'no-go',x:4.9,z:2,w:.05,d:3}]};
  const body = {width:.3, depth:.3, margin:.05};
  assert.deepEqual(auditSenseRoute(world,[{x:1,z:3},{x:10,z:3}],body),{collisions:1,keepOutCrossings:1});
  assert.deepEqual(auditSenseRoute(world,[{x:1,z:1},{x:10,z:1}],body),{collisions:0,keepOutCrossings:0});
});

test('delivery requires two job cues and a fitting bay, accepts alternate carriers and checks the dock route', () => {
  for (const mode of ['present', 'absent', 'ambiguous']) {
    const options = {task:'delivery', mode, seed:8, family:'library', robot:'rover'};
    const session = createSenseRoom(options);
    assert.equal(session.start.task, 'delivery');
    assert.deepEqual(session.start.goal.senses, ['hearing','taste']);
    assert.equal(session.start.room.walls.filter(box => box.name.includes('guide rail')).length,6);
    session.step({type:'abstain',reason:'uncertain'});
    const expected = session.score().expectedIds;
    assert.equal(expected.length, {present:1, absent:0, ambiguous:2}[mode]);
    for (const bay of session.start.candidates) {
      const trial = createSenseRoom(options);
      trial.step({type:'choose',candidateId:bay.id});
      const score = trial.score();
      if (bay.dockWidth < session.start.goal.minWidth) {
        assert.equal(score.outcome, 'incompatible_bay');
        assert.equal(score.route.length, 0);
      } else if (expected.includes(bay.id)) {
        assert.equal(score.outcome,'reached');
        assert.deepEqual(score.route.at(-1),bay.approach);
        assert.equal(score.keepOutCrossings,0);
        assert.equal(score.collisions,0);
      } else {
        assert.equal(score.outcome,'incompatible_bay');
      }
    }
  }
});

test('both front view occlusion and sensor unavailability persist and can be queried selectively', () => {
  let dark = false, offline = false;
  for (let seed = 0; seed < 30 && (!dark || !offline); seed++) {
    const env = createSenseRoom({seed,budget:50});
    const unseen = env.start.observations.find(o => o.value === null);
    if (!dark && unseen) {
      const second = env.step({type:'inspect',sense:'sight',view:'side',candidateId:unseen.candidateId});
      assert.equal(typeof second.observations.at(-1).value,'string');
      dark = true;
    }
    for (const cart of env.start.candidates) {
      for (const sense of SENSES.slice(1)) {
        const state = env.step({type:'inspect',sense,candidateId:cart.id});
        if (state.observations.at(-1).value === null) {
          const repeat = env.step({type:'inspect',sense,candidateId:cart.id});
          assert.equal(repeat.observations.at(-1).value,null);
          offline = true;
          break;
        }
      }
      if (offline) break;
    }
  }
  assert.ok(dark && offline);
});

test('separate sight control distinguishes present and absent goals with the same layouts and sensor dropouts', () => {
  for (let seed = 211; seed <= 216; seed++) {
    const mode = seed % 2 ? 'present' : 'absent';
    const settings = {seed, split:'test', mode, enabledSenses:['sight']};
    const regular = createSenseRoom(settings), testRoom = createSenseRoom({...settings, visualControl:true});
    assert.deepEqual(testRoom.start.room, regular.start.room);
    assert.deepEqual(testRoom.start.candidates, regular.start.candidates);
    const seen = [];
    for (const c of testRoom.start.candidates) {
      const s = testRoom.step({type:'inspect',sense:'sight',candidateId:c.id,view:'side'});
      if (s.observations.at(-1).value === s.reference.sight) seen.push(c.id);
    }
    assert.equal(seen.length,mode === 'present' ? 1 : 0);
    testRoom.step(seen.length ? {type:'choose',candidateId:seen[0]} : {type:'abstain',reason:'absent'});
    assert.equal(testRoom.score().control,'visual');
    assert.ok(testRoom.score().success || testRoom.score().correctAbstention);
  }
  assert.throws(() => createSenseRoom({visualControl:true,task:'delivery'}),/cart searches/);
});

test('a reserved second pass carries the same readings, unused points and visitor answer', () => {
  const env = createSenseRoom({seed:101, budget:14});
  const asked = env.step({type:'ask', sense:'hearing', candidateId:'cart-1'});
  const extra = env.withExtraPoints();
  assert.deepEqual(extra.start.observations, asked.observations);
  assert.equal(extra.start.question, asked.question);
  assert.equal(extra.start.observations.at(-1), asked.observations.at(-1));
  assert.equal(extra.start.room, asked.room);
  assert.equal(extra.start.remaining, asked.remaining + SENSE_EXTRA_POINTS);
  assert.equal(extra.start.budget, asked.budget + SENSE_EXTRA_POINTS);
  assert.equal(extra.score(), null);
  assert.throws(() => env.withExtraPoints(), /unavailable/);
  assert.throws(() => extra.withExtraPoints(), /unavailable/);
  assert.throws(() => extra.step({type:'ask', sense:'taste',candidateId:'cart-2'}), /once/);
  const firstStop = env.step({type:'abstain',reason:'uncertain'});
  const extended = extra.step({type:'inspect', sense:'taste',candidateId:'cart-2'});
  assert.equal(firstStop.observations.length + 1, extended.observations.length);
  extra.step({type:'abstain',reason:'uncertain'});
  assert.equal(env.score().cost, 2);
  assert.equal(extra.score().cost, 4);
  assert.equal(extra.score().queries, 1);
  const closed = createSenseRoom();
  closed.step({type:'abstain',reason:'uncertain'});
  assert.throws(() => closed.withExtraPoints(), /unavailable/);
  assert.throws(() => createSenseRoom({budget:100}).withExtraPoints(), /unavailable/);
});
