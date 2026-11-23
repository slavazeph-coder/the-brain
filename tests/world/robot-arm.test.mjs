import test from 'node:test';
import assert from 'node:assert/strict';
import {GENERIC_ARM_PROFILE, DEFAULT_ARM_TARGET, normalizeArmProfile, solveArmTarget, forwardArmKinematics, checkArmConfiguration, checkArmPath} from '../../brainsnn-r3f-app/public/world/robot-arm.mjs';
import {quaternionAngle, quaternionFromEuler} from '../../brainsnn-r3f-app/public/world/robot-frames.mjs';

test('six-axis IK reaches position and orientation and checks its entire interpolated path', () => {
  const result = solveArmTarget(GENERIC_ARM_PROFILE, DEFAULT_ARM_TARGET);
  assert.equal(result.status, 'geometric-path-found');
  assert.equal(result.reachable, true); assert.equal(result.pathValid, true);
  assert.equal(result.dynamicsValidated, false); assert.equal(result.physicalValidated, false);
  const actual = forwardArmKinematics(GENERIC_ARM_PROFILE, result.joints).pose;
  assert.ok(Math.hypot(...['x', 'y', 'z'].map(k => actual.position[k] - DEFAULT_ARM_TARGET.position[k])) < .002);
  assert.ok(quaternionAngle(actual.orientation, DEFAULT_ARM_TARGET.orientation) < .01);
  assert.ok(result.path.length > 2);
  for (const step of result.path) assert.equal(checkArmConfiguration(GENERIC_ARM_PROFILE, step.joints).valid, true);
  assert.ok(result.pathMotionBoundM <= .0075 + 1e-12);
});

test('IK does not confuse geometric reach with obstacle clearance or physical dynamics', () => {
  const blocked = solveArmTarget(GENERIC_ARM_PROFILE, DEFAULT_ARM_TARGET, {obstacles: [{id: 'cabinet', min: [.25, -.2, .1], max: [.6, .2, .7]}]});
  assert.equal(blocked.reachable, true); assert.equal(blocked.configurationValid, false); assert.equal(blocked.pathValid, false);
  assert.equal(blocked.status, 'pose-collision');
  assert.ok(blocked.reasons.some(r => r.collisions.some(c => c.kind === 'environment-collision')));
  const far = solveArmTarget(GENERIC_ARM_PROFILE, {...DEFAULT_ARM_TARGET, position: [5, 0, 1]});
  assert.equal(far.status, 'outside-reach-bound'); assert.equal(far.reachable, false);
});

function planar() {
  return {kind: 'serial-revolute', id: 'planar', basePose: {frameId: 'map', childFrameId: 'arm_base', position: [0, 0, 0], orientation: [0, 0, 0, 1]},
    linkRadiusM: .01, joints: [{name: 'shoulder', axis: [0, 0, 1], origin: {position: [0, 0, 0]}, limits: {lower: -Math.PI, upper: Math.PI}},
      {name: 'elbow', axis: [0, 0, 1], origin: {position: [1, 0, 0]}, limits: {lower: -2.7, upper: 2.7}}], tool: {position: [.2, 0, 0]}, homeJoints: [-Math.PI / 4, 0]};
}

test('clear endpoints do not hide a collision midway through the joint-space path', () => {
  const profile = planar(), start = [-Math.PI / 4, 0], end = [Math.PI / 4, 0];
  const obstacles = [{id: 'thin-obstacle', min: [.7, -.005, -.1], max: [.72, .005, .1]}];
  assert.equal(checkArmConfiguration(profile, start, {obstacles}).valid, true);
  assert.equal(checkArmConfiguration(profile, end, {obstacles}).valid, true);
  const path = checkArmPath(profile, start, end, {obstacles});
  assert.equal(path.valid, false); assert.equal(path.reasons[0].kind, 'interpolated-path-collision');
});

test('orientation constraints are real and search failure is not falsely called unreachable', () => {
  const p = planar(), goal = forwardArmKinematics(p, [0, Math.PI / 2]).pose;
  const result = solveArmTarget(p, {...goal, orientation: quaternionFromEuler(Math.PI / 2, 0, 0)}, {attempts: 4, iterations: 80});
  assert.equal(result.status, 'no-solution-within-budget'); assert.equal(result.reachable, null); assert.equal(result.pathValid, false);
  assert.ok(result.orientationErrorRad > .1);
});

test('joint limits, axes, box volume, model size and named-frame mismatch fail closed', () => {
  assert.throws(() => forwardArmKinematics(GENERIC_ARM_PROFILE, [0, 9, 0, 0, 0, 0]), /limit/);
  const p = structuredClone(GENERIC_ARM_PROFILE); p.joints[0].axis = [0, 0, 0]; assert.throws(() => normalizeArmProfile(p), /zero/);
  assert.throws(() => solveArmTarget(GENERIC_ARM_PROFILE, {...DEFAULT_ARM_TARGET, frameId: 'other'}), /same named frame/);
  assert.throws(() => solveArmTarget(GENERIC_ARM_PROFILE, DEFAULT_ARM_TARGET, {obstacles: [{min: [1, 0, 0], max: [0, 1, 1]}]}), /volume/);
  assert.throws(() => solveArmTarget(GENERIC_ARM_PROFILE, DEFAULT_ARM_TARGET, {iterations: 1000000}), /iterations/);
});

test('nonadjacent link capsules detect an arm folded through itself', () => {
  const p = planar(); p.tool.position = [1.2, 0, 0]; p.joints[1].limits = {lower: -Math.PI, upper: Math.PI};
  // Add a third link so collision is not the intentional contact of adjacent links.
  p.joints.push({name: 'wrist', axis: [0, 0, 1], origin: {position: [.1, 0, 0]}, limits: {lower: -Math.PI, upper: Math.PI}}); p.homeJoints = [0, 0, 0];
  const result = checkArmConfiguration(p, [0, Math.PI, 0]);
  assert.equal(result.valid, false); assert.ok(result.hits.some(h => h.kind === 'self-collision'));
});
