/** Bounded, real serial-arm kinematics with pose IK and conservative capsule/box
 * path checks. This is a generic revolute-chain model, not an OEM robot model or
 * dynamics/force validation. All positions use the canonical Z-up frame contract. */
import {normalizePose, normalizeQuaternion, vector3, rotateVector, multiplyQuaternions, quaternionFromAxisAngle, quaternionFromEuler, quaternionResidual} from './robot-frames.mjs';

export const ARM_SCHEMA = 'brainsnn.serial-arm.v1';
const I = {x: 0, y: 0, z: 0, w: 1};
const add = (a, b) => ({x: a.x + b.x, y: a.y + b.y, z: a.z + b.z});
const sub = (a, b) => ({x: a.x - b.x, y: a.y - b.y, z: a.z - b.z});
const mul = (a, k) => ({x: a.x * k, y: a.y * k, z: a.z * k});
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = a => Math.hypot(a.x, a.y, a.z);
const cross = (a, b) => ({x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x});
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, label) => { if (typeof x !== 'number' || !Number.isFinite(x)) throw Error(`${label} must be finite.`); return x; };
const joint = (name, axis, position, lower, upper) => ({name, axis, origin: {position, orientation: I}, limits: {lower, upper}});
export const GENERIC_ARM_PROFILE = Object.freeze({
  schema: ARM_SCHEMA, id: 'generic-6dof-example', label: 'Generic six-axis arm — authored kinematic example', kind: 'serial-revolute',
  basis: 'Authored dimensions; no manufacturer or physical calibration', physicalValidated: false,
  basePose: {frameId: 'map', childFrameId: 'arm_base', position: [0, 0, 0], orientation: I},
  linkRadiusM: .025,
  joints: [joint('base', [0, 0, 1], [0, 0, .15], -Math.PI, Math.PI),
    joint('shoulder', [0, 1, 0], [0, 0, .10], -2.2, 2.2), joint('elbow', [0, 1, 0], [.35, 0, 0], -2.6, 2.6),
    joint('wrist-roll', [1, 0, 0], [.30, 0, 0], -Math.PI, Math.PI), joint('wrist-pitch', [0, 1, 0], [.10, 0, 0], -2.2, 2.2),
    joint('tool-roll', [1, 0, 0], [.08, 0, 0], -Math.PI, Math.PI)],
  tool: {position: [.12, 0, 0], orientation: I}, homeJoints: [0, -.65, 1.25, 0, -.60, 0],
});
function localTransform(raw, label) {
  const position = vector3(raw?.position ?? raw?.xyz ?? [0, 0, 0], label);
  if (norm(position) > 10) throw Error(`${label} exceeds the supported arm size.`);
  return {position, orientation: normalizeQuaternion(raw?.orientation ?? (raw?.rpy ? quaternionFromEuler(...raw.rpy) : I))};
}
export function normalizeArmProfile(input) {
  const raw = input?.arm ?? input;
  if (!raw || raw.kind !== 'serial-revolute' || !Array.isArray(raw.joints) || raw.joints.length < 2 || raw.joints.length > 8) throw Error('Use a declared serial-revolute arm with 2–8 joints.');
  const names = new Set();
  const joints = raw.joints.map((j, index) => {
    if (!j || typeof j.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(j.name) || names.has(j.name)) throw Error('Arm joints need distinct names.');
    names.add(j.name); const axis = vector3(j.axis, 'Joint axis'), n = norm(axis);
    if (n < 1e-9) throw Error('Joint axis cannot be zero.');
    const lower = finite(j.limits?.lower, 'Lower joint limit'), upper = finite(j.limits?.upper, 'Upper joint limit');
    if (lower >= upper || lower < -4 * Math.PI || upper > 4 * Math.PI) throw Error('Declare ordered, bounded joint limits in radians.');
    return {name: j.name, axis: mul(axis, 1 / n), origin: localTransform(j.origin, `Joint ${index} origin`), limits: {lower, upper}};
  });
  const linkRadiusM = finite(raw.linkRadiusM ?? .025, 'Link collision radius');
  if (linkRadiusM <= 0 || linkRadiusM > .5) throw Error('Use a positive link radius at most 0.5 m.');
  const basePose = normalizePose(raw.basePose), tool = localTransform(raw.tool, 'Tool offset');
  const homeJoints = raw.homeJoints ?? joints.map(j => (j.limits.lower + j.limits.upper) / 2);
  checkJoints({joints}, homeJoints);
  return {schema: ARM_SCHEMA, id: String(raw.id ?? 'custom-arm').slice(0, 128), label: String(raw.label ?? 'Custom serial arm').slice(0, 180),
    kind: 'serial-revolute', basePose, joints, tool, linkRadiusM, homeJoints: [...homeJoints], physicalValidated: false, basis: String(raw.basis ?? 'User-supplied kinematic model').slice(0, 1000)};
}
function checkJoints(profile, angles) {
  if (!Array.isArray(angles) || angles.length !== profile.joints.length) throw Error('Supply one angle per arm joint.');
  angles.forEach((q, i) => { finite(q, 'Joint angle'); const {lower, upper} = profile.joints[i].limits; if (q < lower - 1e-9 || q > upper + 1e-9) throw Error(`Joint ${profile.joints[i].name} exceeds its limit.`); });
}
function fk(profile, angles) {
  let p = profile.basePose.position, q = profile.basePose.orientation;
  const points = [{...p}], axes = [], origins = [];
  for (let i = 0; i < profile.joints.length; i++) {
    const j = profile.joints[i]; p = add(p, rotateVector(q, j.origin.position)); q = multiplyQuaternions(q, j.origin.orientation);
    points.push({...p}); origins.push({...p}); axes.push(rotateVector(q, j.axis));
    q = multiplyQuaternions(q, quaternionFromAxisAngle(j.axis, angles[i]));
  }
  p = add(p, rotateVector(q, profile.tool.position)); q = multiplyQuaternions(q, profile.tool.orientation); points.push({...p});
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) if (norm(sub(points[i + 1], points[i])) > 1e-9) segments.push({index: i, a: points[i], b: points[i + 1], radius: profile.linkRadiusM});
  return {pose: normalizePose({frameId: profile.basePose.frameId, childFrameId: 'arm_tool', position: p, orientation: q}), points, segments, axes, origins};
}
export function forwardArmKinematics(input, angles) {
  const p = normalizeArmProfile(input); checkJoints(p, angles); return fk(p, angles);
}
export function normalizeArmObstacles(input = []) {
  if (!Array.isArray(input) || input.length > 256) throw Error('Use at most 256 reviewed collision boxes.');
  return input.map((o, i) => {
    let min, max;
    if (o?.min !== undefined && o?.max !== undefined) { min = vector3(o.min, 'Obstacle minimum'); max = vector3(o.max, 'Obstacle maximum'); }
    else if (o && ['x', 'z', 'w', 'd', 'h'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k]))) {
      // Existing room boxes are right-handed Y-up [x,y,z], positive x/z extents.
      min = {x: o.x, y: -o.z - o.d, z: o.y ?? 0}; max = {x: o.x + o.w, y: -o.z, z: (o.y ?? 0) + o.h};
    } else throw Error('Collision boxes need min/max XYZ or reviewed World Builder x/z/w/d/h dimensions.');
    if (!['x', 'y', 'z'].every(k => min[k] < max[k] && Math.abs(min[k]) < 1e5 && Math.abs(max[k]) < 1e5)) throw Error('Collision box bounds must have positive finite volume.');
    return {id: String(o.id ?? `obstacle-${i}`).slice(0, 128), min, max, kind: String(o.kind ?? 'obstacle').slice(0, 64)};
  });
}
function segmentHitsExpandedBox(a, b, box, radius) {
  let lo = 0, hi = 1;
  for (const k of ['x', 'y', 'z']) {
    const d = b[k] - a[k], low = box.min[k] - radius, high = box.max[k] + radius;
    if (Math.abs(d) < 1e-12) { if (a[k] < low || a[k] > high) return false; }
    else { let first = (low - a[k]) / d, last = (high - a[k]) / d; if (first > last) [first, last] = [last, first]; lo = Math.max(lo, first); hi = Math.min(hi, last); if (lo > hi) return false; }
  }
  return true;
}
function segmentDistance(a, b, c, d) {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c), aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w);
  const den = aa * cc - bb * bb;
  let s = den > 1e-15 ? clamp((bb * ee - cc * dd) / den, 0, 1) : 0;
  let t = cc > 1e-15 ? (bb * s + ee) / cc : 0;
  if (t < 0) { t = 0; s = aa > 1e-15 ? clamp(-dd / aa, 0, 1) : 0; }
  else if (t > 1) { t = 1; s = aa > 1e-15 ? clamp((bb - dd) / aa, 0, 1) : 0; }
  return norm(sub(add(a, mul(u, s)), add(c, mul(v, t))));
}
function collisions(state, obstacles, inflation = 0) {
  const hits = [];
  for (const s of state.segments) for (const b of obstacles) if (segmentHitsExpandedBox(s.a, s.b, b, s.radius + inflation)) hits.push({kind: 'environment-collision', link: s.index, obstacleId: b.id});
  for (let i = 0; i < state.segments.length; i++) for (let j = i + 1; j < state.segments.length; j++) {
    const a = state.segments[i], b = state.segments[j];
    // Adjacent links intentionally meet at a joint. Non-adjacent capsules must remain separated.
    if (Math.abs(a.index - b.index) <= 1) continue;
    if (segmentDistance(a.a, a.b, b.a, b.b) <= a.radius + b.radius + 2 * inflation) hits.push({kind: 'self-collision', links: [a.index, b.index]});
  }
  return hits;
}
export function checkArmConfiguration(input, angles, {obstacles = []} = {}) {
  const p = normalizeArmProfile(input); checkJoints(p, angles); const state = fk(p, angles), hits = collisions(state, normalizeArmObstacles(obstacles));
  return {valid: hits.length === 0, hits, ...state};
}
function motionBound(profile, delta) {
  let bound = 0;
  for (let i = 0; i < delta.length; i++) {
    let reach = norm(profile.tool.position); for (let j = i + 1; j < profile.joints.length; j++) reach += norm(profile.joints[j].origin.position);
    bound += reach * Math.abs(delta[i]);
  }
  return bound;
}
function pathCheck(profile, start, goal, obstacles, options) {
  const maxMotion = options.maxMotionStepM ?? .015;
  finite(maxMotion, 'Path motion resolution'); if (maxMotion < .001 || maxMotion > .05) throw Error('Path resolution must be 0.001–0.05 m.');
  const delta = goal.map((v, i) => v - start[i]);
  const bound = motionBound(profile, delta), steps = Math.max(1, Math.ceil(bound / maxMotion));
  if (steps > 2048) return {valid: false, path: [], reasons: [{kind: 'path-resolution-budget', steps}], maxUnobservedMotionM: null};
  const path = [];
  const first = fk(profile, start), firstHits = collisions(first, obstacles);
  if (firstHits.length) return {valid: false, path: [], reasons: [{kind: 'start-collision', collisions: firstHits}], maxUnobservedMotionM: null};
  path.push({fraction: 0, joints: [...start], points: first.points, pose: first.pose});
  // Midpoint capsule inflation covers every point during each interpolated joint interval by
  // the chain's conservative angular-motion bound. This is stronger than unpadded snapshots.
  const inflation = bound / steps / 2;
  for (let i = 1; i <= steps; i++) {
    const mid = start.map((q, j) => q + delta[j] * (i - .5) / steps), state = fk(profile, mid), hits = collisions(state, obstacles, inflation);
    if (hits.length) return {valid: false, path, reasons: [{kind: 'interpolated-path-collision', fraction: (i - .5) / steps, collisions: hits}], maxUnobservedMotionM: inflation};
    const angles = start.map((q, j) => q + delta[j] * i / steps), end = fk(profile, angles);
    path.push({fraction: i / steps, joints: angles, points: end.points, pose: end.pose});
  }
  return {valid: true, path, reasons: [], maxUnobservedMotionM: inflation};
}
export function checkArmPath(input, start, goal, {obstacles = [], ...options} = {}) {
  const p = normalizeArmProfile(input); checkJoints(p, start); checkJoints(p, goal);
  return pathCheck(p, start, goal, normalizeArmObstacles(obstacles), options);
}
function solveLinear(matrix, rhs) {
  const n = rhs.length, a = matrix.map((row, i) => [...row, rhs[i]]);
  for (let k = 0; k < n; k++) {
    let pivot = k; for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    if (Math.abs(a[pivot][k]) < 1e-14) return null;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    const divisor = a[k][k]; for (let j = k; j <= n; j++) a[k][j] /= divisor;
    for (let i = 0; i < n; i++) if (i !== k) { const f = a[i][k]; for (let j = k; j <= n; j++) a[i][j] -= f * a[k][j]; }
  }
  return a.map(row => row[n]);
}
function residual(state, target, weight) {
  const p = sub(target.position, state.pose.position), r = quaternionResidual(target.orientation, state.pose.orientation);
  return {vector: [p.x, p.y, p.z, weight * r.x, weight * r.y, weight * r.z], position: norm(p), orientation: norm(r), cost: dot(p, p) + weight * weight * dot(r, r)};
}
function boundedInt(value, fallback, lo, hi, label) { const n = value ?? fallback; if (!Number.isInteger(n) || n < lo || n > hi) throw Error(`${label} must be ${lo}–${hi}.`); return n; }
export function solveArmTarget(input, targetValue, options = {}) {
  const p = normalizeArmProfile(input), target = normalizePose(targetValue, {frameId: p.basePose.frameId, childFrameId: 'arm_target'});
  if (target.frameId !== p.basePose.frameId) throw Error('Register the target and arm base into the same named frame first.');
  const start = options.startJoints ?? p.homeJoints; checkJoints(p, start);
  const obstacles = normalizeArmObstacles(options.obstacles ?? []);
  const attempts = boundedInt(options.attempts, 10, 1, 24, 'IK attempts'), iterations = boundedInt(options.iterations, 180, 1, 500, 'IK iterations');
  const positionToleranceM = options.positionToleranceM ?? .002, orientationToleranceRad = options.orientationToleranceRad ?? .01;
  if (![positionToleranceM, orientationToleranceRad].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= .05)) throw Error('Use explicit positive pose tolerances at most 0.05.');
  const weight = .25, damping = .025, reasons = [], range = p.joints.map(j => j.limits.upper - j.limits.lower);
  const reach = p.joints.reduce((sum, j) => sum + norm(j.origin.position), norm(p.tool.position));
  const baseResult = {schema: 'brainsnn.arm-result.v1', profileId: p.id, modelBasis: p.basis, dynamicsValidated: false, physicalValidated: false,
    limits: {positionToleranceM, orientationToleranceRad, attempts, iterations, collisionModel: 'Capsule links against expanded reviewed box proxies; adjacent links excluded; interpolated paths conservatively padded by an angular-motion bound.',
      limitation: 'Kinematics and geometric path checks only. No payload, actuator torque, grasp, balance or safety certification.'}};
  if (norm(sub(target.position, p.basePose.position)) > reach + positionToleranceM) return {...baseResult, status: 'outside-reach-bound', reachable: false, configurationValid: false, pathValid: false, joints: null, points: [], path: [], positionErrorM: null, orientationErrorRad: null, reasons: [{kind: 'outside-chain-length-bound', maximumReachM: reach}]};
  let best = null, bestFeasible = null, seed = 0x6d2b79f5;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  for (let attempt = 0; attempt < attempts; attempt++) {
    let angles = attempt === 0 ? [...start] : attempt === 1 ? p.joints.map(j => (j.limits.lower + j.limits.upper) / 2) : p.joints.map((j, i) => j.limits.lower + range[i] * (.08 + .84 * random()));
    for (let iteration = 0; iteration < iterations; iteration++) {
      const state = fk(p, angles), e = residual(state, target, weight);
      if (!best || e.cost < best.error.cost) best = {angles: [...angles], state, error: e};
      if (e.position <= positionToleranceM && e.orientation <= orientationToleranceRad) {
        const hits = collisions(state, obstacles);
        if (hits.length) { reasons.push({kind: 'solution-collision', collisions: hits}); break; }
        const checked = pathCheck(p, start, angles, obstacles, options);
        const result = {...baseResult, status: checked.valid ? 'geometric-path-found' : 'pose-only', reachable: true, configurationValid: true, pathValid: checked.valid,
          joints: angles, points: state.points, pose: state.pose, path: checked.path, positionErrorM: e.position, orientationErrorRad: e.orientation, reasons: checked.reasons,
          pathMotionBoundM: checked.maxUnobservedMotionM};
        if (checked.valid) return result;
        if (!bestFeasible) bestFeasible = result;
        break;
      }
      // Geometric Jacobian for revolute joints, in the target's parent frame.
      const jacobian = Array.from({length: 6}, () => Array(p.joints.length).fill(0));
      for (let j = 0; j < p.joints.length; j++) {
        const v = cross(state.axes[j], sub(state.pose.position, state.origins[j])), a = state.axes[j];
        [v.x, v.y, v.z, a.x * weight, a.y * weight, a.z * weight].forEach((v, r) => { jacobian[r][j] = v; });
      }
      const normal = Array.from({length: 6}, (_, r) => Array.from({length: 6}, (_, c) => jacobian[r].reduce((sum, x, j) => sum + x * jacobian[c][j], r === c ? damping * damping : 0)));
      const solved = solveLinear(normal, e.vector); if (!solved) break;
      const delta = p.joints.map((_, j) => jacobian.reduce((sum, row, r) => sum + row[j] * solved[r], 0));
      const scale = Math.min(1, .25 / Math.max(1e-12, ...delta.map(Math.abs)));
      let next = null;
      for (const fraction of [1, .5, .25, .1]) {
        const candidate = angles.map((q, j) => clamp(q + delta[j] * scale * fraction, p.joints[j].limits.lower, p.joints[j].limits.upper));
        if (residual(fk(p, candidate), target, weight).cost < e.cost - 1e-14) { next = candidate; break; }
      }
      if (!next) break; angles = next;
    }
  }
  if (bestFeasible) return bestFeasible;
  const achieved = best && best.error.position <= positionToleranceM && best.error.orientation <= orientationToleranceRad;
  return {...baseResult, status: achieved ? 'pose-collision' : 'no-solution-within-budget', reachable: achieved ? true : null, configurationValid: false, pathValid: false,
    joints: best?.angles ?? null, points: best?.state.points ?? [], pose: best?.state.pose ?? null, path: [], positionErrorM: best?.error.position ?? null,
    orientationErrorRad: best?.error.orientation ?? null, reasons: reasons.length ? reasons.slice(0, 24) : [{kind: 'bounded-ik-search-failed', note: 'Failure to converge does not prove this target is unreachable.'}]};
}
export const DEFAULT_ARM_TARGET = forwardArmKinematics(GENERIC_ARM_PROFILE, [.25, -.8, 1.1, .15, -.3, -.15]).pose;
