import { describe, expect, it } from '../../../test/tinyVitest.js';
import { BRAIN_REGIONS, PATHWAYS } from '../../brain3d/brainRegions.js';
import {
  addImpulse,
  addPulse,
  advanceCascade,
  createJellyState,
  createUniformTarget,
  dragHeld,
  dragHeldVector,
  fireRegion,
  impulseAmplitude,
  isSettled,
  JELLY,
  motionConfig,
  nearestRegion,
  outgoingPathways,
  pruneJelly,
  releaseHeld,
  shakeSchedule,
  springAmplitude,
  springEnvelope,
  squashAmount,
  writeUniforms,
} from './jellyPhysics.js';

const IN = [0, 0, -1];

describe('jelly spring', () => {
  it('jelly: the spring starts at the release amplitude and overshoots past zero', () => {
    expect(springAmplitude(0.7, 0)).toBe(0.7);
    // Under-damped: somewhere in the first wobble it has to cross to the other side.
    let crossed = false;
    for (let t = 0.01; t < 0.4; t += 0.01) if (springAmplitude(0.7, t) < 0) crossed = true;
    expect(crossed).toBe(true);
  });

  it('jelly: most of the wobble is gone in a second and all of it by three', () => {
    expect(springEnvelope(0.7, 1)).toBeLessThan(0.7 * 0.15);
    expect(springEnvelope(0.7, 3)).toBeLessThan(JELLY.settleEpsilon);
  });

  it('jelly: reduced motion eases out without overshoot or whole-body squash', () => {
    const calm = motionConfig(true);
    expect(calm.squashGain).toBe(0);
    for (let t = 0; t < 2; t += 0.02) expect(springAmplitude(0.7, t, calm)).toBeGreaterThanOrEqual(0);
    expect(motionConfig(false)).toBe(JELLY);
  });
});

describe('jelly impulses', () => {
  it('jelly: a held impulse follows the drag within its caps', () => {
    let { state, id } = addImpulse(createJellyState(), { origin: [5, 0, 0], dir: IN, amplitude: 0, at: 0, held: true });
    state = dragHeld(state, id, 40);
    expect(impulseAmplitude(state.impulses[0], 10)).toBeCloseTo(40 * JELLY.dragGain, 5);
    state = dragHeld(state, id, 100000);
    expect(state.impulses[0].amplitude).toBe(JELLY.maxPush);
    state = dragHeld(state, id, -100000);
    expect(state.impulses[0].amplitude).toBe(-JELLY.maxPull);
  });

  it('jelly: a grab stretches in the direction the pointer moves, capped so it cannot tear', () => {
    let { state, id } = addImpulse(createJellyState(), { origin: [5, 0, 0], dir: IN, amplitude: 0, at: 0, held: true });
    state = dragHeldVector(state, id, [0, 0.6, 0.8]);
    expect(state.impulses[0].dir).toEqual([0, 0.6, 0.8]);
    expect(state.impulses[0].amplitude).toBeCloseTo(1, 6);
    state = dragHeldVector(state, id, [30, 0, 0]);
    expect(state.impulses[0].amplitude).toBe(JELLY.maxPull);
    state = dragHeldVector(state, id, [0, 0, 0]);
    expect(state.impulses[0].amplitude).toBe(0);
    // Letting go of a stretch springs back along the stretch.
    state = dragHeldVector(state, id, [0, 1.2, 0]);
    state = releaseHeld(state, id, 1);
    expect(state.impulses[0].dir).toEqual([0, 1, 0]);
    expect(state.squash.axis).toEqual([0, 1, 0]);
  });

  it('jelly: releasing a dragged surface springs from where the drag left it and squashes the body', () => {
    let { state, id } = addImpulse(createJellyState(), { origin: [5, 0, 0], dir: IN, amplitude: 0, at: 0, held: true });
    state = dragHeld(state, id, -60);
    state = releaseHeld(state, id, 1);
    const impulse = state.impulses[0];
    expect(impulse.held).toBe(false);
    expect(impulse.amplitude).toBeCloseTo(-60 * JELLY.dragGain, 5);
    expect(impulseAmplitude(impulse, 1)).toBeCloseTo(impulse.amplitude, 5);
    expect(state.squash.amount).toBeLessThan(0);
    expect(Math.abs(squashAmount(state.squash, 1))).toBeGreaterThan(0);
  });

  it('jelly: a release with no real drag still wobbles like a tap', () => {
    let { state, id } = addImpulse(createJellyState(), { origin: [5, 0, 0], dir: IN, amplitude: 0, at: 0, held: true });
    state = releaseHeld(state, id, 0.2);
    expect(state.impulses[0].amplitude).toBe(JELLY.pokeAmplitude);
  });

  it('jelly: impulses and pulses are ring buffers capped at the shader array size', () => {
    let state = createJellyState();
    for (let index = 0; index < 20; index += 1) {
      state = addImpulse(state, { origin: [index, 0, 0], dir: IN, at: index * 0.01 }).state;
      state = addPulse(state, [index, 0, 0], index * 0.01);
    }
    expect(state.impulses).toHaveLength(JELLY.maxImpulses);
    expect(state.pulses).toHaveLength(JELLY.maxPulses);
    // Oldest out, newest kept.
    expect(state.impulses[JELLY.maxImpulses - 1].origin[0]).toBe(19);
  });

  it('jelly: everything settles and is pruned, so play time never grows the state', () => {
    let state = addImpulse(createJellyState(), { origin: [5, 0, 0], dir: IN, at: 0 }).state;
    state = releaseHeld(addImpulse(state, { origin: [4, 1, 0], dir: IN, amplitude: 0.5, at: 0, held: true }).state, 2, 0);
    state = addPulse(state, [5, 0, 0], 0);
    expect(isSettled(state)).toBe(false);
    expect(pruneJelly(state, 0.1)).toBe(state);
    const settled = pruneJelly(state, 10);
    expect(isSettled(settled)).toBe(true);
  });
});

