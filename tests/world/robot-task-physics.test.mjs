import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  makeRobotTaskMJCF, normalizeRobotTask, ROBOT_TASK_DEFAULTS, ROBOT_TASK_LIMITS, runRobotTask,
} from '../../brainsnn-r3f-app/public/world/robot-task-physics.mjs';

// Also run in CI before the shared browser assets have been copied to public.
const requireFromApp = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const packageUrl = pathToFileURL(requireFromApp.resolve('@mujoco/mujoco'));
const {default: loadMuJoCo} = await import(packageUrl);
const mujoco = await loadMuJoCo();
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

test('tabletop task configuration accepts only bounded built-in settings', () => {
  assert.deepEqual(normalizeRobotTask(), ROBOT_TASK_DEFAULTS);
  for (const input of [
    {task: 'another task'}, {controller: 'another controller'}, {distance: Infinity},
    {distance: ROBOT_TASK_LIMITS.minDistance - .01}, {distance: ROBOT_TASK_LIMITS.maxDistance + .01},
    {seed: -1}, {seed: ROBOT_TASK_LIMITS.maxSeed + 1}, {seed: .5}, {seed: '42'},
    {modelXML: 'unsupported input'},
  ]) assert.throws(() => normalizeRobotTask(input));
  assert.equal(normalizeRobotTask({seed: 0}).seed, 0);
  assert.equal(normalizeRobotTask({seed: ROBOT_TASK_LIMITS.maxSeed}).seed, ROBOT_TASK_LIMITS.maxSeed);
});

test('the same MuJoCo Reach model succeeds with full travel and misses with limited travel', () => {
  const standard = runRobotTask(mujoco, {task: 'reach'});
  const limited = runRobotTask(mujoco, {task: 'reach', controller: 'limited'});
  assert.equal(standard.engine.version, '4.0.1');
  assert.equal(standard.provenance.physicsExecuted, true);
  assert.equal(standard.provenance.learnedPolicyExecuted, false);
  assert.equal(standard.modelXML, limited.modelXML);
  assert.equal(standard.score.reason, 'goal-reached');
  assert.equal(standard.score.success, true);
  assert.ok(standard.score.goalHoldSeconds >= .2);
  assert.ok(standard.score.finalErrorMeters < .01);
  assert.equal(standard.score.contactSeconds, 0);
  assert.equal(standard.score.puckDisplacementMeters, null);
  assert.ok(standard.frames.every(({puck, puckQuaternion, contact}) => puck === null && puckQuaternion === null && !contact));
  assert.equal(limited.score.success, false);
  assert.equal(limited.score.reason, 'outside-goal');
  assert.ok(limited.score.finalErrorMeters > .15);
  assert.ok(limited.score.nearestErrorMeters > limited.scene.goalRadius);
  // The observed pusher initially lags the command because the actuator has finite gains and force.
  const moving = standard.frames[12];
  assert.ok(Math.hypot(moving.pusher[0] - moving.action[0], moving.pusher[1] - moving.action[1]) > .001);
});

test('Push measures simulated pusher contact and puck motion for successes and misses', () => {
  const standard = runRobotTask(mujoco, {task: 'push'});
  const limited = runRobotTask(mujoco, {task: 'push', controller: 'limited'});
  const far = runRobotTask(mujoco, {task: 'push', distance: ROBOT_TASK_LIMITS.maxDistance});
  assert.equal(standard.score.success, true);
  assert.equal(standard.score.reason, 'goal-reached');
  assert.ok(standard.score.finalErrorMeters < .02);
  assert.ok(standard.score.contactSeconds > .5);
  assert.ok(standard.score.goalHoldSeconds > .2);
  assert.ok(standard.score.puckDisplacementMeters > .28);
  assert.equal(standard.frames[0].contact, false);
  assert.ok(standard.frames.some(frame => frame.contact));
  for (const failed of [limited, far]) {
    assert.equal(failed.score.success, false);
    assert.equal(failed.score.reason, 'outside-goal');
    assert.ok(failed.score.contactSeconds > 0);
    assert.ok(failed.score.finalErrorMeters > failed.scene.goalRadius);
  }
  assert.ok(limited.score.puckDisplacementMeters < standard.score.puckDisplacementMeters);
  assert.ok(far.frames.at(-1).pusher[0] < far.scene.goal[0] - far.scene.pusherRadius);
});

test('a frozen seed produces identical poses, commands, scores and MJCF', () => {
  const config = {task: 'push', seed: 0, distance: .48};
  const first = runRobotTask(mujoco, config);
  const repeat = runRobotTask(mujoco, config);
  assert.deepEqual(first, repeat);
  assert.notDeepEqual(first.scene.puckStart, runRobotTask(mujoco, {...config, seed: 1}).scene.puckStart);
  assert.ok(first.score.nearestErrorMeters <= first.score.finalErrorMeters);
  assert.equal(first.frames.length, 81);
  assert.equal(first.frames.at(-1).time, 4);
  for (const [index, frame] of first.frames.entries()) {
    close(frame.time, index * first.sampleIntervalSeconds);
    close(Math.hypot(...frame.puckQuaternion), 1);
    close(frame.errorMeters, Math.hypot(frame.puck[0] - first.scene.goal[0], frame.puck[1] - first.scene.goal[1]));
  }
});

test('the standalone MJCF plus the recorded commands reproduces the simulated poses', () => {
  const episode = runRobotTask(mujoco, {task: 'push', seed: 7});
  assert.equal(episode.modelXML, makeRobotTaskMJCF(episode.config));
  const model = mujoco.MjModel.from_xml_string(episode.modelXML);
  const data = new mujoco.MjData(model);
  try {
    assert.equal(model.nu, 2);
    const tool = model.body('pusher'), puck = model.body('puck');
    try {
      const [originX, originY] = episode.scene.pusherStart;
      const sampleSteps = Math.round(episode.sampleIntervalSeconds / episode.timestepSeconds);
      for (const frame of episode.frames.slice(1)) {
        data.ctrl.set([frame.action[0] - originX, frame.action[1] - originY]);
        for (let i = 0; i < sampleSteps; i++) mujoco.mj_step(model, data);
        mujoco.mj_kinematics(model, data);
        for (const axis of [0, 1, 2]) {
          close(data.xpos[tool.id * 3 + axis], frame.pusher[axis]);
          close(data.xpos[puck.id * 3 + axis], frame.puck[axis]);
        }
        close(data.time, frame.time);
      }
    } finally {
      tool.delete();
      puck.delete();
    }
  } finally {
    data.delete();
    model.delete();
  }
});
