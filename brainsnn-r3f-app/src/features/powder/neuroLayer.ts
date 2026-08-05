// The brain layer: what makes this a Neuro Powder Lab rather than a sand toy.
//
// NEURO and INHIB cells are leaky integrate-and-fire units. SYNAPSE cells carry
// a spike one cell per tick, so transmission delay is proportional to how long
// you drew the wire. Synapses learn by STDP, and DOPAMINE accelerates that.
//
// TWO PARAMETER SETS, AND WHY
//
// `GAME_PARAMS` are tuned for feel. `REAL_PARAMS` are derived from
// BRUNEL_DEFAULTS in src/lib/snn/lifNetwork.js -- the same constants the
// spiking-network lab validates against Brunel (2000) -- so a circuit you draw
// runs on the model the research page publishes, not on numbers invented for a
// game. The exponential decay, the threshold and reset in mV, and the
// refractory period all come across unchanged.
//
// One thing is deliberately NOT reproduced, and it matters:
// Brunel's J = 0.1 mV is the postsynaptic potential of ONE input among roughly
// a thousand converging on a cell. A hand-drawn circuit has about three. Taken
// literally, a drawn neuron would need ~200 simultaneous inputs and would never
// fire. So the real-model path scales amplitude by REAL_PSP_GAIN and says so
// here rather than quietly shipping a model that cannot spike.
//
// DIRECTIONALITY WITHOUT STORING DIRECTION
//
// A spike travelling a wire must not run backwards into the cell that sent it.
// Rather than store a direction per synapse, this uses the Wireworld solution:
// a triggered synapse is a "head" for a few ticks, then a refractory "tail",
// and only a fully recovered synapse can be triggered again. A spike therefore
// travels outward and cannot reflect.
import { BRUNEL_DEFAULTS } from '../../lib/snn/lifNetwork.js';
import { Material } from './materials.ts';
import type { PowderEngine } from './powderEngine.ts';

export interface NeuroParams {
  id: 'game' | 'real';
  label: string;
  /** Membrane potential at which the unit fires. */
  threshold: number;
  /** Potential it drops to after firing. */
  reset: number;
  /** Multiplied into the potential every tick. */
  decay: number;
  /** Ticks a fired unit ignores input. */
  refractoryTicks: number;
  /** Postsynaptic potential of a spike arriving on a weight-1.0 synapse. */
  psp: number;
  /** Multiplier applied to that when the source is an inhibitory unit. */
  inhibitoryFactor: number;
  note: string;
}

/** Tuned for how it feels to draw, per the brief. */
export const GAME_PARAMS: NeuroParams = Object.freeze({
  id: 'game',
  label: 'Game feel',
  threshold: 0.8,
  reset: 0,
  decay: 0.98, // 0.02 leak per tick
  refractoryTicks: 10,
  psp: 1,
  inhibitoryFactor: -0.5,
  note: 'Arbitrary constants chosen to be responsive at the scale of a drawn circuit.',
});

/** One powder tick is treated as one millisecond in the real-model path. */
export const REAL_TICK_MS = 1;

/**
 * Brunel's J assumes ~1000 converging inputs; a drawn circuit has ~3. Without
 * this scaling a neuron would need roughly 200 simultaneous spikes to reach
 * threshold and nothing a player drew would ever fire.
 *
 * The gain is set so both parameter sets have the same *shape*: a fully learned
 * synapse (weight 1.0) fires its target from one spike, and a fresh one
 * (weight 0.1) needs a burst -- which is what makes temporal summation, and
 * then STDP, something you can watch happen. At threshold 20 mV from a 10 mV
 * reset, that needs a weight-1.0 PSP of at least 10 mV, hence 0.1 * 120.
 */
export const REAL_PSP_GAIN = 120;

