import { Material } from './materials.ts';
import { DOPAMINE_RADIUS, type NeuroLayer } from './neuroLayer.ts';
import type { PowderEngine } from './powderEngine.ts';
import type { RegimeReadout } from './regime.ts';

export const LEARNED_WEIGHT = 0.25;
export const LONG_AXON_CELLS = 25;

export interface MissionContext {
  engine: PowderEngine;
  layer: NeuroLayer;
  regime: RegimeReadout;
  firedSinceLastCheck?: boolean;
}

export interface Mission {
  id: string;
  title: string;
  hint: string;
  why: string;
  check: (ctx: MissionContext) => boolean;
}

/**
 * Connected-component size of the largest SYNAPSE wire whose cells have all
 * carried at least one spike (`layer.quietFor(at) < 0xffff`).
 */
export function longestActiveAxon(engine: PowderEngine, layer: NeuroLayer): number {
  const { width, height, size, cells } = engine;
  const visited = new Uint8Array(size);
  const queue = new Int32Array(size);
  let best = 0;

  for (let start = 0; start < size; start += 1) {
    if (visited[start]) continue;
    if ((cells[start] & 0x1f) !== Material.SYNAPSE) continue;
    if (layer.quietFor(start) === 0xffff) continue;

    visited[start] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    let count = 0;

    while (head < tail) {
      const at = queue[head++];
      count += 1;
      const x = at % width;
      const y = (at / width) | 0;
      const neighbours = [
        [x, y - 1],
        [x, y + 1],
        [x - 1, y],
        [x + 1, y],
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nAt = ny * width + nx;
        if (visited[nAt]) continue;
        if ((cells[nAt] & 0x1f) !== Material.SYNAPSE) continue;
        if (layer.quietFor(nAt) === 0xffff) continue;
        visited[nAt] = 1;
        queue[tail++] = nAt;
      }
    }

    if (count > best) best = count;
  }

  return best;
}

function hasDopamineNear(engine: PowderEngine, x: number, y: number): boolean {
  const r = DOPAMINE_RADIUS;
  for (let oy = -r; oy <= r; oy += 1) {
    for (let ox = -r; ox <= r; ox += 1) {
      if (ox * ox + oy * oy > r * r) continue;
      if (engine.getCell(x + ox, y + oy) === Material.DOPAMINE) return true;
    }
  }
  return false;
}

export const MISSIONS: readonly Mission[] = Object.freeze([
  {
    id: 'first-spark',
    title: 'Spark a neuron',
    hint: 'Place a neuron and trigger a spike with Spark or Stimulate.',
    why: 'A leaky integrate-and-fire neuron integrates charge until it crosses threshold and emits a discrete spike.',
    check: ({ firedSinceLastCheck, layer }) => Boolean(firedSinceLastCheck || layer.firedCount > 0),
  },
  {
    id: 'long-axon',
    title: 'Run a long axon',
    hint: `Draw a continuous synapse wire of at least ${LONG_AXON_CELLS} cells and send a spike along it.`,
    why: 'Conduction delay grows linearly with wire length because spikes propagate at one cell per tick.',
    check: ({ engine, layer }) => longestActiveAxon(engine, layer) >= LONG_AXON_CELLS,
  },
  {
    id: 'learned',
    title: 'Teach a synapse',
    hint: 'Spark an upstream neuron, then spark the downstream neuron just as the wave arrives.',
    why: 'Pre-before-post timing strengthens the synapse via spike-timing-dependent plasticity (STDP).',
    check: ({ engine }) => {
      for (let at = 0; at < engine.size; at += 1) {
        if ((engine.cells[at] & 0x1f) === Material.SYNAPSE && engine.weight[at] >= LEARNED_WEIGHT) {
          return true;
        }
      }
      return false;
    },
  },
  {
    id: 'dopamine',
    title: 'Reinforce with dopamine',
    hint: 'Bathe a synapse in dopamine while training it past the learning threshold.',
    why: 'Neuromodulators gate and accelerate synaptic plasticity within their diffusion radius.',
    check: ({ engine }) => {
      const { width, size, cells, weight } = engine;
      for (let at = 0; at < size; at += 1) {
        if ((cells[at] & 0x1f) !== Material.SYNAPSE) continue;
        if (weight[at] < LEARNED_WEIGHT) continue;
        const x = at % width;
        const y = (at / width) | 0;
        if (hasDopamineNear(engine, x, y)) return true;
      }
      return false;
    },
  },
  {
    id: 'inhibit',
    title: 'Inhibit a target',
    hint: 'Drive an inhibitory neuron into a target so its membrane potential goes negative.',
    why: 'Inhibitory interneurons hyperpolarise postsynaptic targets and prevent runaway excitation.',
    check: ({ engine }) => {
      for (let at = 0; at < engine.size; at += 1) {
        const kind = engine.cells[at] & 0x1f;
        if ((kind === Material.NEURO || kind === Material.INHIB) && engine.voltage[at] < 0) {
          return true;
        }
      }
      return false;
    },
  },
  {
    id: 'regime-ai',
    title: 'Reach the AI regime',
    hint: 'Switch to the Brunel model and build an irregular balanced circuit of at least 8 neurons.',
    why: 'Asynchronous irregular (AI) firing balances excitation and inhibition without locking into a global rhythm.',
    check: ({ regime }) => regime.regime === 'AI',
  },
]);

export const MISSION_IDS: readonly string[] = Object.freeze(MISSIONS.map((m) => m.id));

const KNOWN_IDS = new Set<string>(MISSION_IDS);

export class MissionTracker {
  private readonly cadence: number;
  private tickCounter = 0;
  private latchedFire = false;
  private readonly done = new Set<string>();

  constructor(cadence = 15) {
    this.cadence = Math.max(1, cadence);
  }

  observe(ctx: MissionContext): Mission[] {
    if (ctx.firedSinceLastCheck || ctx.layer.firedCount > 0) {
      this.latchedFire = true;
    }
    this.tickCounter += 1;
    if (this.tickCounter < this.cadence) return [];
    this.tickCounter = 0;

    const checkCtx: MissionContext = {
      ...ctx,
      firedSinceLastCheck: this.latchedFire,
    };
    this.latchedFire = false;

    const newlyCompleted: Mission[] = [];
    for (const mission of MISSIONS) {
      if (this.done.has(mission.id)) continue;
      if (mission.check(checkCtx)) {
        this.done.add(mission.id);
        newlyCompleted.push(mission);
      }
    }
    return newlyCompleted;
  }

  isComplete(id: string): boolean {
    return this.done.has(id);
  }

  completed(): ReadonlySet<string> {
    return this.done;
  }

  get completedCount(): number {
    return this.done.size;
  }

  restore(ids: Iterable<string>): void {
    for (const id of ids) {
      if (KNOWN_IDS.has(id)) this.done.add(id);
    }
  }

  reset(): void {
    this.done.clear();
    this.tickCounter = 0;
    this.latchedFire = false;
  }
}
