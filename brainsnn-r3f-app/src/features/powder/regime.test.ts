import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS, REAL_PARAMS } from './neuroLayer.ts';
import { Material } from './materials.ts';
import { createRng } from '../../lib/rng.js';
import {
  MIN_NEURONS_TO_CLASSIFY,
  RegimeRecorder,
  WINDOW_TICKS,
  type SpikeSource,
} from './regime.ts';

/** Drives the recorder directly, so a statistic can be tested against a pattern
 *  it is known to produce rather than against whatever a circuit happens to do. */
class Fake implements SpikeSource {
  firedCells = new Int32Array(64);
  firedCount = 0;

  fire(cells: number[]) {
    cells.forEach((cell, i) => { this.firedCells[i] = cell; });
    this.firedCount = cells.length;
    return this;
  }
}

/** Runs one full window, calling `pattern(tick)` for the cells firing each tick. */
function runWindow(
  recorder: RegimeRecorder,
  params: typeof GAME_PARAMS,
  neurons: number,
  pattern: (tick: number) => number[],
) {
  const fake = new Fake();
  for (let tick = 0; tick < WINDOW_TICKS; tick += 1) {
    recorder.observe(fake.fire(pattern(tick)), params, neurons, 40);
  }
  return recorder.current();
}

const TWELVE = Array.from({ length: 12 }, (_, i) => i * 7);

describe('RegimeRecorder', () => {
  it('publishes nothing until a full window has been measured', () => {
    const recorder = new RegimeRecorder();
    const fake = new Fake();
    for (let tick = 0; tick < WINDOW_TICKS - 1; tick += 1) {
      recorder.observe(fake.fire([1]), REAL_PARAMS, 10, 20);
    }
    expect(recorder.current().ready).toBe(false);
    recorder.observe(fake.fire([1]), REAL_PARAMS, 10, 20);
    expect(recorder.current().ready).toBe(true);
  });

  it('starts a fresh window rather than accumulating forever', () => {
    const recorder = new RegimeRecorder();
    const busy = runWindow(recorder, REAL_PARAMS, 12, (t) => (t % 5 === 0 ? TWELVE : []));
    const quiet = runWindow(recorder, REAL_PARAMS, 12, () => []);
    expect(busy.spikes).toBeGreaterThan(0);
    expect(quiet.spikes).toBe(0);
  });

  // The honesty constraints. Each of these is a number the readout could
  // trivially print and would have no basis for.
  it('refuses a rate in hertz under game feel, where a tick has no duration', () => {
    const readout = runWindow(new RegimeRecorder(), GAME_PARAMS, 12, (t) => (t % 5 === 0 ? TWELVE : []));
    expect(readout.ready).toBe(true);
    expect(readout.rateHz).toBe(null);
    expect(readout.regime).toBe(null);
    expect(/no duration/.test(readout.reason)).toBe(true);
    // The dimensionless statistics are still real and still reported.
    expect(readout.cvIsi >= 0).toBe(true);
    expect(readout.spikes).toBeGreaterThan(0);
  });

  it('refuses a regime label for a circuit too small to carry one', () => {
    const four = [0, 7, 14, 21];
    const readout = runWindow(new RegimeRecorder(), REAL_PARAMS, 4, (t) => (t % 5 === 0 ? four : []));
    expect(readout.regime).toBe(null);
    expect(readout.rateHz !== null).toBe(true); // hertz is fine; the label is not
    expect(readout.reason.includes(String(MIN_NEURONS_TO_CLASSIFY))).toBe(true);
  });

  it('refuses a regime label before there are enough intervals to compute CV', () => {
    // Every unit fires once: a spike count, but no inter-spike interval.
    const readout = runWindow(new RegimeRecorder(), REAL_PARAMS, 12, (t) => (t === 0 ? TWELVE : []));
    expect(readout.regime).toBe(null);
    expect(/Not enough spikes/.test(readout.reason)).toBe(true);
  });

  // The statistics themselves, against patterns whose regime is known by
  // construction. These are what make the readout a measurement.
  it('calls a clock-like population locked together synchronous regular', () => {
    // Every unit fires on the same tick, every 10 ticks: zero interval
    // variance, maximal population variance.
    const readout = runWindow(new RegimeRecorder(), REAL_PARAMS, 12, (t) => (t % 10 === 0 ? TWELVE : []));
    expect(readout.cvIsi).toBeLessThan(0.1);
    expect(readout.regime).toBe('SR');
  });

  it('calls independent Poisson units asynchronous irregular', () => {
    // Exponentially distributed intervals give CV ~ 1 by construction, and
    // independent phases keep the population rate flat. This is the regime the
    // research page cares about, so it is the one worth pinning.
    const rng = createRng('poisson');
    const MEAN_GAP = 12;
    const next = TWELVE.map(() => Math.floor(rng() * MEAN_GAP));
    const readout = runWindow(new RegimeRecorder(), REAL_PARAMS, 12, (tick) => {
      const firing: number[] = [];
      for (let i = 0; i < TWELVE.length; i += 1) {
        if (tick < next[i]) continue;
        firing.push(TWELVE[i]);
        next[i] = tick + 1 + Math.floor(-MEAN_GAP * Math.log(1 - rng()));
      }
      return firing;
    });
    expect(readout.cvIsi).toBeGreaterThan(0.5);
    expect(readout.synchrony).toBeLessThan(0.02);
    expect(readout.regime).toBe('AI');
  });

  it('calls a window with no spikes at all silent', () => {
    // classifyRegime's own rateHz < 0.5 branch cannot be reached from here: a
    // 300-tick window is 300 ms of model time, so even one spike per unit reads
    // as 3.3 Hz. Silence is reported from the spike count instead.
    const readout = runWindow(new RegimeRecorder(), REAL_PARAMS, 12, () => []);
    expect(readout.regime).toBe('silent');
    expect(readout.rateHz).toBe(0);
  });

  it('clears everything on reset', () => {
    const recorder = new RegimeRecorder();
    runWindow(recorder, REAL_PARAMS, 12, (t) => (t % 5 === 0 ? TWELVE : []));
    expect(recorder.current().ready).toBe(true);
    recorder.reset();
    expect(recorder.current().ready).toBe(false);
    expect(recorder.current().spikes).toBe(0);
  });
});

