// Objectives for the sandbox.
//
// The site's stated loop is Play, then Understand, then Publish. The lab was
// stopping at "play": it measured whatever you drew but never gave you a reason
// to draw anything in particular. These are the reasons — ordered so that
// following them teaches the model rather than the interface.
//
// EVERY OBJECTIVE IS VERIFIED FROM ENGINE STATE
//
// Nothing here is awarded for clicking a button, visiting a panel, or being
// told the goal was met. Each `check` reads the grid, the brain layer, or the
// measured regime, so an objective can only be completed by actually building
// the thing. That also means each one is testable, and each one is tested.
//
// Wording and checker are kept deliberately identical in scope. Where a check
// is looser than the ideal phrasing, the phrasing is loosened to match rather
// than the other way round — an objective that claims more than it verifies is
// the same dishonesty as a readout that reports more than it measures.
import { Material } from './materials.ts';
import { MAX_WEIGHT, type NeuroLayer } from './neuroLayer.ts';
import type { PowderEngine } from './powderEngine.ts';
import type { RegimeReadout } from './regime.ts';

/** Weight at which a synapse counts as learned. Below MAX so it is reachable. */
export const LEARNED_WEIGHT = 0.8;
/** Cells in a connected synapse run before it counts as a long axon. */
export const LONG_AXON_CELLS = 25;
/** A synapse counts as "recently active" within this many ticks. */
export const RECENT_TICKS = 90;

export interface MissionContext {
  engine: PowderEngine;
  layer: NeuroLayer;
  regime: RegimeReadout;
  /**
   * Whether any unit fired since the last check ran.
   *
   * A firing lasts one tick and checks run on a cadence, so a state-only check
   * would miss almost every spike. The tracker latches this every tick and
   * clears it when the checks run. The other objectives all read state that
   * persists — a weight, a negative voltage decaying toward zero, a recently
   * active axon — so this is the only one that needs latching.
   */
  firedSinceLastCheck: boolean;
}

export interface Mission {
  id: string;
  title: string;
  /** How to do it. */
  hint: string;
  /** What it teaches — the reason the objective exists at all. */
  why: string;
  check(context: MissionContext): boolean;
}

/** Is any cell of this material adjacent to `at`, within `radius`? */
function anyWithin(engine: PowderEngine, at: number, material: Material, radius: number): boolean {
  const x = at % engine.width;
  const y = (at / engine.width) | 0;
  for (let oy = -radius; oy <= radius; oy += 1) {
    for (let ox = -radius; ox <= radius; ox += 1) {
      if (ox * ox + oy * oy > radius * radius) continue;
      if (engine.getCell(x + ox, y + oy) === material) return true;
    }
  }
  return false;
}

/**
 * Size of the largest connected run of SYNAPSE cells that has carried a spike
 * recently, by flood fill over 4-connectivity — the same neighbourhood the
 * brain layer propagates through, so "connected" here means what it means to
 * the simulation.
 */
export function longestActiveAxon(engine: PowderEngine, layer: NeuroLayer): number {
  const seen = new Uint8Array(engine.size);
  const stack: number[] = [];
  let best = 0;

  for (let start = 0; start < engine.size; start += 1) {
    if (seen[start]) continue;
    if ((engine.cells[start] & 0x1f) !== Material.SYNAPSE) continue;

    seen[start] = 1;
    stack.length = 0;
    stack.push(start);
    let size = 0;
    let active = false;

    while (stack.length > 0) {
      const at = stack.pop()!;
      size += 1;
      if (layer.quietFor(at) <= RECENT_TICKS) active = true;

      const x = at % engine.width;
      const y = (at / engine.width) | 0;
      // 4-connectivity, matching NEIGHBOURS in neuroLayer.
      if (x > 0) pushIfSynapse(at - 1);
      if (x < engine.width - 1) pushIfSynapse(at + 1);
      if (y > 0) pushIfSynapse(at - engine.width);
      if (y < engine.height - 1) pushIfSynapse(at + engine.width);
    }

    if (active && size > best) best = size;
  }

  return best;

  function pushIfSynapse(next: number) {
    if (seen[next]) return;
    if ((engine.cells[next] & 0x1f) !== Material.SYNAPSE) return;
    seen[next] = 1;
    stack.push(next);
  }
}

