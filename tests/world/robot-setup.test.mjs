import test from 'node:test';
import assert from 'node:assert/strict';
import {ROBOTS} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {ROBOT_ART, WORLD_ICONS, ICONS} from '../../brainsnn-r3f-app/public/world/playground-icons.mjs';
import {pace, bodySize, WORLD_CHOICES} from '../../brainsnn-r3f-app/public/world/robot-setup.mjs';

test('every planner robot has a drawing and plain size and pace words', () => {
  for (const [id, robot] of Object.entries(ROBOTS)) {
    assert.match(ROBOT_ART[id] || '', /<svg[^>]+aria-hidden="true"/, `${id} needs a decorative drawing beside its name`);
    assert.match(bodySize(robot), /^\d+(\.\d+)? × \d+(\.\d+)? (cm|m)$/, `${id} size`);
    assert.ok(['Slow', 'Steady', 'Fast'].includes(pace(robot.speed)), `${id} pace`);
  }
  assert.equal(bodySize(ROBOTS.cleaner), '58 × 68 cm');
  assert.equal(bodySize(ROBOTS.forklift), '1.1 × 2.4 m');
  assert.equal(pace(ROBOTS.vacuum.speed), 'Slow');
  assert.equal(pace(ROBOTS.amr.speed), 'Steady');
  assert.equal(pace(ROBOTS.forklift.speed), 'Fast');
});

test('every world choice has a picture, and pictures never stand in for words', () => {
  assert.deepEqual(WORLD_CHOICES.map(w => w.kind), ['sample', 'street', 'empty', 'capture', 'saved']);
  for (const world of WORLD_CHOICES) {
    assert.ok(WORLD_ICONS[world.kind], `${world.kind} picture`);
    assert.ok(world.title && world.plain, `${world.kind} has a title and a plain line`);
  }
  for (const svg of [...Object.values(ROBOT_ART), ...Object.values(WORLD_ICONS), ...Object.values(ICONS)]) {
    assert.match(svg, /aria-hidden="true" focusable="false"/);
  }
});
