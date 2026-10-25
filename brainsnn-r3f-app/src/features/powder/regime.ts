// Measuring a hand-drawn circuit with the site's own instruments.
//
// This is the point of the lab rather than a decoration on it. `snnMetrics.js`
// is the module the research page uses to characterise the validated Brunel
// network: CV of inter-spike intervals, population Fano factor, synchrony,
// and Brunel's four-way regime label. Nothing here reimplements any of that —
// the recorder's only job is to accumulate spike statistics in the exact shape
// those functions already read, so a circuit you drew goes through the same
// code path as the published simulation.
//
// WHAT THIS DELIBERATELY REFUSES TO REPORT
//
// A firing *rate* needs a tick to have a duration. Under the real model one
// tick is REAL_TICK_MS, so hertz means something. Under "game feel" a tick is
// a rendered frame and the constants were picked for how drawing feels, so a
// number in hertz would be invented. The readout says so instead of printing
// one, and the regime label — whose thresholds are calibrated against Brunel's
// analysis — is withheld along with it.
//
// It also refuses to classify a circuit too small to carry the statistic.
// Brunel's regimes describe a population; four neurons in a ring have a CV of
// ISI, but calling it "asynchronous irregular" would be dressing an anecdote in
// a result.
import { classifyRegime, summarizeRun } from '../../lib/snn/snnMetrics.js';
import { REAL_TICK_MS, type NeuroParams } from './neuroLayer.ts';

/** Structural, so a test can drive the recorder without building a circuit. `NeuroLayer` satisfies it. */
export interface SpikeSource {
  readonly firedCells: ArrayLike<number>;
  readonly firedCount: number;
}

/** Ticks per measurement window. At 60 fps this is a fresh readout every ~5 s. */
export const WINDOW_TICKS = 300;
/** Below this the label would describe an anecdote, not a population. */
export const MIN_NEURONS_TO_CLASSIFY = 8;
/** meanCvIsi needs at least 3 intervals per unit; this many units must clear it. */
export const MIN_UNITS_WITH_INTERVALS = 4;

export interface RegimeReadout {
  /** True once a full window has been measured. */
  ready: boolean;
  /** Why there is no label, when there is none. */
  reason: string;
  cvIsi: number;
  fano: number;
  synchrony: number;
  /** Only meaningful under the real model; null under game feel. */
  rateHz: number | null;
  /** Brunel's four-way label, or null when it would not be honest to give one. */
  regime: 'AI' | 'SI' | 'SR' | 'AR' | 'silent' | null;
  neurons: number;
  spikes: number;
  windowTicks: number;
}

export const REGIME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  AI: 'Asynchronous irregular — the cortex-like regime',
  SI: 'Synchronous irregular — bursting together, irregularly',
  SR: 'Synchronous regular — locked into a common rhythm',
  AR: 'Asynchronous regular — each unit clock-like, independently',
  silent: 'Silent — nothing fired during the measurement window',
});

const EMPTY: RegimeReadout = Object.freeze({
  ready: false,
  reason: 'Measuring…',
  cvIsi: 0,
  fano: 0,
  synchrony: 0,
  rateHz: null,
  regime: null,
  neurons: 0,
  spikes: 0,
  windowTicks: WINDOW_TICKS,
});

interface UnitRecord {
  spikes: number;
  lastTick: number;
  isiSum: number;
  isiSumSquares: number;
  isiCount: number;
}

/**
 * Accumulates one tumbling window of spike statistics, then publishes a
 * readout and starts the next window.
 *
 * A tumbling window rather than a rolling one because the interval
 * accumulators are sums: a rolling window would need every interval retained to
 * subtract expiring ones, and a completed window is what a measurement is
 * anyway.
 */
export class RegimeRecorder {
  private units = new Map<number, UnitRecord>();
  private populationRate: Float64Array;
  private tick = 0;
  private readout: RegimeReadout = EMPTY;
  /** Written out longhand: Node's type stripping erases types but cannot
   *  transform a constructor parameter property into a field. */
  readonly windowTicks: number;

  constructor(windowTicks: number = WINDOW_TICKS) {
    this.windowTicks = windowTicks;
    this.populationRate = new Float64Array(windowTicks);
  }

  reset(): void {
    this.units.clear();
    this.populationRate.fill(0);
    this.tick = 0;
    this.readout = EMPTY;
  }