export const REAL_PARAMS: NeuroParams = Object.freeze({
  id: 'real',
  label: 'Brunel (2000) model',
  threshold: BRUNEL_DEFAULTS.vThreshold,
  reset: BRUNEL_DEFAULTS.vReset,
  // Exact exponential, matching lifNetwork.js -- not a forward-Euler (1 - dt/tau).
  decay: Math.exp(-REAL_TICK_MS / BRUNEL_DEFAULTS.tauMs),
  refractoryTicks: Math.max(1, Math.round(BRUNEL_DEFAULTS.refractoryMs / REAL_TICK_MS)),
  psp: BRUNEL_DEFAULTS.J * REAL_PSP_GAIN,
  // g = 5, so inhibition is five times an excitatory PSP and negative.
  inhibitoryFactor: -BRUNEL_DEFAULTS.g,
  note: `Threshold ${BRUNEL_DEFAULTS.vThreshold} mV, reset ${BRUNEL_DEFAULTS.vReset} mV, `
    + `tau ${BRUNEL_DEFAULTS.tauMs} ms, refractory ${BRUNEL_DEFAULTS.refractoryMs} ms, g = ${BRUNEL_DEFAULTS.g}. `
    + `Amplitude scaled ${REAL_PSP_GAIN}x because a drawn circuit has ~3 inputs, not ~1000.`,
});

export const PARAM_SETS: readonly NeuroParams[] = Object.freeze([GAME_PARAMS, REAL_PARAMS]);

// --- Synapse timing ---------------------------------------------------------

/** Ticks a triggered synapse spends visibly spiking. */
export const SPIKE_TICKS = 3;
/** Ticks after that during which it cannot be retriggered. Stops reflection. */
export const SYNAPSE_REFRACTORY = 3;
const SYNAPSE_BUSY = SPIKE_TICKS + SYNAPSE_REFRACTORY;

export const MIN_WEIGHT = 0.1;
export const MAX_WEIGHT = 1;
/** Pre-before-post window, in ticks. */
export const STDP_WINDOW = 10;
export const STDP_GAIN = 0.05;
export const STDP_GAIN_DOPAMINE = 0.15;
/** Radius within which dopamine boosts learning. */
export const DOPAMINE_RADIUS = 5;
/** Weight decays once a synapse has been quiet this long. */
export const DECAY_AFTER_TICKS = 100;
export const WEIGHT_DECAY = 0.999;

/** Polarity of the spike a synapse is currently carrying, in its scratch field. */
const SCRATCH_NEGATIVE = 1;

export interface NeuroStats {
  neurons: number;
  synapses: number;
  /** Units that crossed threshold this tick. */
  fired: number;
  /** Synapses newly triggered this tick. */
  spikes: number;
  meanWeight: number;
  dopamineCells: number;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0, -1], [0, 1], [-1, 0], [1, 0],
]);

/**
 * One tick of the brain layer, run after the physics pass.
 *
 * Two-phase on purpose: spike decisions are computed from the current state
 * into `pending`, then applied. A single-phase pass would let a spike race the
 * whole length of a wire in one tick, which destroys the delay-by-length
 * property that makes drawing a long axon meaningful.
 */
export class NeuroLayer {
  private readonly pending: Uint8Array;
  private readonly pendingNegative: Uint8Array;
  /** Ticks since each synapse last spiked, for STDP and weight decay. */
  private readonly sinceSpike: Uint16Array;
  /** Set for a few ticks after a unit fires, so the renderer can flash it. */
  readonly firing: Uint8Array;
  /**
   * Cell indices of the units that crossed threshold this tick, valid for the
   * first `firedCount` entries. Written during the pass that already visits
   * them, so a statistics recorder does not need its own scan of the grid.
   */
  readonly firedCells: Int32Array;
  firedCount = 0;

  constructor(size: number) {
    this.pending = new Uint8Array(size);
    this.pendingNegative = new Uint8Array(size);
    this.sinceSpike = new Uint16Array(size);
    this.firing = new Uint8Array(size);
    this.firedCells = new Int32Array(size);
    this.sinceSpike.fill(0xffff);
  }

  reset(): void {
    this.pending.fill(0);
    this.pendingNegative.fill(0);
    this.firing.fill(0);
    this.sinceSpike.fill(0xffff);
    this.firedCount = 0;
  }

