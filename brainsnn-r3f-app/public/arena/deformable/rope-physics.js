/**
 * Browser-local discrete elastic rod in the official MuJoCo WASM runtime.
 *
 * Elastic torque is adapted from DeepMind's Apache-2.0 cable plugin:
 * https://github.com/google-deepmind/mujoco/blob/3.3.0/plugin/elasticity/cable.cc
 * Copyright 2022 DeepMind Technologies Limited. Licensed under Apache-2.0:
 * https://www.apache.org/licenses/LICENSE-2.0
 * Modified: JavaScript implementation, straight reference curvature, world-space
 * equal-and-opposite body torques. This is NOT the unavailable cable plugin.
 *
 * This inextensible capsule/ball-joint approximation models bending and twisting;
 * it is not DeformX 2.0, a learned policy, an extensible Cosserat continuum,
 * calibrated robot dynamics, or an acoustic/supersonic whip-crack model.
 */
export const DEFAULT_CONFIG = Object.freeze({
  target: Object.freeze([.9, 0, 1]), targetRadius: .08, amplitude: .8,
  swingDuration: .8, yaw: 0, length: 1, radius: .00635, young: 200000,
  density: 700, damping: .0003, timestep: .0005, duration: 2, seed: 7,
  elements: 20,
});
export const CONFIG_BOUNDS = Object.freeze({
  targetRadius: [.02, .25], amplitude: [0, 1.2], swingDuration: [.25, 1.25],
  yaw: [-Math.PI, Math.PI], length: [.6, 1.4], radius: [.003, .008],
  young: [20000, 500000], density: [300, 1500], damping: [.0001, .003],
  timestep: [.000125, .001], duration: [.1, 2], seed: [0, 2147483647],
});
const clone = x => JSON.parse(JSON.stringify(x));
const dist = (a, b) => Math.hypot(...a.map((x, i) => x - b[i]));
const vec = (array, offset) => [array[offset], array[offset + 1], array[offset + 2]];
const number = (v, key, lo, hi) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new RangeError(`${key} must be a finite number in [${lo}, ${hi}].`);
  return v;
};
export function normalizeConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Configuration must be an object.');
  const c = { ...DEFAULT_CONFIG, ...input };
  for (const [key, [lo, hi]] of Object.entries(CONFIG_BOUNDS)) c[key] = number(c[key], key, lo, hi);
  if (!Number.isSafeInteger(c.seed)) throw new RangeError('seed must be a whole number.');
  if (c.elements !== 20) throw new RangeError('This version uses exactly 20 rod elements.');
  if (!Array.isArray(c.target) || c.target.length !== 3) throw new TypeError('target must contain three coordinates.');
  c.target = c.target.map((v, i) => number(v, `target[${i}]`, -3, 3));
  // Preserve only documented fields, so exported configuration is reproducible.
  return Object.fromEntries(Object.keys(DEFAULT_CONFIG).map(key => [key, c[key]]));
}
export async function loadPhysics({ locateFile } = {}) {
  const { default: loadMujoco } = await import('./vendor/mujoco.js');
  return loadMujoco(locateFile ? { locateFile } : {});
}
function rotate(q, v) {
  const [w, x, y, z] = q, [a, b, c] = v;
  const tx = 2 * (y * c - z * b), ty = 2 * (z * a - x * c), tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
}
function multiply(a, b) {
  const [w,x,y,z] = a, [v,i,j,k] = b;
  return [w*v-x*i-y*j-z*k, w*i+x*v+y*k-z*j, w*j-x*k+y*v+z*i, w*k+x*j-y*i+z*v];
}
function commandAt(c, time) {
  const u = Math.min(1, Math.max(0, time / c.swingDuration));
  const swing = c.amplitude * Math.sin(2 * Math.PI * u) * Math.sin(Math.PI * u) ** 2;
  const shoulder = .5 + .65 * swing, forearm = .5 - .9 * swing;
  const origin = [-.6, 0, 1.05], cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const planar = (r, z) => [origin[0] + r * cy, r * sy, origin[2] + z];
  const elbow = planar(.42 * Math.cos(shoulder), .42 * Math.sin(shoulder));
  const position = planar(.42 * Math.cos(shoulder) + .38 * Math.cos(forearm), .42 * Math.sin(shoulder) + .38 * Math.sin(forearm));
  const quaternion = multiply([Math.cos(c.yaw / 2), 0, 0, Math.sin(c.yaw / 2)], [Math.cos(swing / 2), 0, -Math.sin(swing / 2), 0]);
  return { time, position, quaternion, arm: [origin, elbow, position], shoulder, forearm, swing };
}
export function attachmentCommand(input = {}, time = 0) {
  const c = normalizeConfig(input);
  number(time, 'time', 0, c.duration);
  return commandAt(c, time);
}
// Conservative fixed substeps for the supported parameter box. Low material
// damping needs a smaller step during self-contact; never add hidden damping.
const stabilityCap = c => c.damping < .0003 ? .000125 : .00025;
const integrationStep = c => Math.min(c.timestep, stabilityCap(c));
export function makeModelXML(input = {}) {
  const c = normalizeConfig(input), ds = c.length / c.elements, initial = commandAt(c, 0);
  let chain = '';
  for (let i = 0; i < c.elements; i++) {
    chain += `<body name="rod_${i}" pos="${i ? ds : 0} 0 0">${i ? `<joint name="bend_${i}" type="ball" damping="${c.damping}"/>` : ''}<geom type="capsule" fromto="0 0 0 ${ds} 0 0" size="${c.radius}" mass="${c.density * Math.PI * c.radius ** 2 * ds}" friction="0.4 0.005 0.0001"/><site name="node_${i}" pos="0 0 0" size="0.002"/>`;
  }
  chain += `<site name="tip" pos="${ds} 0 0" size="0.004"/>` + '</body>'.repeat(c.elements);
  return `<mujoco model="brainsnn_discrete_elastic_rod_v1"><compiler angle="radian"/><option timestep="${integrationStep(c)}" gravity="0 0 -9.81" integrator="implicitfast" iterations="40" tolerance="1e-9"/><size memory="16M"/><default><geom solref="0.004 1" solimp="0.95 0.99 0.001"/></default><worldbody><geom name="ground" type="plane" size="4 4 0.1"/><body name="drive" mocap="true" pos="${initial.position.join(' ')}" quat="${initial.quaternion.join(' ')}"><geom type="sphere" size="0.015" contype="0" conaffinity="0"/></body><body name="handle" pos="${initial.position.join(' ')}" quat="${initial.quaternion.join(' ')}"><freejoint/><geom type="sphere" size="0.02" mass="0.2" contype="0" conaffinity="0"/>${chain}</body><site name="target" pos="${c.target.join(' ')}" size="${c.targetRadius}"/></worldbody><equality><weld body1="drive" body2="handle" solref="0.002 1" solimp="0.99 0.999 0.001"/></equality></mujoco>`;
}
function logQuaternion(q) {
  const sign = q[0] < 0 ? -1 : 1;
  const n = Math.hypot(q[1], q[2], q[3]);
  if (n < 1e-12) return [0, 0, 0];
  const scale = 2 * Math.atan2(n, Math.abs(q[0])) / n * sign;
  return [q[1] * scale, q[2] * scale, q[3] * scale];
}
function nearestOnSegment(a, b, p) {
  const ab = b.map((x, i) => x - a[i]), norm = ab.reduce((s, x) => s + x*x, 0);
  const t = norm ? Math.max(0, Math.min(1, ab.reduce((s, x, i) => s + x * (p[i] - a[i]), 0) / norm)) : 0;
  const point = a.map((x, i) => x + t * ab[i]);
  return { point, fraction: t, distance: dist(point, p) };
}
export function createSimulation(mujoco, input = {}) {
  const config = normalizeConfig(input), model = mujoco.MjModel.from_xml_string(makeModelXML(config));
  let data;
  try { data = new mujoco.MjData(model); } catch (error) { model.delete(); throw error; }
  const bodyIds = [], siteIds = [], joints = [];
  const accessId = (kind, name) => { const a = model[kind](name); try { return a.id; } finally { a.delete(); } };
  for (let i = 0; i < config.elements; i++) {
    bodyIds.push(accessId('body', `rod_${i}`)); siteIds.push(accessId('site', `node_${i}`));
    if (i) {
      const j = model.jnt(`bend_${i}`);
      try { joints.push({ child: bodyIds[i], parent: bodyIds[i - 1], qadr: model.jnt_qposadr[j.id] }); } finally { j.delete(); }
    }
  }
  siteIds.push(accessId('site', 'tip'));
  const handleId = accessId('body', 'handle');
  const I = Math.PI * config.radius ** 4 / 4, J = 2 * I, G = config.young / 3;
  const ds = config.length / config.elements;
  const stiffness = [G * J / ds, config.young * I / ds, config.young * I / ds];
  let disposed = false, steps = 0, minDistance = Infinity, peakTipSpeed = 0, previousTip, closestWitness, peakHandleTrackingError = 0;
  // Stop at the last whole integration step within the requested horizon.
  const timestep = integrationStep(config);
  const maxSteps = Math.floor(config.duration / timestep + 1e-9);
  const guard = () => { if (disposed) throw new Error('Simulation has been disposed.'); };
  function applyCommand(t) {
    const cmd = commandAt(config, t);
    data.mocap_pos.set(cmd.position); data.mocap_quat.set(cmd.quaternion);
    return cmd;
  }
  const tipNow = () => vec(data.site_xpos, siteIds[siteIds.length - 1] * 3);
  function observe(previousTime) {
    const tip = tipNow();
    if (![data.time, ...tip, ...data.qpos, ...data.qvel].every(Number.isFinite)) throw new Error('Physics produced a non-finite state.');
    const elapsed = data.time - previousTime;
    if (previousTip && elapsed > 0) peakTipSpeed = Math.max(peakTipSpeed, dist(tip, previousTip) / elapsed);
    const near = previousTip ? nearestOnSegment(previousTip, tip, config.target) : { point: tip, fraction: 0, distance: dist(tip, config.target) };
    if (near.distance < minDistance) {
      minDistance = near.distance;
      closestWitness = { time: previousTime + (elapsed > 0 ? elapsed * near.fraction : 0), tip: near.point.slice(), target: config.target.slice(), distance: near.distance, kind: 'linear interpolation between adjacent physics samples' };
    }
    peakHandleTrackingError = Math.max(peakHandleTrackingError, dist(vec(data.xpos, handleId * 3), commandAt(config, data.time).position));
    previousTip = tip;
  }
  function reset() {
    guard(); mujoco.mj_resetData(model, data); applyCommand(0); mujoco.mj_forward(model, data);
    steps = 0; minDistance = Infinity; peakTipSpeed = 0; peakHandleTrackingError = 0; previousTip = null; closestWitness = null;
    observe(0); return snapshot();
  }
  function elasticTorques() {
    // Adapts cable.cc's local stress and frame pullback to world-space torque.
    // Straight local-X segments have zero reference curvature; X is torsion.
    data.xfrc_applied.fill(0);
    for (const joint of joints) {
      const omega = logQuaternion(Array.from(data.qpos.subarray(joint.qadr, joint.qadr + 4)));
      const parentStress = omega.map((angle, axis) => -stiffness[axis] * angle);
      const world = rotate(Array.from(data.xquat.subarray(joint.parent * 4, joint.parent * 4 + 4)), parentStress);
      for (let axis = 0; axis < 3; axis++) {
        data.xfrc_applied[joint.child * 6 + 3 + axis] += world[axis];
        data.xfrc_applied[joint.parent * 6 + 3 + axis] -= world[axis];
      }
    }
  }
  function step(n = 1) {
    guard(); if (!Number.isSafeInteger(n) || n < 1 || n > 16000) throw new RangeError('step count must be a whole number from 1 to 16000.');
    for (let i = 0; i < n && steps < maxSteps; i++) {
      const before = data.time;
      applyCommand(before); mujoco.mj_kinematics(model, data); elasticTorques();
      mujoco.mj_step(model, data); mujoco.mj_kinematics(model, data);
      steps++; observe(before);
      if (Math.abs(data.time - steps * timestep) > timestep * .1) throw new Error('MuJoCo reset an unstable simulation.');
    }
    return snapshot();
  }
  function snapshot() {
    guard();
    const commandedAttachment = commandAt(config, data.time), actualHandle = vec(data.xpos, handleId * 3);
    const arm = commandedAttachment.arm.map(p => p.slice()); arm[arm.length - 1] = actualHandle;
    return { time: data.time, step: steps, timestep, rope: siteIds.map(id => vec(data.site_xpos, id * 3)), arm,
      tip: tipNow(), target: config.target.slice(), targetRadius: config.targetRadius,
      qpos: Array.from(data.qpos), qvel: Array.from(data.qvel), minDistance, peakTipSpeed,
      commandedAttachment: { position: commandedAttachment.position, quaternion: commandedAttachment.quaternion, shoulder: commandedAttachment.shoulder, forearm: commandedAttachment.forearm, swing: commandedAttachment.swing },
      attachment: { position: actualHandle, quaternion: Array.from(data.xquat.subarray(handleId * 4, handleId * 4 + 4)) },
      physicsExecuted: steps > 0, policyExecuted: false };
  }
  function result() {
    guard();
    return { status: steps < maxSteps ? 'in_progress' : minDistance <= config.targetRadius ? 'success' : 'miss',
      success: steps >= maxSteps && minDistance <= config.targetRadius, completed: steps >= maxSteps,
      minDistance, peakTipSpeed, closestWitness: clone(closestWitness), elapsedSimSeconds: data.time,
      steps, timestep, requestedTimestep: config.timestep, peakHandleTrackingError, targetRadius: config.targetRadius,
      judge: 'minimum tip-centre to target-centre distance, interpolated between physics steps',
      physicsExecuted: steps > 0, policyExecuted: false };
  }
  function dispose() { if (!disposed) { disposed = true; data.delete(); model.delete(); } }
  try { reset(); } catch (error) { dispose(); throw error; }
  return { config: clone(config), reset, step, snapshot, result, dispose };
}
export function runEpisode(mujoco, input = {}, { record = true } = {}) {
  const simulation = createSimulation(mujoco, input), config = simulation.config, frames = [];
  const frameStride = Math.max(1, Math.round(1 / (60 * integrationStep(config))));
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    if (record) frames.push(simulation.snapshot());
    while (!simulation.result().completed) { simulation.step(frameStride); if (record) frames.push(simulation.snapshot()); }
    const outcome = simulation.result();
    return { config, outcome, frames, summary: { ...outcome, wallSeconds: ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started) / 1000, frameCount: frames.length },
      provenance: { engine: 'MuJoCo', engineVersion: mujoco.mj_versionString(), backend: 'official single-thread WebAssembly',
        schema: 'brainsnn.discrete-elastic-rod.v1', physicsExecuted: outcome.steps > 0, policyExecuted: false,
        integration: { timestep: outcome.timestep, requestedTimestep: config.timestep, stabilityCap: stabilityCap(config), stabilityPolicy: 'Fixed cap 0.00025 s; 0.000125 s when material damping is below 0.0003 N·m·s/rad.', requestedDuration: config.duration, executedSteps: outcome.steps, elapsedSimSeconds: outcome.elapsedSimSeconds, integrator: 'implicitfast', adaptive: false },
        controller: 'prescribed attachment swing; dynamic handle follows a mocap weld',
        material: { bendRigidityNm2: config.young * Math.PI * config.radius ** 4 / 4, twistRigidityNm2: config.young / 3 * Math.PI * config.radius ** 4 / 2, nominalMassKg: config.density * Math.PI * config.radius ** 2 * config.length, massDistribution: 'Equal cylindrical segment masses with capsule-shaped inertias.' },
        limitations: ['20 inextensible rigid capsules with elastic ball-joint bending/twisting; not a full extensible Cosserat continuum.', 'Visible arm is a kinematic drawing ending at the simulated handle, not simulated robot joints or motor loads.', 'No learned policy, DeformX 2.0, calibrated sim-to-real accuracy, aerodynamic model or acoustic shock physics.', 'Target is a non-colliding geometric judge; no balloon material/fracture model.', 'Snapshots omit contact solver warm-start state and cannot by themselves restore an arbitrary mid-run state. Re-run from configuration and reset.'] } };
  } finally { simulation.dispose(); }
}
export function seededCase(input = {}, seed = 7) {
  const base = normalizeConfig(input); number(seed, 'seed', 0, 2147483647);
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a whole number.');
  let s = seed >>> 0;
  const random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const result = { ...base, seed,
    target: base.target.map(v => Math.max(-3, Math.min(3, v + (random() - .5) * .12))),
    young: Math.max(20000, Math.min(500000, base.young * (.85 + random() * .3))),
    density: Math.max(300, Math.min(1500, base.density * (.9 + random() * .2))) };
  return normalizeConfig(result);
}
