import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PANCAKE_ACTION_LIMIT, createPancake, pancakeEpisode, readPancake, replayPancake, stepPancake,
} from '../../brainsnn-r3f-app/public/world/pancake-material.mjs';

const run = (actions, initial = createPancake()) => actions.reduce(stepPancake, initial);
const mixed = ['stir', 'stir', 'stir'];
const cooked = [...mixed, 'heat', 'heat', 'flip', 'heat', 'heat'];
const sum = (state, key) => state.cells.reduce((total, cell) => total + cell[key], 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} vs ${b}`);

test('stirring moves both ingredients, conserving local volume and each ingredient total', () => {
  const initial = createPancake();
  const after = run(mixed, initial);
  assert.equal(initial.cells.length, 49);
  assert.equal(new Set(initial.cells.map(c => `${c.x},${c.y}`)).size, initial.cells.length);
  assert.ok(after.cells.some((c, i) => Math.abs(initial.cells[i].flour - c.flour) > .25));
  for (const key of ['flour', 'liquid']) close(sum(initial, key), sum(after, key));
  for (const c of after.cells) close(c.flour + c.liquid, 1);
  assert.ok(readPancake(after).mix > .90);
  assert.deepEqual(initial, createPancake());

  const stiff = run(['heat', 'heat', 'flip', 'heat', 'heat']);
  assert.ok(readPancake(stepPancake(stiff, 'stir')).mix < readPancake(stepPancake(initial, 'stir')).mix / 2);
});

test('heat diffuses through the disk, follows the contact face and leaves lasting set and char', () => {
  const warm = run([...mixed, 'heat', 'heat']);
  const center = warm.cells.find(c => c.x === 0 && c.y === 0);
  const rim = warm.cells.find(c => c.x === 4);
  assert.ok(center.heat[0] > center.heat[1] && center.heat[1] > 0);
  assert.ok(center.heat[0] > rim.heat[0]);
  assert.ok(center.set[0] > center.set[1]);
  const flipped = stepPancake(warm, 'flip');
  assert.equal(flipped.sideDown, 1);
  assert.deepEqual(flipped.cells, warm.cells);
  close(readPancake(flipped).bottomSet, readPancake(warm).topSet);
  const bothSides = run(['heat', 'heat'], flipped);
  assert.ok(readPancake(bothSides).bottomSet > .7);
  const cooled = run(['cool', 'cool', 'cool'], bothSides);
  assert.ok(readPancake(cooled).temperature < readPancake(bothSides).temperature / 10);
  for (const [i, cell] of cooled.cells.entries()) {
    for (const side of [0, 1]) {
      assert.ok(cell.set[side] >= bothSides.cells[i].set[side]);
      assert.ok(cell.char[side] >= bothSides.cells[i].char[side]);
    }
  }
});

test('the same press dents a soft center more than the rim or a cooked center', () => {
  const raw = run([...mixed, 'press']);
  const done = run([...cooked, 'press']);
  const burnt = run([...mixed, ...Array(18).fill('heat'), 'press']);
  const center = state => state.cells.find(c => c.x === 0 && c.y === 0).indent;
  assert.ok(center(raw) > raw.cells.find(c => c.x === 4).indent);
  assert.ok(center(done) < center(raw) / 4);
  assert.ok(center(burnt) < center(done));
  assert.ok(center(stepPancake(raw, 'cool')) < center(raw));
  close(readPancake(raw).indent, center(raw));
});

test('guided actions reach a cooked pancake and scores distinguish premature, unmixed and burned results', () => {
  let guided = createPancake();
  for (let i = 0; i < 25 && !guided.served; i++) guided = stepPancake(guided, readPancake(guided).nextAction);
  assert.deepEqual(guided.actions, [...cooked, 'serve']);
  const good = readPancake(guided);
  const raw = readPancake(run(['serve']));
  const stiffUnmixed = run(['heat', 'heat', 'flip', 'heat', 'heat', 'heat', 'cool']);
  assert.equal(readPancake(stiffUnmixed).stage, 'unmixed');
  assert.equal(readPancake(stiffUnmixed).nextAction, 'serve');
  const unmixed = readPancake(stepPancake(stiffUnmixed, 'serve'));
  const burnt = readPancake(run([...mixed, ...Array(8).fill('heat'), 'serve']));
  assert.deepEqual([raw.outcome, unmixed.outcome, good.outcome, burnt.outcome], ['undercooked', 'unmixed', 'cooked', 'burnt']);
  assert.ok(good.score > raw.score && good.score > unmixed.score && good.score > burnt.score);
  assert.equal(good.nextAction, null);
  assert.throws(() => stepPancake(guided, 'heat'), /served/);
});

test('versioned action logs replay from scratch, including partial runs, without trusting embedded results', () => {
  for (const events of [[], ['stir', 'heat'], [...cooked, 'press', 'cool', 'serve']]) {
    const state = run(events);
    const log = JSON.parse(JSON.stringify(pancakeEpisode(state)));
    assert.deepEqual(replayPancake(log), state);
    log.result.score = -100;
    assert.deepEqual(replayPancake(log), state);
  }
  const log = pancakeEpisode(createPancake());
  for (const invalid of [null, {}, {...log, schema: 'unknown'}, {...log, actions: ['boil']},
    {...log, actions: 'heat'}, {...log, actions: [null]}, {...log, actions: ['serve', 'flip']},
    {...log, actions: Array(PANCAKE_ACTION_LIMIT + 1).fill('stir')}]) {
    assert.throws(() => replayPancake(invalid));
  }
  const atLimit = run(Array(PANCAKE_ACTION_LIMIT - 1).fill('heat'));
  for (const c of atLimit.cells) {
    for (const v of [...c.heat, ...c.set, ...c.char, c.flour, c.liquid, c.indent]) assert.ok(v >= 0 && v <= 1);
  }
  assert.equal(readPancake(atLimit).nextAction, 'serve');
  assert.throws(() => stepPancake(atLimit, 'cool'));
  const full = stepPancake(atLimit, 'serve');
  assert.deepEqual(replayPancake(pancakeEpisode(full)), full);
});
