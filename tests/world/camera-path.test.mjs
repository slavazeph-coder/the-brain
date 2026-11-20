import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CAMERA_KEYFRAMES, MAX_CAMERA_DURATION, MAX_CAMERA_PATH_BYTES,
  createCameraPath, validateCameraPath, parseCameraPath, serializeCameraPath,
  sampleCameraPath, cameraPathReceipt,
} from '../../brainsnn-r3f-app/public/world/camera-path.mjs';

const source = { name: 'room.ply', bytes: 176, sha256: 'a'.repeat(64) };
const view = (time, eye = [0, 1, 5], target = [0, 1, 0], fov = 60) => ({ time, eye, target, fov });
const path = (overrides = {}) => createCameraPath({ source, keyframes: [view(0), view(5, [4, 3, 5], [2, 1, 0], 40)], ...overrides });
const clone = value => JSON.parse(JSON.stringify(value));
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function rotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}

test('a path round-trips with exact asset binding and explicit local camera conventions', () => {
  const original = path({ provenance: 'camera-reconstruction' });
  const parsed = parseCameraPath(serializeCameraPath(original), { source, displayTransform: 'identity' });
  assert.deepEqual(parsed, original);
  assert.equal(parsed.duration, 5);
  assert.equal(parsed.coordinateFrame, 'right-handed-y-up');
  assert.equal(parsed.coordinateSpace, 'displayed-asset-frame');
  assert.equal(parsed.sourcePlacement, 'identity');
  assert.deepEqual(parsed.sourceTranslation, [0, 0, 0]);
  assert.equal(parsed.cameraConvention, 'RUB');
  assert.equal(parsed.poseConvention, 'camera-to-world');
  assert.equal(parsed.quaternionOrder, 'XYZW');
  assert.equal(parsed.distanceUnits, 'arbitrary');
  assert.equal(parsed.provenanceVerified, false);
  for (const name of ['name', 'bytes', 'sha256']) {
    const changed = { ...source, [name]: name === 'bytes' ? 177 : name === 'sha256' ? 'b'.repeat(64) : 'other.ply' };
    assert.throws(() => parseCameraPath(serializeCameraPath(original), { source: changed }), /different source asset/);
  }
});

test('display orientation is bound independently of original source bytes', () => {
  const flipped = path({ displayTransform: 'flip-y-z' });
  assert.deepEqual(flipped.source, source);
  assert.throws(() => validateCameraPath(flipped, { source, displayTransform: 'identity' }), /different display orientation/);
  assert.equal(validateCameraPath(flipped, { displayTransform: 'flip-y-z' }).sourceGeometryChanged, false);
  assert.throws(() => path({ displayTransform: 'blender-z-up' }), /Unsupported display transform/);
});

test('displayed GLB placement is preserved through validation and exact import binding', () => {
  const placed = path({ sourcePlacement: 'bbox-min-origin', sourceTranslation: [12.5, -3, .75] });
  assert.equal(validateCameraPath(placed).sourcePlacement, 'bbox-min-origin');
  assert.deepEqual(validateCameraPath(placed).sourceTranslation, [12.5, -3, .75]);
  assert.equal(cameraPathReceipt(placed).sourcePlacement, 'bbox-min-origin');
  assert.deepEqual(cameraPathReceipt(placed).sourceTranslation, [12.5, -3, .75]);
  assert.equal(cameraPathReceipt(placed).coordinateSpace, 'displayed-asset-frame');
  const text = serializeCameraPath(placed);
  assert.deepEqual(parseCameraPath(text, { source, sourcePlacement: 'bbox-min-origin', sourceTranslation: [12.5, -3, .75] }), placed);
  assert.throws(() => parseCameraPath(text, { source, sourcePlacement: 'bbox-min-origin', sourceTranslation: [12.5, -3, .75000000001] }), /different source translation/);
  assert.throws(() => parseCameraPath(text, { source, sourcePlacement: 'identity' }), /different source placement/);
  assert.throws(() => path({ sourcePlacement: 'survey-world' }), /Unsupported source placement/);
  const missing = clone(placed); delete missing.sourcePlacement;
  assert.throws(() => validateCameraPath(missing), /missing source placement/);
  const noTranslation = clone(placed); delete noTranslation.sourceTranslation;
  assert.throws(() => validateCameraPath(noTranslation), /Source translation/);
  const misleading = clone(placed); misleading.coordinateSpace = 'source-capture-frame';
  assert.throws(() => validateCameraPath(misleading), /Unsupported camera path coordinateSpace/);
});