export const MISSIONS: readonly Mission[] = Object.freeze([
  {
    id: 'first-spark',
    title: 'Make something fire',
    hint: 'Draw a neuron, then press Stimulate all — or use Spark and click it.',
    why: 'A neuron is a leaky integrator: it holds charge, leaks it away, and fires only when the total crosses threshold.',
    check: ({ firedSinceLastCheck }) => firedSinceLastCheck,
  },
  {
    id: 'long-axon',
    title: 'Run a spike down a long wire',
    hint: `Draw a synapse run of at least ${LONG_AXON_CELLS} cells from a neuron, then stimulate it.`,
    why: 'A synapse conducts one cell per tick, so delay is proportional to length. Long axons really are slow.',
    check: ({ engine, layer }) => longestActiveAxon(engine, layer) >= LONG_AXON_CELLS,
  },
  {
    id: 'learned',
    title: 'Teach a synapse',
    // Measured: with the global Stimulate both ends fire on the same tick, so
    // the synapse never spikes *before* the neuron and nothing ever learns.
    // Spark is the affordance that makes the causal window reachable.
    hint: `Spark the upstream neuron, then spark the downstream one a moment later, until a synapse passes weight ${LEARNED_WEIGHT}. Too early and nothing happens — that is the causal window.`,
    why: 'A synapse that fires shortly before its target gains weight. That is spike-timing-dependent plasticity, and it is the whole of the learning here.',
    check: ({ engine }) => anySynapse(engine, (weight) => weight >= LEARNED_WEIGHT),
  },
  {
    id: 'dopamine',
    title: 'Learn faster with dopamine',
    hint: 'Pour dopamine over a circuit that is still learning, then keep sparking it in order.',
    // Phrased to match exactly what is checked: a learned synapse with dopamine
    // in range. The checker cannot prove the dopamine caused it.
    why: 'Learning runs three times faster inside a dopamine field, which is why a reward signal is worth having at all.',
    check: ({ engine }) => anySynapse(
      engine,
      (weight, at) => weight >= LEARNED_WEIGHT && anyWithin(engine, at, Material.DOPAMINE, 5),
    ),
  },
  {
    id: 'inhibit',
    title: 'Push a neuron below zero',
    hint: 'Wire an inhibitory neuron into another neuron and fire it.',
    why: 'Inhibition is not the absence of a signal — it is a negative one, five times the size of an excitatory input.',
    check: ({ engine }) => {
      for (let at = 0; at < engine.size; at += 1) {
        const kind = engine.cells[at] & 0x1f;
        if (kind !== Material.NEURO && kind !== Material.INHIB) continue;
        if (engine.voltage[at] < 0) return true;
      }
      return false;
    },
  },
  {
    id: 'regime-ai',
    title: 'Reach the asynchronous irregular regime',
    hint: 'Switch to the Brunel model, draw at least 8 neurons, and get them firing irregularly and out of step.',
    why: 'This is the regime cortex is thought to sit in, and the one the research page measures. Reaching it is the point of the whole lab.',
    check: ({ regime }) => regime.regime === 'AI',
  },
]);

function anySynapse(engine: PowderEngine, predicate: (weight: number, at: number) => boolean): boolean {
  for (let at = 0; at < engine.size; at += 1) {
    if ((engine.cells[at] & 0x1f) !== Material.SYNAPSE) continue;
    if (predicate(Math.min(MAX_WEIGHT, engine.weight[at]), at)) return true;
  }
  return false;
}

export const MISSION_IDS: readonly string[] = Object.freeze(MISSIONS.map((m) => m.id));

/**
 * Tracks which objectives have been completed.
 *
 * Checks run on a cadence rather than every tick: the flood fill is the only
 * expensive one, and an objective that takes a third of a second to register is
 * indistinguishable from instant. Completions are sticky — clearing the grid
 * does not un-teach you what a long axon is.
 */
export class MissionTracker {
  private readonly done = new Set<string>();
  private sinceCheck = 0;
  private firedSinceCheck = false;
  readonly everyTicks: number;

  constructor(everyTicks = 20) {
    this.everyTicks = everyTicks;
  }

  completed(): ReadonlySet<string> {
    return this.done;
  }

  isComplete(id: string): boolean {
    return this.done.has(id);
  }

  get completedCount(): number {
    return this.done.size;
  }

  /** Restores progress, ignoring ids this build does not know. */
  restore(ids: Iterable<string>): void {
    for (const id of ids) if (MISSION_IDS.includes(id)) this.done.add(id);
  }

  reset(): void {
    this.done.clear();
    this.sinceCheck = 0;
    this.firedSinceCheck = false;
  }

  /**
   * Call once per tick, after the brain layer has stepped. Returns the missions
   * newly completed on this call, so the page can announce them without
   * diffing sets itself.
   */
  observe(context: Omit<MissionContext, 'firedSinceLastCheck'>): Mission[] {
    if (context.layer.firedCount > 0) this.firedSinceCheck = true;

    this.sinceCheck += 1;
    if (this.sinceCheck < this.everyTicks) return [];
    this.sinceCheck = 0;

    const full: MissionContext = { ...context, firedSinceLastCheck: this.firedSinceCheck };
    this.firedSinceCheck = false;

    const newly: Mission[] = [];
    for (const mission of MISSIONS) {
      if (this.done.has(mission.id)) continue;
      if (!mission.check(full)) continue;
      this.done.add(mission.id);
      newly.push(mission);
    }
    return newly;
  }
}
