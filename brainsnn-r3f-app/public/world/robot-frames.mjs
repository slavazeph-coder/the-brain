/** Explicit rigid transforms. Canonical coordinates are right-handed Z-up metres;
 * quaternion storage is XYZW. A pose maps child-frame points into its parent frame.
 * World Builder's right-handed Y-up basis is converted by a proper rotation, never
 * by swapping axes (which would reflect the scene). No invalid rotation becomes identity. */
export const ROBOT_POSE_SCHEMA = 'brainsnn.robot-pose.v1';
const EPS = 1e-12;
const FRAME = /^[A-Za-z][A-Za-z0-9_./-]{0,95}$/;
const numeric = (v, label) => { if (typeof v !== 'number' || !Number.isFinite(v)) throw Error(`${label} must be finite.`); return v; };
export function vector3(value, label = 'Position') {
  const a = Array.isArray(value) ? value : value && [value.x, value.y, value.z];
  if (!a || a.length !== 3) throw Error(`${label} needs three coordinates.`);
  return {x: numeric(a[0], label), y: numeric(a[1], label), z: numeric(a[2], label)};
}
export function normalizeQuaternion(value, order = 'xyzw') {
  if (!['xyzw', 'wxyz'].includes(order)) throw Error('Declare quaternion order xyzw or wxyz.');
  let a;
  if (Array.isArray(value)) {
    if (value.length !== 4) throw Error('A quaternion needs four components.');
    a = order === 'wxyz' ? [value[1], value[2], value[3], value[0]] : value;
  } else a = value && [value.x, value.y, value.z, value.w];
  if (!a) throw Error('An explicit orientation quaternion is required.');
  a.forEach(v => numeric(v, 'Quaternion component'));
  const n = Math.hypot(...a);
  if (n < EPS || !Number.isFinite(n)) throw Error('A zero or invalid quaternion is not a rotation.');
  return {x: a[0] / n, y: a[1] / n, z: a[2] / n, w: a[3] / n};
}
export function multiplyQuaternions(left, right) {
  const a = normalizeQuaternion(left), b = normalizeQuaternion(right);
  return normalizeQuaternion({
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  });
}
export function invertQuaternion(value) { const q = normalizeQuaternion(value); return {x: -q.x, y: -q.y, z: -q.z, w: q.w}; }
export function quaternionFromAxisAngle(axis, angle) {
  const v = vector3(axis, 'Rotation axis'), n = Math.hypot(v.x, v.y, v.z); numeric(angle, 'Angle');
  if (n < EPS) throw Error('Rotation axis cannot be zero.');
  const s = Math.sin(angle / 2) / n;
  return {x: v.x * s, y: v.y * s, z: v.z * s, w: Math.cos(angle / 2)};
}
export function quaternionFromEuler(roll = 0, pitch = 0, yaw = 0) {
  return multiplyQuaternions(quaternionFromAxisAngle([0, 0, 1], yaw),
    multiplyQuaternions(quaternionFromAxisAngle([0, 1, 0], pitch), quaternionFromAxisAngle([1, 0, 0], roll)));
}
export function rotateVector(orientation, point) {
  const q = normalizeQuaternion(orientation), v = vector3(point);
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return {x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx};
}
/** Shortest rotation from actual to desired, in parent-frame coordinates. */
export function quaternionResidual(desired, actual) {
  let q = multiplyQuaternions(desired, invertQuaternion(actual));
  if (q.w < 0) q = {x: -q.x, y: -q.y, z: -q.z, w: -q.w};
  const s = Math.hypot(q.x, q.y, q.z), angle = 2 * Math.atan2(s, Math.max(0, q.w));
  const scale = s < EPS ? 2 : angle / s;
  return {x: q.x * scale, y: q.y * scale, z: q.z * scale};
}
export function quaternionAngle(a, b) { const e = quaternionResidual(a, b); return Math.hypot(e.x, e.y, e.z); }
export function slerpQuaternion(first, second, fraction) {
  numeric(fraction, 'Interpolation fraction'); if (fraction < 0 || fraction > 1) throw Error('Interpolate only inside the observed interval.');
  const a = normalizeQuaternion(first); let b = normalizeQuaternion(second);
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  if (dot < 0) { b = {x: -b.x, y: -b.y, z: -b.z, w: -b.w}; dot = -dot; }
  let wa = 1 - fraction, wb = fraction;
  if (dot < .9995) { const angle = Math.acos(Math.min(1, dot)), den = Math.sin(angle); wa = Math.sin((1 - fraction) * angle) / den; wb = Math.sin(fraction * angle) / den; }
  return normalizeQuaternion({x: wa * a.x + wb * b.x, y: wa * a.y + wb * b.y, z: wa * a.z + wb * b.z, w: wa * a.w + wb * b.w});
}
export function normalizePose(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Use a named-frame pose.');
  const frameId = value.frameId ?? options.frameId, childFrameId = value.childFrameId ?? options.childFrameId;
  if (![frameId, childFrameId].every(f => FRAME.test(f || '') && !f.includes('..') && !f.includes('//'))) throw Error('Declare valid parent and child frame IDs.');
  const position = vector3(value.position ?? value.translation);
  if (Math.max(Math.abs(position.x), Math.abs(position.y), Math.abs(position.z)) > 1e6) throw Error('Position exceeds the supported local metric range.');
  const orientation = normalizeQuaternion(value.orientation ?? value.quaternion, options.quaternionOrder ?? 'xyzw');
  if (frameId === childFrameId && (Math.hypot(position.x, position.y, position.z) > 1e-9 || Math.hypot(orientation.x, orientation.y, orientation.z) > 1e-9)) throw Error('A frame-to-itself transform must be identity.');
  const stamp = value.timestampSeconds ?? value.t ?? null;
  if (stamp !== null) numeric(stamp, 'Pose timestamp');
  return {schema: ROBOT_POSE_SCHEMA, frameId, childFrameId, position, orientation, timestampSeconds: stamp};
}
export function transformPoint(transform, point) {
  const p = normalizePose(transform), r = rotateVector(p.orientation, point);
  return {x: r.x + p.position.x, y: r.y + p.position.y, z: r.z + p.position.z};
}
export function composeTransforms(left, right) {
  const a = normalizePose(left), b = normalizePose(right);
  if (a.childFrameId !== b.frameId) throw Error(`Cannot compose ${a.childFrameId} with ${b.frameId}.`);
  if (a.timestampSeconds !== null && b.timestampSeconds !== null && Math.abs(a.timestampSeconds - b.timestampSeconds) > 1e-6) throw Error('Dynamic transforms must refer to the same timestamp.');
  return normalizePose({frameId: a.frameId, childFrameId: b.childFrameId, position: transformPoint(a, b.position),
    orientation: multiplyQuaternions(a.orientation, b.orientation), timestampSeconds: b.timestampSeconds ?? a.timestampSeconds}, {allowIdentityFrame: true});
}
export function invertTransform(transform) {
  const p = normalizePose(transform), orientation = invertQuaternion(p.orientation);
  return {...p, frameId: p.childFrameId, childFrameId: p.frameId, orientation,
    position: rotateVector(orientation, {x: -p.position.x, y: -p.position.y, z: -p.position.z})};
}
const Y_UP_TO_Z_UP = quaternionFromAxisAngle([1, 0, 0], Math.PI / 2);
function changeBasis(p, basis) {
  return {...p, position: rotateVector(basis, p.position), orientation: multiplyQuaternions(multiplyQuaternions(basis, p.orientation), invertQuaternion(basis))};
}
export function importPose(value, {convention = 'ros', ...options} = {}) {
  if (!['ros', 'mujoco', 'world-y-up'].includes(convention)) throw Error('Declare ros, mujoco, or world-y-up coordinates.');
  const p = normalizePose(value, {...options, quaternionOrder: convention === 'mujoco' ? 'wxyz' : 'xyzw'});
  return convention === 'world-y-up' ? changeBasis(p, Y_UP_TO_Z_UP) : p;
}
export function exportPose(value, {convention = 'ros'} = {}) {
  if (!['ros', 'mujoco', 'world-y-up'].includes(convention)) throw Error('Declare ros, mujoco, or world-y-up coordinates.');
  let p = normalizePose(value);
  if (convention === 'world-y-up') p = changeBasis(p, invertQuaternion(Y_UP_TO_Z_UP));
  const {x, y, z, w} = p.orientation;
  return {schema: ROBOT_POSE_SCHEMA, frameId: p.frameId, childFrameId: p.childFrameId,
    position: [p.position.x, p.position.y, p.position.z], quaternion: convention === 'mujoco' ? [w, x, y, z] : [x, y, z, w],
    timestampSeconds: p.timestampSeconds, convention, quaternionOrder: convention === 'mujoco' ? 'wxyz' : 'xyzw', units: 'metres, seconds, radians'};
}