test('source translation is detached, finite and unambiguous for identity placement', () => {
  assert.throws(() => path({ sourceTranslation: [1, 0, 0] }), /requires zero translation/);
  for (const sourceTranslation of [[Infinity, 0, 0], [0, 0], [0, 0, 1000001], [0, '1', 0]]) {
    assert.throws(() => path({ sourcePlacement: 'bbox-min-origin', sourceTranslation }), /Source translation/);
  }
  const input = [12.5, -3, .75], p = path({ sourcePlacement: 'bbox-min-origin', sourceTranslation: input, displayTransform: 'flip-y-z' });
  input[0] = 99;
  assert.deepEqual(p.sourceTranslation, [12.5, -3, .75]);
  const receipt = cameraPathReceipt(p); receipt.sourceTranslation[0] = 101;
  assert.deepEqual(p.sourceTranslation, [12.5, -3, .75]);
  assert.equal(p.displayTransform, 'flip-y-z');
  assert.ok(cameraPathReceipt(p).limitations.some(text => text.includes('Translation occurs before')));
});

test('samples eye, target and field of view without overshoot and hold endpoints', () => {
  const p = path();
  const mid = sampleCameraPath(p, 2.5);
  assert.deepEqual(mid.eye, [2, 2, 5]);
  assert.deepEqual(mid.target, [1, 1, 0]);
  assert.equal(mid.fov, 50);
  assert.equal(mid.time, 2.5);
  assert.deepEqual(sampleCameraPath(p, -100).eye, p.keyframes[0].eye);
  assert.deepEqual(sampleCameraPath(p, 100).eye, p.keyframes[1].eye);
  for (let i = 0; i <= 100; i++) {
    const s = sampleCameraPath(p, i / 20);
    for (const field of ['eye', 'target']) for (let axis = 0; axis < 3; axis++) {
      const endpoints = p.keyframes.map(frame => frame[field][axis]);
      assert.ok(s[field][axis] >= Math.min(...endpoints) && s[field][axis] <= Math.max(...endpoints));
    }
  }
});

test('XYZW camera-to-world quaternion maps local -Z to the sampled look direction', () => {
  const views = [view(0), view(1, [2, 4, -2], [-3, 1, -3]), view(2, [0, 0, 0], [0, 1, 0]), view(3, [0, 1, 0], [0, 0, 0])];
  // Test independently: the last two opposed directions intentionally cannot share a segment.
  for (const value of views) {
    const sample = sampleCameraPath(createCameraPath({ source, keyframes: [{ ...value, time: 0 }] }), 0);
    const forward = rotate(sample.quaternion, [0, 0, -1]), expected = sample.target.map((n, i) => n - sample.eye[i]);
    const n = Math.hypot(...expected);
    forward.forEach((v, i) => close(v, expected[i] / n));
    close(Math.hypot(...sample.quaternion), 1);
  }
  const sample = sampleCameraPath(path(), 2.3), forward = rotate(sample.quaternion, [0, 0, -1]), direction = sample.target.map((n, i) => n - sample.eye[i]);
  forward.forEach((v, i) => close(v, direction[i] / Math.hypot(...direction)));
});

test('near-pole quaternions match the viewer up-axis switch', () => {
  for (const back of [[.0008, 1, .0002], [.0008, -1, .0002], [.002, 1, .001]]) {
    const n = Math.hypot(...back), z = back.map(v => v / n);
    const sample = sampleCameraPath(createCameraPath({ source, keyframes: [view(0, back, [0, 0, 0])] }), 0);
    const up = Math.abs(z[1]) > .999999 ? [0, 0, 1] : [0, 1, 0];
    const rawRight = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
    const right = rawRight.map(v => v / Math.hypot(...rawRight));
    rotate(sample.quaternion, [1, 0, 0]).forEach((v, i) => close(v, right[i]));
  }
});

test('reversing look vectors is rejected before a recording can cross a zero-length camera', () => {
  assert.throws(() => path({ keyframes: [view(0, [0, 0, 0], [0, 0, -1]), view(2, [0, 0, 0], [0, 0, 3])] }), /intermediate view/);
  // The closest point is not the midpoint: this catches a full segment analytically.
  assert.throws(() => path({ keyframes: [view(0, [0, 0, 0], [0, 0, -3]), view(2, [0, 0, 0], [0, 0, 1])] }), /intermediate view/);
  const turn = path({ keyframes: [view(0, [0, 0, 0], [0, 0, -1]), view(1, [0, 0, 0], [1, 0, 0]), view(2, [0, 0, 0], [0, 0, 1])] });
  for (const t of [0.5, 1, 1.5]) assert.ok(Math.hypot(...sampleCameraPath(turn, t).target) > .5);
});