describe('RegimeRecorder against a real circuit', () => {
  // The recorder reads NeuroLayer.firedCells directly, so the wiring has to be
  // proven against the layer rather than only against the fake.
  it('records the spikes a drawn circuit actually produces', () => {
    const engine = new PowderEngine({ width: 64, height: 32, seed: 'regime' });
    const layer = new NeuroLayer(engine.size);
    const recorder = new RegimeRecorder();

    const neurons: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const x = 4 + i * 4;
      engine.setCell(x, 10, Material.NEURO);
      neurons.push(engine.index(x, 10));
    }

    for (let tick = 0; tick < WINDOW_TICKS; tick += 1) {
      // Re-charge on a fixed period; the refractory clock does the rest.
      if (tick % 12 === 0) for (const at of neurons) engine.voltage[at] = REAL_PARAMS.threshold * 2;
      const stats = layer.step(engine, REAL_PARAMS);
      recorder.observe(layer, REAL_PARAMS, stats.neurons, stats.synapses);
    }

    const readout = recorder.current();
    expect(readout.ready).toBe(true);
    expect(readout.neurons).toBe(12);
    expect(readout.spikes).toBeGreaterThan(20);
    expect(readout.regime !== null).toBe(true);
  });

  it('reports the fired cells from the layer, not a separate scan of the grid', () => {
    const engine = new PowderEngine({ width: 16, height: 16, seed: 'fired' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(3, 3, Material.NEURO);
    engine.setCell(9, 9, Material.NEURO);
    engine.voltage[engine.index(3, 3)] = GAME_PARAMS.threshold * 2;

    layer.step(engine, GAME_PARAMS);
    expect(layer.firedCount).toBe(1);
    expect(layer.firedCells[0]).toBe(engine.index(3, 3));

    layer.step(engine, GAME_PARAMS);
    expect(layer.firedCount).toBe(0);
  });
});
