// Jelly physics for Poke the Brain.
//
// The watermelon-jelly feel comes from three pieces, all computed here and none
// of them simulated per vertex on the CPU:
//
//   1. Impulses — a poke or a grab is a gaussian dent centred on the hit point.
//      While held it follows the drag; on release it becomes a damped spring,
//      so the surface overshoots and wobbles back instead of snapping.
//   2. Squash — every release also sets the whole body oscillating along the
//      poke axis. That is what makes it read as one soft object, not a sheet.
//   3. Signals — a ring pulse expands across the surface from the poke, and the
//      nearest region fires along the existing PATHWAYS graph, hop by hop, so
//      the signal visibly travels through the same connectome the rest of the
//      site renders.
//
// Everything is closed-form in time: the vertex shader receives an amplitude
// per impulse per frame, never a buffer of simulated positions. That keeps the
// wobble at 60fps on a laptop and makes the maths testable here in bare Node.
import { BRAIN_REGIONS, PATHWAYS, REGION_MAP } from '../../brain3d/brainRegions.js';
import { createRng } from '../../../lib/rng.js';
import { surfacePointToward } from './brainShell.js';

export const JELLY = Object.freeze({
  maxImpulses: 8,
  maxPulses: 8,
  // A tap pushes the surface in this far (world units) before it springs back.
  // Tuned for the stress-toy feel: deep enough to feel like a handful of
  // jelly, not a prod at a balloon.
  pokeAmplitude: 0.9,
  pokeRadius: 1.7,
  // Dragging on the surface pulls or pushes it, capped so it cannot tear.
  maxPull: 2.2,
  maxPush: 1.0,
  dragGain: 0.0115,
  // A grab is wider than a tap: you are stretching a handful, not prodding a point.
  grabRadius: 2.0,
  // The spring: ~2 wobbles a second. Most of the motion is gone within a
  // second; the last visible shiver settles by about three. The long tail is
  // the point — it is what makes a clip of it satisfying to watch.
  // zeta * omega stays above ~1.96 so the envelope promises in the unit suite
  // (gone-ish by one second, gone by three) keep holding.
  omega: 13.0,
  zeta: 0.155,
  // Whole-body squash-and-stretch on release. Generous: this is what makes it
  // read as one soft object instead of a dented sheet.
  squashGain: 0.15,
  squashMax: 0.24,
  squashOmega: 9.0,
  squashDecay: 2.2,
  // Surface ring pulses.
  pulseSpeed: 4.4,
  pulseWidth: 0.45,
  pulseLife: 2.2,
  // Signals travelling the pathway graph.
  hopSeconds: 0.55,
  cascadeDepth: 2,
  // Anything quieter than this is dropped from the uniforms.
  settleEpsilon: 0.002,
});

/** Reduced motion: no overshoot and no whole-body wobble — the dent just eases out. */
export function motionConfig(reducedMotion, base = JELLY) {
  if (!reducedMotion) return base;
  return Object.freeze({ ...base, zeta: 1, omega: 9, squashGain: 0, pulseSpeed: base.pulseSpeed * 0.8 });
}

/**
 * Damped-spring displacement at `t` seconds after release from `a0`.
 * Under-damped for the jelly; critically damped when zeta >= 1.
 */
export function springAmplitude(a0, t, cfg = JELLY) {
  if (t <= 0) return a0;
  const { omega, zeta } = cfg;
  if (zeta >= 1) return a0 * (1 + omega * t) * Math.exp(-omega * t);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return a0 * Math.exp(-zeta * omega * t) * Math.cos(damped * t);
}

/** The upper envelope of the spring, used to decide when an impulse is spent. */
export function springEnvelope(a0, t, cfg = JELLY) {
  if (t <= 0) return Math.abs(a0);
  const { omega, zeta } = cfg;
  if (zeta >= 1) return Math.abs(a0) * (1 + omega * t) * Math.exp(-omega * t);
  return Math.abs(a0) * Math.exp(-zeta * omega * t);
}

export function squashAmount(squash, now, cfg = JELLY) {
  if (!squash) return 0;
  const t = now - squash.at;
  if (t < 0) return 0;
  return squash.amount * Math.exp(-cfg.squashDecay * t) * Math.sin(cfg.squashOmega * t + Math.PI / 2);
}

