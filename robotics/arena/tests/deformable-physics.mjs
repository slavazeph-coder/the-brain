/** CPU-only checks against the actual official MuJoCo WASM solver. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG, CONFIG_BOUNDS, normalizeConfig, loadPhysics, makeModelXML,
  attachmentCommand, createSimulation, runEpisode, seededCase,
} from '../../../brainsnn-r3f-app/public/arena/deformable/rope-physics.js';

const mujoco = await loadPhysics();
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
const finite = frame => assert.ok([frame.time, ...frame.qpos, ...frame.qvel, ...frame.rope.flat()].every(Number.isFinite));

test('configuration rejects unsupported and non-finite physical parameters', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  for (const invalid of [{ young: NaN }, { length: '1' }, { density: Infinity }, { target: [0, 1] }, { target: [0, NaN, 1] }, { elements: 21 }, { seed: 1.5 }, { damping: 0 }, { duration: 10 }, { amplitude: -1 }]) {
    assert.throws(() => normalizeConfig(invalid));
  }
  assert.throws(() => attachmentCommand({}, -1));
  assert.equal(normalizeConfig({ unknown: 'ignored' }).unknown, undefined);
});

test('mass equals the requested cylindrical rod mass, independent of capsule endcaps', () => {
  const c = normalizeConfig(), model = mujoco.MjModel.from_xml_string(makeModelXML(c));
  try {
    let mass = 0;
    for (let i = 0; i < c.elements; i++) {
      const body = model.body(`rod_${i}`);
      try { mass += model.body_mass[body.id]; } finally { body.delete(); }
    }
    close(mass, c.density * Math.PI * c.radius ** 2 * c.length);
    close(model.opt.timestep, .00025);
  } finally { model.delete(); }
});

test('reset, real integration, inextensible segments and disposal are observable', () => {
  const simulation = createSimulation(mujoco, { duration: .25 });
  const initial = simulation.snapshot();
  assert.equal(initial.physicsExecuted, false);
  assert.equal(initial.policyExecuted, false);
  assert.equal(initial.rope.length, 21);
  assert.equal(initial.qpos.length, 83);
  assert.equal(initial.qvel.length, 63);
  const next = simulation.step(500);
  finite(next);
  assert.equal(next.physicsExecuted, true);
  assert.equal(next.arm.length, 3);
  assert.deepEqual(next.arm.at(-1), next.attachment.position);
  assert.deepEqual(next.commandedAttachment.position, attachmentCommand(simulation.config, next.time).position);
  for (let i = 1; i < next.rope.length; i++) close(distance(next.rope[i], next.rope[i - 1]), simulation.config.length / 20);
  assert.ok(distance(initial.tip, next.tip) > .01);
  assert.deepEqual(simulation.reset(), initial);
  assert.deepEqual(simulation.step(500), next);
  assert.throws(() => simulation.step(0));
  simulation.dispose(); simulation.dispose();
  assert.throws(() => simulation.snapshot(), /disposed/);
  assert.throws(() => simulation.step(), /disposed/);
});

test('gravity deforms the rod without an attachment swing; material changes alter dynamics', () => {
  const base = { duration: .25, amplitude: 0 };
  const normal = runEpisode(mujoco, base);
  assert.ok(normal.frames.at(-1).tip[2] < normal.frames[0].tip[2] - .1);
  assert.ok(distance(normal.frames[0].attachment.position, normal.frames.at(-1).attachment.position) < .01);
  const soft = runEpisode(mujoco, { ...base, young: CONFIG_BOUNDS.young[0] });
  const dense = runEpisode(mujoco, { ...base, density: CONFIG_BOUNDS.density[1] });
  assert.deepEqual(soft.frames[0].rope, normal.frames[0].rope);
  assert.ok(distance(soft.frames.at(-1).tip, normal.frames.at(-1).tip) > .001);
  assert.ok(distance(dense.frames.at(-1).tip, normal.frames.at(-1).tip) > .001);
});

test('default hit and unreachable miss use physical distance; target does not steer the rod', () => {
  const hit = runEpisode(mujoco);
  const miss = runEpisode(mujoco, { target: [-3, -3, 3] });
  assert.equal(hit.outcome.completed, true);
  assert.equal(hit.outcome.success, true);
  assert.equal(miss.outcome.success, false);
  assert.equal(miss.outcome.status, 'miss');
  assert.ok(hit.outcome.minDistance < hit.config.targetRadius);
  assert.ok(miss.outcome.minDistance > miss.config.targetRadius);
  for (let i = 0; i < hit.frames.length; i++) {
    assert.deepEqual(hit.frames[i].qpos, miss.frames[i].qpos);
    assert.deepEqual(hit.frames[i].qvel, miss.frames[i].qvel);
    finite(hit.frames[i]);
  }
  close(distance(hit.outcome.closestWitness.tip, hit.config.target), hit.outcome.minDistance);
  close(distance(miss.outcome.closestWitness.tip, miss.config.target), miss.outcome.minDistance);
  assert.equal(hit.frames[0].physicsExecuted, false);
  assert.equal(hit.frames.at(-1).physicsExecuted, true);
  assert.equal(hit.provenance.policyExecuted, false);
  assert.equal(hit.provenance.physicsExecuted, true);
  assert.equal(hit.provenance.engineVersion, mujoco.mj_versionString());
  close(hit.outcome.steps * hit.outcome.timestep, hit.outcome.elapsedSimSeconds);
  assert.ok(hit.outcome.elapsedSimSeconds <= 2 + 1e-10);
  assert.equal(hit.provenance.integration.requestedTimestep, .0005);
  assert.equal(hit.provenance.integration.timestep, .00025);
  assert.equal(hit.outcome.steps, 8000);
});

test('same configuration is reproducible; recording does not change the judge or speed', () => {
  const c = { duration: .5, yaw: .4 };
  const first = runEpisode(mujoco, c), second = runEpisode(mujoco, c), unrecorded = runEpisode(mujoco, c, { record: false });
  assert.deepEqual(first.frames, second.frames);
  assert.deepEqual(first.outcome, second.outcome);
  assert.deepEqual(unrecorded.outcome, first.outcome);
  assert.equal(unrecorded.frames.length, 0);
  assert.ok(unrecorded.summary.peakTipSpeed > 0);
});

test('a non-divisible requested horizon stops at the last whole physics step', () => {
  const run = runEpisode(mujoco, { duration: .1001 }, { record: false });
  assert.equal(run.outcome.completed, true);
  assert.ok(run.outcome.elapsedSimSeconds <= run.config.duration);
  assert.ok(run.config.duration - run.outcome.elapsedSimSeconds < run.outcome.timestep);
  assert.equal(run.provenance.integration.requestedDuration, .1001);
});

test('seed perturbations are deterministic, bounded, explicit and actually affect physics', () => {
  const a = seededCase({ duration: .25 }, 12), b = seededCase({ duration: .25 }, 13);
  assert.deepEqual(a, seededCase({ duration: .25 }, 12));
  assert.notDeepEqual(a, b);
  assert.equal(a.seed, 12);
  assert.ok(a.target.every((v, i) => Math.abs(v - DEFAULT_CONFIG.target[i]) <= .06));
  const ar = runEpisode(mujoco, a), br = runEpisode(mujoco, b);
  assert.ok(distance(ar.frames.at(-1).tip, br.frames.at(-1).tip) > 1e-5);
});

/**
 * Independent reference: in a planar gravity-only case there is no torsion.
 * MuJoCo's native scalar ball-joint stiffness EI/ds must reproduce the custom
 * circular-rod bending torque. The native solver computes all reference forces;
 * this function never calls or reproduces our quaternion/stress implementation.
 */