describe('jelly signals through the pathway graph', () => {
  it('jelly: a poke drives the region nearest to it', () => {
    for (const region of BRAIN_REGIONS) {
      const [x, y, z] = region.position;
      expect(nearestRegion([x + 0.1, y - 0.1, z + 0.05])).toBe(region.code);
    }
  });

  it('jelly: firing a region sends one hop down each of its outgoing pathways', () => {
    const state = fireRegion(createJellyState(), 'CTX', 0);
    const expected = outgoingPathways('CTX').map((pathway) => pathway.id);
    expect(state.hops.map((hop) => hop.pathwayId)).toEqual(expected);
    expect(state.fired).toBe(expected.length);
    expect(fireRegion(createJellyState(), 'NOPE', 0).hops).toHaveLength(0);
  });

  it('jelly: the cascade travels hop by hop, stops at its depth limit, and never runs forever', () => {
    let state = fireRegion(createJellyState(), 'THL', 0);
    const seen = [];
    let now = 0;
    for (let step = 0; step < 200; step += 1) {
      now += 0.05;
      const result = advanceCascade(state, now);
      state = result.state;
      for (const arrival of result.arrivals) seen.push(arrival);
    }
    expect(state.hops).toHaveLength(0);
    expect(seen.length).toBeGreaterThan(1);
    expect(Math.max(...seen.map((hop) => hop.depth))).toBe(JELLY.cascadeDepth);
    // First hop from the thalamus lands in cortex, the route the model calls attention to meaning.
    expect(seen[0].to).toBe('CTX');
    // First-hop arrivals leave a flash on the surface above the region.
    expect(state.pulses.length).toBeGreaterThan(0);
  });

  it('jelly: inhibitory pathways quench instead of propagating', () => {
    const inhibitory = PATHWAYS.find((pathway) => pathway.inhibitory);
    let state = fireRegion(createJellyState(), inhibitory.from, 0);
    const before = state.fired;
    ({ state } = advanceCascade(state, JELLY.hopSeconds + 0.01));
    const fromTarget = state.hops.filter((hop) => hop.from === inhibitory.to);
    expect(fromTarget).toHaveLength(0);
    expect(state.fired).toBeGreaterThanOrEqual(before);
  });
});

describe('jelly uniforms and shake', () => {
  it('jelly: uniforms are written in place and empty slots are switched off', () => {
    const target = createUniformTarget();
    let state = addImpulse(createJellyState(), { origin: [1, 2, 3], dir: [0, 0, -2], at: 0 }).state;
    state = addPulse(state, [4, 5, 6], 0.5);
    const written = writeUniforms(state, 1, target);
    expect(written).toBe(target);
    expect([...target.impulses.slice(0, 3)]).toEqual([1, 2, 3]);
    expect(target.dirs[2]).toBeCloseTo(-1, 5);
    expect(target.dirs[3]).toBeCloseTo(JELLY.pokeRadius, 5);
    expect(target.dirs[7]).toBe(0);
    expect(target.pulses[3]).toBeCloseTo(0.5, 5);
    expect(target.pulses[7]).toBe(-1);
    expect(target.squash[3]).toBe(0);
  });

  it('jelly: shake is seeded, so the same shake looks the same in every clip', () => {
    expect(shakeSchedule('clip')).toEqual(shakeSchedule('clip'));
    expect(shakeSchedule('clip')).not.toEqual(shakeSchedule('other'));
    const schedule = shakeSchedule('clip', 6);
    expect(schedule).toHaveLength(6);
    for (let index = 1; index < schedule.length; index += 1) {
      expect(schedule[index].delay).toBeGreaterThan(schedule[index - 1].delay);
    }
  });
});