function normalize(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createJellyState() {
  return { impulses: [], pulses: [], hops: [], squash: null, fired: 0, nextId: 1 };
}

function pushCapped(list, item, cap) {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

/**
 * Add an impulse. `dir` is the direction a positive amplitude moves the
 * surface — callers pass the inward normal so a positive poke dents inward.
 */
export function addImpulse(state, { origin, dir, amplitude = JELLY.pokeAmplitude, radius = JELLY.pokeRadius, at, held = false }, cfg = JELLY) {
  const impulse = {
    id: state.nextId,
    origin: [...origin],
    dir: normalize(dir),
    amplitude,
    radius,
    at,
    held,
  };
  return {
    state: { ...state, impulses: pushCapped(state.impulses, impulse, cfg.maxImpulses), nextId: state.nextId + 1 },
    id: impulse.id,
  };
}

/** Drag a held impulse: positive `pixels` pushes in, negative pulls out. */
export function dragHeld(state, id, pixels, cfg = JELLY) {
  const amplitude = clamp(pixels * cfg.dragGain, -cfg.maxPull, cfg.maxPush);
  return {
    ...state,
    impulses: state.impulses.map((impulse) => (impulse.id === id && impulse.held ? { ...impulse, amplitude } : impulse)),
  };
}

/**
 * Drag a held impulse by a displacement vector in the shell's own space: the
 * grabbed handful follows the pointer, in whatever direction it moves. This is
 * the stretch — pull sideways and the surface goes sideways, not just in and
 * out along its normal.
 */
export function dragHeldVector(state, id, vector, cfg = JELLY) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return {
    ...state,
    impulses: state.impulses.map((impulse) => {
      if (impulse.id !== id || !impulse.held) return impulse;
      if (length < 1e-6) return { ...impulse, amplitude: 0 };
      return {
        ...impulse,
        dir: [vector[0] / length, vector[1] / length, vector[2] / length],
        amplitude: Math.min(length, cfg.maxPull),
      };
    }),
  };
}

/**
 * Let go. The impulse becomes a spring from wherever the drag left it, and the
 * whole body starts squashing along the same axis. A release with almost no
 * drag is treated as a tap and gets the default poke so a click always wobbles.
 */
export function releaseHeld(state, id, at, cfg = JELLY) {
  let released = null;
  const impulses = state.impulses.map((impulse) => {
    if (impulse.id !== id || !impulse.held) return impulse;
    const amplitude = Math.abs(impulse.amplitude) < 0.08 ? cfg.pokeAmplitude : impulse.amplitude;
    released = { ...impulse, amplitude, held: false, at };
    return released;
  });
  if (!released) return state;
  const amount = clamp(released.amplitude * cfg.squashGain, -cfg.squashMax, cfg.squashMax);
  return {
    ...state,
    impulses,
    squash: amount ? { axis: released.dir, amount, at } : state.squash,
  };
}

/** Current displacement of one impulse. */
export function impulseAmplitude(impulse, now, cfg = JELLY) {
  if (impulse.held) return impulse.amplitude;
  return springAmplitude(impulse.amplitude, now - impulse.at, cfg);
}

export function addPulse(state, origin, at, cfg = JELLY) {
  return { ...state, pulses: pushCapped(state.pulses, { origin: [...origin], at }, cfg.maxPulses) };
}

/** The region whose node is closest to a point — which part of the model a poke drives. */
export function nearestRegion(point, regions = BRAIN_REGIONS) {
  let best = null;
  let bestDistance = Infinity;
  for (const region of regions) {
    const [x, y, z] = region.position;
    const distance = Math.hypot(point[0] - x, point[1] - y, point[2] - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = region.code;
    }
  }
  return best;
}

/** Outgoing pathways from a region, in the graph's own order. */
export function outgoingPathways(regionCode, pathways = PATHWAYS) {
  return pathways.filter((pathway) => pathway.from === regionCode);
}

/**
 * Fire a region: one hop along each of its outgoing pathways. Each hop counts
 * as a signal fired.
 */
export function fireRegion(state, regionCode, at, depth = 0, cfg = JELLY) {
  if (!REGION_MAP[regionCode]) return state;
  const hops = outgoingPathways(regionCode).map((pathway) => ({
    pathwayId: pathway.id,
    from: pathway.from,
    to: pathway.to,
    inhibitory: Boolean(pathway.inhibitory),
    at,
    depth,
  }));
  return { ...state, hops: [...state.hops, ...hops], fired: state.fired + hops.length };
}

export function hopProgress(hop, now, cfg = JELLY) {
  return clamp((now - hop.at) / cfg.hopSeconds, 0, 1);
}

/**
 * Move every in-flight hop forward. A hop that arrives lights its target and,
 * unless the cascade is already at its depth limit or the pathway is
 * inhibitory, fires the target onward. Returns the arrivals so the caller can
 * drive the simulation and flash the nodes.
 */
export function advanceCascade(state, now, cfg = JELLY) {
  const arrivals = [];
  const inFlight = [];
  for (const hop of state.hops) {
    if (hopProgress(hop, now, cfg) >= 1) arrivals.push(hop);
    else inFlight.push(hop);
  }
  let next = { ...state, hops: inFlight };
  for (const hop of arrivals) {
    const arrivedAt = hop.at + cfg.hopSeconds;
    // Inhibitory routes quench rather than propagate — same sign the model uses.
    if (!hop.inhibitory && hop.depth + 1 <= cfg.cascadeDepth) {
      next = fireRegion(next, hop.to, arrivedAt, hop.depth + 1, cfg);
    }
    if (hop.depth === 0) {
      next = addPulse(next, surfacePointToward(REGION_MAP[hop.to].position), arrivedAt, cfg);
    }
  }
  return { state: next, arrivals };
}

/**
 * Drop everything that has settled so the uniform arrays stay short and the
 * state stays bounded no matter how long someone plays.
 */
export function pruneJelly(state, now, cfg = JELLY) {
  const impulses = state.impulses.filter((impulse) => impulse.held
    || springEnvelope(impulse.amplitude, now - impulse.at, cfg) > cfg.settleEpsilon);
  const pulses = state.pulses.filter((pulse) => now - pulse.at < cfg.pulseLife);
  const squash = state.squash && Math.abs(state.squash.amount) * Math.exp(-cfg.squashDecay * (now - state.squash.at)) > cfg.settleEpsilon
    ? state.squash
    : null;
  if (impulses.length === state.impulses.length && pulses.length === state.pulses.length && squash === state.squash) return state;
  return { ...state, impulses, pulses, squash };
}

/** True while anything is still moving — lets the scene idle when nothing is. */
export function isSettled(state) {
  return !state.impulses.length && !state.pulses.length && !state.hops.length && !state.squash;
}

/**
 * Write the shader uniforms in place. No allocation per frame.
 *   impulses[i] = (origin.xyz, amplitude)   dirs[i] = (dir.xyz, radius)
 *   pulses[i]   = (origin.xyz, age | -1)    squash  = (axis.xyz, amount)
 */
export function writeUniforms(state, now, target, cfg = JELLY) {
  const { impulses, dirs, pulses, squash } = target;
  for (let i = 0; i < cfg.maxImpulses; i += 1) {
    const impulse = state.impulses[i];
    const o = i * 4;
    if (impulse) {
      impulses[o] = impulse.origin[0];
      impulses[o + 1] = impulse.origin[1];
      impulses[o + 2] = impulse.origin[2];
      impulses[o + 3] = impulseAmplitude(impulse, now, cfg);
      dirs[o] = impulse.dir[0];
      dirs[o + 1] = impulse.dir[1];
      dirs[o + 2] = impulse.dir[2];
      dirs[o + 3] = impulse.radius;
    } else {
      impulses[o + 3] = 0;
      dirs[o + 3] = 0;
    }
  }
  for (let i = 0; i < cfg.maxPulses; i += 1) {
    const pulse = state.pulses[i];
    const o = i * 4;
    if (pulse) {
      pulses[o] = pulse.origin[0];
      pulses[o + 1] = pulse.origin[1];
      pulses[o + 2] = pulse.origin[2];
      pulses[o + 3] = Math.max(0, now - pulse.at);
    } else {
      pulses[o + 3] = -1;
    }
  }
  if (state.squash) {
    squash[0] = state.squash.axis[0];
    squash[1] = state.squash.axis[1];
    squash[2] = state.squash.axis[2];
    squash[3] = squashAmount(state.squash, now, cfg);
  } else {
    squash[3] = 0;
  }
  return target;
}

export function createUniformTarget(cfg = JELLY) {
  return {
    impulses: new Float32Array(cfg.maxImpulses * 4),
    dirs: new Float32Array(cfg.maxImpulses * 4),
    pulses: new Float32Array(cfg.maxPulses * 4).fill(-1),
    squash: new Float32Array(4),
  };
}

/**
 * Shake: a fixed, seeded burst of pokes over ~0.7 s. Seeded so a recorded
 * clip of a shake looks the same every time — the rest of this codebase is
 * deterministic and a toy should not be the exception.
 */
export function shakeSchedule(seed = 'shake', count = 6) {
  const rng = createRng(seed);
  const schedule = [];
  for (let index = 0; index < count; index += 1) {
    const theta = Math.acos(2 * rng() - 1);
    const phi = rng() * Math.PI * 2;
    schedule.push({
      delay: index * 0.11 + rng() * 0.04,
      direction: [Math.sin(theta) * Math.cos(phi), Math.cos(theta) * 0.8, Math.sin(theta) * Math.sin(phi)],
      amplitude: 0.45 + rng() * 0.45,
    });
  }
  return schedule;
}
