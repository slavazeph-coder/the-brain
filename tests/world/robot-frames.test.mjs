import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePose, normalizeQuaternion, quaternionFromEuler, quaternionFromAxisAngle, rotateVector, composeTransforms, invertTransform, transformPoint, importPose, exportPose, quaternionAngle, slerpQuaternion} from '../../brainsnn-r3f-app/public/world/robot-frames.mjs';
const close = (a, b, e = 1e-10) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const position = (a, b) => ['x', 'y', 'z'].forEach(k => close(a[k], b[k]));
const pose = (frameId = 'map', childFrameId = 'base_link') => ({frameId, childFrameId, position: [1, 2, 3], orientation: quaternionFromEuler(.2, -.3, .5)});

test('right-handed rotations and the World Builder basis preserve proper geometry', () => {
  position(rotateVector(quaternionFromAxisAngle([0, 0, 1], Math.PI / 2), [1, 0, 0]), {x: 0, y: 1, z: 0});
  const world = {...pose(), position: [1, 2, 3], orientation: quaternionFromAxisAngle([0, 1, 0], Math.PI / 2)};
  const ros = importPose(world, {convention: 'world-y-up'});
  position(ros.position, {x: 1, y: -3, z: 2});
  position(rotateVector(ros.orientation, [1, 0, 0]), {x: 0, y: 1, z: 0});
  const back = exportPose(ros, {convention: 'world-y-up'});
  back.position.forEach((v, i) => close(v, world.position[i]));
  close(quaternionAngle(back.quaternion, world.orientation), 0);
});

test('MuJoCo WXYZ is an explicit adapter and pose round trips retain orientation', () => {
  const original = normalizePose(pose());
  const external = exportPose(original, {convention: 'mujoco'});
  close(external.quaternion[0], original.orientation.w);
  const roundtrip = importPose(external, {convention: 'mujoco'});
  position(original.position, roundtrip.position); close(quaternionAngle(original.orientation, roundtrip.orientation), 0);
  assert.throws(() => importPose(external, {convention: 'guess'}), /Declare/);
});

test('named rigid composition and inverse transform points correctly', () => {
  const a = normalizePose(pose('map', 'base_link'));
  const b = normalizePose({...pose('base_link', 'camera'), position: [.4, -.1, .2]});
  const p = {x: .5, y: -.3, z: 1};
  position(transformPoint(composeTransforms(a, b), p), transformPoint(a, transformPoint(b, p)));
  position(transformPoint(invertTransform(a), transformPoint(a, p)), p);
  const identity = composeTransforms(a, invertTransform(a));
  position(transformPoint(identity, p), p);
  assert.throws(() => composeTransforms(a, {...b, frameId: 'other'}), /Cannot compose/);
  assert.throws(() => composeTransforms({...a, timestampSeconds: 1}, {...b, timestampSeconds: 2}), /timestamp/);
});

test('invalid quaternions and undeclared or impossible frame transforms fail explicitly', () => {
  for (const q of [[0, 0, 0, 0], [1, 2, NaN, 4], [1, 2, 3], null]) assert.throws(() => normalizeQuaternion(q));
  for (const p of [{...pose(), frameId: ''}, {...pose(), childFrameId: '../bad'}, {...pose(), childFrameId: 'map'}, {...pose(), position: [Infinity, 0, 0]}]) assert.throws(() => normalizePose(p));
  const n = normalizeQuaternion([0, 0, 0, 2]); assert.equal(n.w, 1);
});

test('SLERP follows the shortest equivalent quaternion path', () => {
  const a = quaternionFromEuler(0, 0, Math.PI * .9), b = quaternionFromEuler(0, 0, -Math.PI * .9);
  close(quaternionAngle(slerpQuaternion(a, b, .5), quaternionFromEuler(0, 0, Math.PI)), 0);
  const flipped = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, -v]));
  close(quaternionAngle(slerpQuaternion(a, flipped, .5), a), 0);
  assert.throws(() => slerpQuaternion(a, b, 2), /observed interval/);
});
