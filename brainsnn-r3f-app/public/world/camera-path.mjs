// Local appearance-camera paths. This schema carries no geometric or physical qualification.
export const MAX_CAMERA_KEYFRAMES = 32;
export const MAX_CAMERA_DURATION = 60;
export const MAX_CAMERA_PATH_BYTES = 128 * 1024;
const MAX_COORDINATE = 1e6, MIN_LOOK_DISTANCE = 1e-6;
const KIND = 'brainsnn-appearance-camera-path';
const PROVENANCE = new Set(['unknown', 'camera-reconstruction', 'generated', 'authored']);
const TRANSFORMS = new Set(['identity', 'flip-y-z']);
const PLACEMENTS = new Set(['identity', 'bbox-min-origin']);
const FALSE_CLAIMS = ['sourceGeometryChanged', 'metricScaleVerified', 'physicalAccuracyVerified', 'collisionValidated', 'physicalRobotValidated'];
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => { const n = Math.hypot(...a); return a.map(value => value / n); };

function vector(value, label) {
  if (!Array.isArray(value) || value.length !== 3 || value.some(n => !Number.isFinite(n) || Math.abs(n) > MAX_COORDINATE)) fail(`${label} must contain three finite coordinates within ±1,000,000.`);
  return value.slice();
}

function sourceBinding(source) {
  if (!object(source) || typeof source.name !== 'string' || !source.name.trim() || source.name.length > 256 || /[\u0000-\u001f\u007f]/u.test(source.name)) fail('A source filename of 1–256 characters is required.');
  if (!Number.isSafeInteger(source.bytes) || source.bytes < 1) fail('Source bytes must be a positive safe integer.');
  if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(source.sha256)) fail('Source SHA-256 must be 64 lowercase hexadecimal characters.');
  return { name: source.name, bytes: source.bytes, sha256: source.sha256 };
}

// Rotation columns are camera right, up and back: RUB cameras look along local -Z.
function quaternionFor(eye, target) {
  const z = unit(sub(eye, target));
  // Keep this pole switch identical to both viewer adapters' no-roll look-at.
  const x = unit(cross(Math.abs(z[1]) > .999999 ? [0, 0, 1] : [0, 1, 0], z));
  const y = cross(z, x);
  const m00 = x[0], m01 = y[0], m02 = z[0], m10 = x[1], m11 = y[1], m12 = z[1], m20 = x[2], m21 = y[2], m22 = z[2];
  let q;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 2 * Math.sqrt(trace + 1); q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  q = unit(q);
  // Equivalent quaternion signs are canonicalized for deterministic receipts.
  const sign = Math.abs(q[3]) > 1e-12 ? Math.sign(q[3]) : Math.sign(q.find(n => Math.abs(n) > 1e-12));
  return q.map(n => { const v = n * sign; return Object.is(v, -0) ? 0 : v; });
}

function keyframe(value) {
  if (!object(value)) fail('Each keyframe must be an object.');
  if (!Number.isFinite(value.time) || value.time < 0 || value.time > MAX_CAMERA_DURATION) fail('Keyframe time must be between 0 and 60 seconds.');
  const eye = vector(value.eye, 'Camera eye'), target = vector(value.target, 'Camera target');
  if (Math.hypot(...sub(eye, target)) <= MIN_LOOK_DISTANCE) fail('Camera eye and target must be more than 0.000001 units apart.');
  if (!Number.isFinite(value.fov) || value.fov < 15 || value.fov > 100) fail('Camera vertical field of view must be between 15° and 100°.');
  const quaternion = quaternionFor(eye, target);
  if (value.quaternion !== undefined) {
    const q = value.quaternion;
    if (!Array.isArray(q) || q.length !== 4 || q.some(n => !Number.isFinite(n)) || Math.abs(Math.hypot(...q) - 1) > 1e-6 || Math.abs(Math.abs(dot(q, quaternion)) - 1) > 1e-8) fail('Camera quaternion must be unit XYZW and agree with its Y-up eye and target.');
  }
  return { time: value.time, eye, target, fov: value.fov, quaternion };
}

function checkSegment(a, b) {
  // A linear look vector has an analytic minimum length on [0,1]. Reject a turn
  // through a zero-length view rather than failing halfway through recording.
  const d = sub(a.target, a.eye), delta = sub(sub(b.target, b.eye), d), lengthSquared = dot(delta, delta);
  const t = lengthSquared ? Math.max(0, Math.min(1, -dot(d, delta) / lengthSquared)) : 0;
  if (Math.hypot(...d.map((v, i) => v + delta[i] * t)) <= MIN_LOOK_DISTANCE) fail('A camera segment looks through its own eye. Add an intermediate view before reversing direction.');
}

/** Create a canonical, detached path from explicitly user-declared provenance. */
export function createCameraPath({ source, provenance = 'unknown', displayTransform = 'identity', sourcePlacement = 'identity', sourceTranslation = [0, 0, 0], keyframes } = {}) {
  if (!PROVENANCE.has(provenance)) fail('Choose unknown, camera-reconstruction, generated or authored provenance.');
  if (!TRANSFORMS.has(displayTransform)) fail('Unsupported display transform.');
  if (!PLACEMENTS.has(sourcePlacement)) fail('Unsupported source placement.');
  const translation = vector(sourceTranslation, 'Source translation').map(n => n === 0 ? 0 : n);
  if (sourcePlacement === 'identity' && translation.some(n => n !== 0)) fail('Identity source placement requires zero translation.');
  if (!Array.isArray(keyframes) || !keyframes.length || keyframes.length > MAX_CAMERA_KEYFRAMES) fail('A camera path needs 1–32 keyframes.');
  const frames = keyframes.map(keyframe);
  if (frames[0].time !== 0) fail('The first camera keyframe must start at 0 seconds.');
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].time <= frames[i - 1].time) fail('Camera keyframe times must increase strictly.');
    checkSegment(frames[i - 1], frames[i]);
  }
  return {
    kind: KIND, version: 1, source: sourceBinding(source), provenance, provenanceVerified: false,
    displayTransform, sourcePlacement, sourceTranslation: translation, coordinateSpace: 'displayed-asset-frame',
    coordinateFrame: 'right-handed-y-up', cameraConvention: 'RUB',
    poseConvention: 'camera-to-world', quaternionOrder: 'XYZW', distanceUnits: 'arbitrary',
    sourceGeometryChanged: false, metricScaleVerified: false, physicalAccuracyVerified: false,
    collisionValidated: false, physicalRobotValidated: false,
    interpolation: 'linear-eye-target-fov', duration: frames.at(-1).time, keyframes: frames,
  };
}

