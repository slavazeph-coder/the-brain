import assert from 'node:assert/strict';
import test from 'node:test';
import {parseTaskInstruction, referencePath} from '../../brainsnn-r3f-app/public/world/robot-task-authoring.mjs';

test('a supported sentence defines the task and an optional metric distance', () => {
  assert.deepEqual(parseTaskInstruction('Please push the puck to the spot 30 cm.'), {task:'push', distance:.3});
  assert.deepEqual(parseTaskInstruction('Reach the target 0.29 metres away!'), {task:'reach', distance:.29});
  assert.deepEqual(parseTaskInstruction('Reach for a marker'), {task:'reach'});
  assert.deepEqual(parseTaskInstruction('Push 72cm'), {task:'push', distance:.72});
});

test('ambiguous, negated, compound and unrepresentable instructions stay as briefs', () => {
  for (const sentence of ['Do not push the puck', 'push the puck and reach the goal', 'push the puck 3 cm',
    'Reach 4 metres', 'Push 0.333 metres', 'Reach 30', 'push the puck sideways', 'Pick up a cup', '']) {
    assert.throws(() => parseTaskInstruction(sentence), Error, sentence);
  }
});

test('reference paths retain the media format and never inherit user paths', () => {
  assert.equal(referencePath(null), null);
  assert.equal(referencePath(new File(['abc'], '../TASK.md', {type:'video/mp4'})), 'reference/media.mp4');
  for (const bad of [{type:'image/svg+xml', size:1}, {type:'image/jpeg', size:0}, {type:'image/png', size:32*1024*1024+1}]) {
    assert.throws(() => referencePath(bad));
  }
});