function nativeBendingReference(c) {
  const rigidity = c.young * Math.PI * c.radius ** 4 / 4;
  const stiffness = rigidity / (c.length / c.elements);
  const xml = makeModelXML(c).replaceAll('type="ball"', `type="ball" stiffness="${stiffness}"`);
  const model = mujoco.MjModel.from_xml_string(xml), data = new mujoco.MjData(model);
  try {
    mujoco.mj_forward(model, data);
    const dt = model.opt.timestep;
    for (let step = 0; step < Math.floor(c.duration / dt + 1e-9); step++) {
      const command = attachmentCommand(c, data.time);
      data.mocap_pos.set(command.position); data.mocap_quat.set(command.quaternion);
      mujoco.mj_step(model, data);
    }
    mujoco.mj_kinematics(model, data);
    const site = model.site('tip');
    try { return Array.from(data.site_xpos.slice(site.id * 3, site.id * 3 + 3)); } finally { site.delete(); }
  } finally { data.delete(); model.delete(); }
}

test('custom elastic torque agrees with independent native MuJoCo bending; halving dt converges', () => {
  const tips = [], outcomes = [];
  for (const timestep of [.00025, .000125]) {
    const c = normalizeConfig({ amplitude: 0, duration: .25, timestep });
    const run = runEpisode(mujoco, c), tip = run.frames.at(-1).tip;
    const reference = nativeBendingReference(c);
    assert.ok(distance(tip, reference) < 1e-9, `Custom vs native stiffness: ${distance(tip, reference)} m`);
    tips.push(tip); outcomes.push(run.outcome);
  }
  assert.ok(distance(...tips) < .0002, 'Contact-free short trajectory should converge under timestep refinement.');
  assert.ok(Math.abs(outcomes[0].minDistance - outcomes[1].minDistance) < .0002);
  assert.ok(Math.abs(outcomes[0].peakTipSpeed - outcomes[1].peakTipSpeed) < .001);
});

test('physical corner cases remain finite at the fixed stability timestep cap', () => {
  // Small CPU qualification grid, not a claimed benchmark or training run.
  for (const young of CONFIG_BOUNDS.young) for (const radius of CONFIG_BOUNDS.radius)
    for (const length of CONFIG_BOUNDS.length) for (const density of CONFIG_BOUNDS.density)
      for (const damping of CONFIG_BOUNDS.damping) {
        const c = { young, radius, length, density, damping, timestep: .001, amplitude: 1.2, swingDuration: .25 };
        const run = runEpisode(mujoco, c, { record: false });
        assert.equal(run.summary.completed, true, JSON.stringify(c));
        assert.ok([run.summary.minDistance, run.summary.peakTipSpeed, run.summary.peakHandleTrackingError].every(Number.isFinite));
        assert.ok(run.summary.timestep >= .000125 && run.summary.timestep <= .00025);
        assert.equal(run.summary.steps * run.summary.timestep, 2);
      }
});
