import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD_GOALS, goalById, goalFromSearch } from '../../brainsnn-r3f-app/src/app/worldGoals.js';

test('four goal paths share a conservative capture entry', () => {
  assert.deepEqual(WORLD_GOALS.map(goal => goal.id), ['play', 'room', 'bim', 'robot']);
  assert.ok(WORLD_GOALS.every(goal => goal.guidance && goal.captureTip && goal.availability));
});

test('selected goal takes precedence over a legacy industry filter', () => {
  assert.equal(goalFromSearch('?goal=play&use=robotics'), 'play');
  assert.equal(goalFromSearch('?goal=robot'), 'robot');
  assert.equal(goalFromSearch('?goal=bim'), 'bim');
});

test('legacy links and invalid goals remain usable', () => {
  assert.equal(goalFromSearch('?use=robotics'), 'robot');
  assert.equal(goalFromSearch('?use=trades'), 'bim');
  assert.equal(goalFromSearch('?use=architecture'), 'bim');
  assert.equal(goalFromSearch('?use=real-estate'), 'room');
  assert.equal(goalFromSearch('?goal=unknown'), 'room');
  assert.equal(goalById('unexpected').id, 'room');
});

test('the playful entry is labelled unmeasured and assisted', () => {
  const item = goalById('play');
  assert.match(item.captureTip, /no measured scale/i);
  assert.match(item.guidance, /grown-up/i);
});