/** Validate and canonicalize an untrusted object. Optional binding enforces exact asset, placement and orientation. */
export function validateCameraPath(value, { source, displayTransform, sourcePlacement, sourceTranslation } = {}) {
  if (!object(value) || value.kind !== KIND || value.version !== 1) fail('Use a BrainSNN appearance camera path, version 1.');
  if (!PLACEMENTS.has(value.sourcePlacement)) fail('Unsupported or missing source placement.');
  vector(value.sourceTranslation, 'Source translation');
  for (const [name, expected] of Object.entries({ coordinateSpace: 'displayed-asset-frame', coordinateFrame: 'right-handed-y-up', cameraConvention: 'RUB', poseConvention: 'camera-to-world', quaternionOrder: 'XYZW', distanceUnits: 'arbitrary', interpolation: 'linear-eye-target-fov' })) {
    if (value[name] !== expected) fail(`Unsupported camera path ${name}.`);
  }
  if (value.provenanceVerified !== false || FALSE_CLAIMS.some(name => value[name] !== false)) fail('Appearance paths cannot claim verified provenance, scale, physical accuracy or collision/robot validation.');
  const path = createCameraPath(value);
  if (value.duration !== path.duration) fail('Camera duration must match its final keyframe.');
  if (source !== undefined) {
    const expected = sourceBinding(source);
    if (Object.keys(expected).some(name => expected[name] !== path.source[name])) fail('Camera path belongs to a different source asset. Open the exact original file.');
  }
  if (displayTransform !== undefined && path.displayTransform !== displayTransform) fail('Camera path belongs to a different display orientation.');
  if (sourcePlacement !== undefined && path.sourcePlacement !== sourcePlacement) fail('Camera path belongs to a different source placement.');
  if (sourceTranslation !== undefined) {
    const expected = vector(sourceTranslation, 'Source translation');
    if (expected.some((n, i) => n !== path.sourceTranslation[i])) fail('Camera path belongs to a different source translation.');
  }
  return path;
}

export function parseCameraPath(text, binding = {}) {
  if (typeof text !== 'string' || text.length > MAX_CAMERA_PATH_BYTES || new TextEncoder().encode(text).byteLength > MAX_CAMERA_PATH_BYTES) fail('Camera path JSON must be no larger than 128 KiB.');
  let value;
  try { value = JSON.parse(text); } catch { fail('Camera path is not valid JSON.'); }
  return validateCameraPath(value, binding);
}

export function serializeCameraPath(path) {
  return JSON.stringify(validateCameraPath(path), null, 2) + '\n';
}

/** Sample in seconds. Outside the path, hold the nearest endpoint. */
export function sampleCameraPath(value, time) {
  if (!Number.isFinite(time)) fail('Camera sample time must be finite.');
  const path = validateCameraPath(value), frames = path.keyframes;
  const t = Math.max(0, Math.min(path.duration, time));
  let index = frames.findIndex(frame => frame.time >= t);
  if (index < 0) index = frames.length - 1;
  if (index === 0 || frames[index].time === t) return { ...frames[index], eye: frames[index].eye.slice(), target: frames[index].target.slice(), quaternion: frames[index].quaternion.slice(), time: t };
  const a = frames[index - 1], b = frames[index], u = (t - a.time) / (b.time - a.time);
  const eye = a.eye.map((v, i) => v + (b.eye[i] - v) * u), target = a.target.map((v, i) => v + (b.target[i] - v) * u);
  return { time: t, eye, target, fov: a.fov + (b.fov - a.fov) * u, quaternion: quaternionFor(eye, target) };
}

/** Portable replay evidence, not a geometry or survey certificate. */
export function cameraPathReceipt(value) {
  const path = validateCameraPath(value);
  return {
    kind: 'brainsnn-appearance-camera-path-receipt', version: 1,
    ...Object.fromEntries(['source', 'provenance', 'provenanceVerified', 'displayTransform', 'sourcePlacement', 'sourceTranslation', 'coordinateSpace', 'coordinateFrame', 'cameraConvention', 'poseConvention', 'quaternionOrder', 'distanceUnits', 'interpolation', 'duration', ...FALSE_CLAIMS].map(name => [name, path[name]])),
    keyframes: path.keyframes,
    limitations: [
      'Camera path and provenance are user-authored, not capture-pose or provenance verification.',
      'Coordinates use unverified arbitrary asset units; no independent metric or survey accuracy is established.',
      'Camera coordinates refer to the displayed asset frame after the declared source placement and display transform, not original capture or survey coordinates.',
      'Displayed positions equal the declared display rotation applied to source position plus sourceTranslation. Translation occurs before the optional flip-y-z rotation.',
      'Replay renders the loaded appearance asset. It neither reconstructs nor validates unobserved surfaces.',
      'A camera path is not a collision-checked route or physical robot validation.',
    ],
  };
}