  step(engine: PowderEngine, params: NeuroParams): NeuroStats {
    const { width, height, cells, voltage, weight, timer } = engine;
    const pending = this.pending;
    const pendingNegative = this.pendingNegative;
    const sinceSpike = this.sinceSpike;
    const firing = this.firing;
    pending.fill(0);
    pendingNegative.fill(0);

    let neurons = 0;
    let synapses = 0;
    let fired = 0;
    let spikes = 0;
    let weightSum = 0;
    let dopamineCells = 0;
    this.firedCount = 0;

    // --- Phase 1: decide -----------------------------------------------------
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        const material = cells[at] & 0x1f;

        if (firing[at] > 0) firing[at] -= 1;

        if (material === Material.DOPAMINE) { dopamineCells += 1; continue; }

        if (material === Material.SYNAPSE) {
          synapses += 1;
          weightSum += weight[at];
          if (sinceSpike[at] < 0xffff) sinceSpike[at] += 1;

          if (timer[at] > 0) {
            timer[at] -= 1;
            // Only a head propagates; a tail is recovering.
            if (timer[at] >= SYNAPSE_REFRACTORY) {
              const negative = (engine.getScratch(at) & SCRATCH_NEGATIVE) !== 0;
              for (const [dx, dy] of NEIGHBOURS) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                const nAt = ny * width + nx;
                if ((cells[nAt] & 0x1f) !== Material.SYNAPSE) continue;
                if (timer[nAt] !== 0) continue; // still busy: cannot reflect
                pending[nAt] = 1;
                if (negative) pendingNegative[nAt] = 1;
              }
            }
          } else if (sinceSpike[at] > DECAY_AFTER_TICKS && weight[at] > MIN_WEIGHT) {
            // Unused connections fade. This is what makes a circuit you stop
            // using get weaker, and it is why dopamine is worth pouring.
            weight[at] = Math.max(MIN_WEIGHT, weight[at] * WEIGHT_DECAY);
          }
          continue;
        }

        if (material !== Material.NEURO && material !== Material.INHIB) continue;
        neurons += 1;

        if (timer[at] > 0) {
          timer[at] -= 1;
          voltage[at] = params.reset;
          continue;
        }

        voltage[at] *= params.decay;

        if (voltage[at] >= params.threshold) {
          this.firedCells[fired] = at;
          fired += 1;
          voltage[at] = params.reset;
          timer[at] = params.refractoryTicks;
          firing[at] = 3; // frames of white flash
          const negative = material === Material.INHIB;

          for (const [dx, dy] of NEIGHBOURS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const nAt = ny * width + nx;
            if ((cells[nAt] & 0x1f) !== Material.SYNAPSE) continue;

            // STDP: a synapse that fired shortly BEFORE this neuron did gets
            // credit for it. Pre-before-post, the standard causal window.
            if (sinceSpike[nAt] <= STDP_WINDOW) {
              const boosted = this.dopamineNear(engine, nx, ny);
              const gain = boosted ? STDP_GAIN_DOPAMINE : STDP_GAIN;
              weight[nAt] = Math.min(MAX_WEIGHT, weight[nAt] + gain);
            }

            if (timer[nAt] === 0) {
              pending[nAt] = 1;
              if (negative) pendingNegative[nAt] = 1;
            }
          }
        }
      }
    }

    // --- Phase 2: apply ------------------------------------------------------
    for (let at = 0; at < pending.length; at += 1) {
      if (pending[at] === 0) continue;
      spikes += 1;
      timer[at] = SYNAPSE_BUSY;
      sinceSpike[at] = 0;
      const negative = pendingNegative[at] === 1;
      engine.setScratch(at, negative ? SCRATCH_NEGATIVE : 0);

      // Deliver charge once, at the moment the synapse becomes a head.
      const amplitude = params.psp * weight[at] * (negative ? params.inhibitoryFactor : 1);
      const x = at % width;
      const y = (at / width) | 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nAt = ny * width + nx;
        const target = cells[nAt] & 0x1f;
        if (target !== Material.NEURO && target !== Material.INHIB) continue;
        if (timer[nAt] > 0) continue; // refractory neurons ignore input
        voltage[nAt] += amplitude;
      }
    }

    this.firedCount = fired;

    return {
      neurons,
      synapses,
      fired,
      spikes,
      meanWeight: synapses > 0 ? weightSum / synapses : 0,
      dopamineCells,
    };
  }

  /** Is there dopamine within DOPAMINE_RADIUS of this cell? */
  private dopamineNear(engine: PowderEngine, x: number, y: number): boolean {
    const r = DOPAMINE_RADIUS;
    for (let oy = -r; oy <= r; oy += 1) {
      for (let ox = -r; ox <= r; ox += 1) {
        if (ox * ox + oy * oy > r * r) continue;
        if (engine.getCell(x + ox, y + oy) === Material.DOPAMINE) return true;
      }
    }
    return false;
  }

  /** Ticks since a synapse last carried a spike; 0xffff means never. */
  quietFor(at: number): number {
    return this.sinceSpike[at];
  }

  isFiring(at: number): boolean {
    return this.firing[at] > 0;
  }
}