test('keyframes have strict bounded time, count, field of view and coordinates', () => {
  assert.equal(MAX_CAMERA_KEYFRAMES, 32); assert.equal(MAX_CAMERA_DURATION, 60);
  for (const keyframes of [[], Array.from({ length: 33 }, (_, i) => view(i)), [view(.1)], [view(0), view(0)], [view(0), view(-1)], [view(0), view(61)], [view(0), view(NaN)]]) assert.throws(() => path({ keyframes }));
  const full = path({ keyframes: Array.from({ length: 32 }, (_, i) => view(i * 60 / 31)) });
  assert.equal(full.keyframes.length, 32); assert.equal(full.duration, 60);
  for (const fov of [NaN, Infinity, 14.99, 100.01, '60']) assert.throws(() => path({ keyframes: [view(0, undefined, undefined, fov)] }), /field of view/);
  for (const eye of [[NaN, 0, 0], [Infinity, 0, 0], [1e6 + 1, 0, 0], [0, 0], ['0', 0, 0]]) assert.throws(() => path({ keyframes: [view(0, eye)] }), /finite coordinates/);
  assert.throws(() => path({ keyframes: [view(0, [0, 0, 0], [0, 0, 0])] }), /apart/);
  assert.throws(() => sampleCameraPath(path(), Infinity), /finite/);
});

test('untrusted imports cannot promote provenance, scale, collision or physical evidence', () => {
  for (const field of ['provenanceVerified', 'sourceGeometryChanged', 'metricScaleVerified', 'physicalAccuracyVerified', 'collisionValidated', 'physicalRobotValidated']) {
    const forged = path(); forged[field] = true;
    assert.throws(() => parseCameraPath(JSON.stringify(forged)), /cannot claim/);
  }
  for (const field of ['coordinateSpace', 'coordinateFrame', 'cameraConvention', 'poseConvention', 'quaternionOrder', 'distanceUnits', 'interpolation']) {
    const forged = path(); forged[field] = 'different';
    assert.throws(() => validateCameraPath(forged), /Unsupported camera path/);
  }
  for (const provenance of ['unknown', 'generated', 'authored', 'camera-reconstruction']) assert.equal(path({ provenance }).provenanceVerified, false);
  assert.throws(() => path({ provenance: 'survey-verified' }), /Choose unknown/);
  const extra = path(); extra.independentSurveyVerified = true;
  assert.equal(validateCameraPath(extra).independentSurveyVerified, undefined, 'unknown properties do not survive canonical export');
});

test('JSON size is checked before parse and multibyte text counts bytes', () => {
  assert.equal(MAX_CAMERA_PATH_BYTES, 128 * 1024);
  assert.throws(() => parseCameraPath('x'.repeat(MAX_CAMERA_PATH_BYTES + 1)), /128 KiB/);
  assert.throws(() => parseCameraPath('é'.repeat(MAX_CAMERA_PATH_BYTES / 2 + 1)), /128 KiB/);
  assert.throws(() => parseCameraPath('{broken'), /not valid JSON/);
  assert.throws(() => parseCameraPath('null'), /version 1/);
  const tooMany = clone(path()); tooMany.keyframes = Array.from({ length: 1000 }, (_, i) => view(i));
  assert.throws(() => validateCameraPath(tooMany), /1–32/);
});

test('malformed source, quaternion and declared duration fail closed', () => {
  for (const changed of [{ sha256: 'A'.repeat(64) }, { bytes: 0 }, { bytes: 1.5 }, { bytes: Number.MAX_SAFE_INTEGER + 1 }, { name: '' }, { name: 'bad\nname' }, { name: 'a'.repeat(257) }]) assert.throws(() => path({ source: { ...source, ...changed } }));
  const wrong = path(); wrong.keyframes[0].quaternion = [0, 1, 0, 0];
  assert.throws(() => validateCameraPath(wrong), /quaternion/);
  const nonunit = path(); nonunit.keyframes[0].quaternion = [0, 0, 0, 2];
  assert.throws(() => validateCameraPath(nonunit), /quaternion/);
  const sign = path(); sign.keyframes[0].quaternion = sign.keyframes[0].quaternion.map(n => -n);
  assert.deepEqual(validateCameraPath(sign), path(), 'equivalent quaternion sign canonicalizes');
  const forged = path(); forged.duration = 6;
  assert.throws(() => validateCameraPath(forged), /duration/);
});

test('receipt retains exact camera evidence and cannot mutate the live path', () => {
  const p = path({ provenance: 'generated' }), receipt = cameraPathReceipt(p);
  assert.deepEqual(receipt.source, source); assert.equal(receipt.provenance, 'generated');
  assert.equal(receipt.metricScaleVerified, false); assert.equal(receipt.physicalAccuracyVerified, false);
  assert.equal(receipt.collisionValidated, false); assert.equal(receipt.physicalRobotValidated, false);
  assert.equal(receipt.sourceGeometryChanged, false);
  assert.ok(receipt.limitations.some(v => v.includes('unobserved')));
  receipt.keyframes[0].eye[0] = 999; receipt.source.sha256 = 'c'.repeat(64);
  assert.notEqual(p.keyframes[0].eye[0], 999); assert.equal(p.source.sha256, source.sha256);
  const sample = sampleCameraPath(p, 0); sample.eye[0] = 777;
  assert.notEqual(p.keyframes[0].eye[0], 777);
});