  current(): RegimeReadout {
    return this.readout;
  }

  /** Call once per tick, immediately after `layer.step(...)`. */
  observe(layer: SpikeSource, params: NeuroParams, neurons: number, synapses: number): void {
    const fired = layer.firedCount;
    this.populationRate[this.tick] = fired;

    for (let i = 0; i < fired; i += 1) {
      const at = layer.firedCells[i];
      let unit = this.units.get(at);
      if (!unit) {
        unit = { spikes: 0, lastTick: -1, isiSum: 0, isiSumSquares: 0, isiCount: 0 };
        this.units.set(at, unit);
      }
      if (unit.lastTick >= 0) {
        const interval = this.tick - unit.lastTick;
        unit.isiSum += interval;
        unit.isiSumSquares += interval * interval;
        unit.isiCount += 1;
      }
      unit.lastTick = this.tick;
      unit.spikes += 1;
    }

    this.tick += 1;
    if (this.tick >= this.windowTicks) {
      this.readout = this.summarise(params, neurons, synapses);
      this.units.clear();
      this.populationRate.fill(0);
      this.tick = 0;
    }
  }

  private summarise(params: NeuroParams, neurons: number, synapses: number): RegimeReadout {
    // A unit that never fired still counts toward the population, so the run is
    // built over every neuron on the grid rather than only the active ones.
    const active = [...this.units.values()];
    const silent = Math.max(0, neurons - active.length);
    const count = active.length + silent;

    const spikeCounts = new Float64Array(count);
    const isiSum = new Float64Array(count);
    const isiSumSquares = new Float64Array(count);
    const isiCount = new Float64Array(count);
    active.forEach((unit, i) => {
      spikeCounts[i] = unit.spikes;
      isiSum[i] = unit.isiSum;
      isiSumSquares[i] = unit.isiSumSquares;
      isiCount[i] = unit.isiCount;
    });

    // Intervals are counted in ticks; scaling them to milliseconds would cancel
    // out of CV anyway, so the run is built in the model's own time unit.
    const dtMs = params.id === 'real' ? REAL_TICK_MS : 1;
    const run = {
      spikeCounts,
      isiSum,
      isiSumSquares,
      isiCount,
      populationRate: this.populationRate.slice(),
      steps: this.windowTicks,
      synapseCount: synapses,
      config: { dtMs },
    };

    const summary = summarizeRun(run);
    let totalSpikes = 0;
    for (const unit of active) totalSpikes += unit.spikes;
    const unitsWithIntervals = active.filter((unit) => unit.isiCount >= 3).length;

    const base = {
      ready: true,
      cvIsi: summary.cvIsi,
      fano: summary.fano,
      synchrony: summary.synchrony,
      neurons: count,
      spikes: totalSpikes,
      windowTicks: this.windowTicks,
    };

    if (params.id !== 'real') {
      return {
        ...base,
        rateHz: null,
        regime: null,
        reason: 'A game-feel tick has no duration, so there is no rate in hertz '
          + 'and no calibrated regime. Switch to the Brunel model for those.',
      };
    }
    // Reported before the interval guard below, because "nothing fired" is a
    // real state with a real label, and it would otherwise be reported as a
    // shortage of data. Note that classifyRegime's own `rateHz < 0.5` silent
    // branch is unreachable here: a 300-tick window is 300 ms of model time, so
    // even one spike per unit reads as 3.3 Hz.
    if (totalSpikes === 0) {
      return {
        ...base,
        rateHz: 0,
        regime: 'silent',
        reason: REGIME_LABELS.silent,
      };
    }
    if (count < MIN_NEURONS_TO_CLASSIFY) {
      return {
        ...base,
        rateHz: summary.rateHz,
        regime: null,
        reason: `Draw at least ${MIN_NEURONS_TO_CLASSIFY} neurons. Below that the `
          + 'label would describe an anecdote rather than a population.',
      };
    }
    if (unitsWithIntervals < MIN_UNITS_WITH_INTERVALS) {
      return {
        ...base,
        rateHz: summary.rateHz,
        regime: null,
        reason: 'Not enough spikes yet — CV of ISI needs several intervals per unit.',
      };
    }

    const regime = classifyRegime(summary) as RegimeReadout['regime'];
    return { ...base, rateHz: summary.rateHz, regime, reason: REGIME_LABELS[regime ?? ''] ?? '' };
  }
}
