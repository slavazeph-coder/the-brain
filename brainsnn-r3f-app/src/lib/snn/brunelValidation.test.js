import { describe, expect, it } from '../../test/tinyVitest.js';
import { createNetworkConfig, simulateLif } from './lifNetwork.js';
import { classifyRegime, summarizeRun } from './snnMetrics.js';

// Small enough to keep the suite fast (~150 ms per run), large enough that the
// in-degree is in the regime the theory describes.
const TEST_NETWORK = { N: 800, epsilon: 0.25, durationMs: 250 };

function run(overrides, seed = 'validate') {
  return summarizeRun(simulateLif({ config: { ...TEST_NETWORK, ...overrides }, seed }));
}

describe('network configuration', () => {
  it('splits neurons by Dale\'s law and derives the threshold rate', () => {
    const config = createNetworkConfig({ N: 1000 });
    expect(config.nExcitatory).toBe(800);
    expect(config.nInhibitory).toBe(200);
    // nu_thr = theta / (J * C_E * tau)  [Brunel 2000 eq. 6]
    const expected = config.vThreshold / (config.J * config.cExcitatory * (config.tauMs / 1000));
    expect(Math.abs(config.nuThresholdHz - expected)).toBeLessThan(1e-9);
  });

  it('scales external drive with eta', () => {
    const base = createNetworkConfig({ eta: 1 });
    const doubled = createNetworkConfig({ eta: 2 });
    expect(Math.abs(doubled.nuExternalHz - 2 * base.nuExternalHz)).toBeLessThan(1e-9);
  });
});

describe('determinism', () => {
  it('reproduces a run exactly from the same seed', () => {
    expect(JSON.stringify(run({ g: 5, eta: 2 }, 'same'))).toBe(JSON.stringify(run({ g: 5, eta: 2 }, 'same')));
  });

  it('produces a different run from a different seed', () => {
    expect(JSON.stringify(run({ g: 5, eta: 2 }, 'a')) === JSON.stringify(run({ g: 5, eta: 2 }, 'b'))).toBe(false);
  });
});

// The claims below are the robust, well-established consequences of the Brunel
// model. They are checkable by anyone against the published analysis, which is
// the point: the simulation is falsifiable rather than merely plausible.
describe('Brunel regime behaviour', () => {
  it('is silent when external drive is below the threshold rate', () => {
    // eta < 1 means the mean external input alone cannot reach threshold.
    expect(run({ g: 5, eta: 0.7 }).rateHz).toBe(0);
    expect(classifyRegime(run({ g: 5, eta: 0.7 }))).toBe('silent');
  });

  it('fires once external drive crosses the threshold rate', () => {
    expect(run({ g: 5, eta: 1.5 }).rateHz).toBeGreaterThan(1);
  });

  it('increases firing rate monotonically with external drive', () => {
    const rates = [1.5, 2, 3].map((eta) => run({ g: 5, eta }).rateHz);
    expect(rates[1]).toBeGreaterThan(rates[0]);
    expect(rates[2]).toBeGreaterThan(rates[1]);
  });

  it('suppresses firing rate monotonically as inhibition strengthens', () => {
    const rates = [2.5, 5, 8].map((g) => run({ g, eta: 2 }).rateHz);
    expect(rates[0]).toBeGreaterThan(rates[1]);
    expect(rates[1]).toBeGreaterThan(rates[2]);
  });

  it('fires more irregularly as inhibition strengthens', () => {
    // The central Brunel result: inhibition-dominated networks are
    // fluctuation-driven, so inter-spike intervals become irregular.
    const cvs = [2.5, 5, 8].map((g) => run({ g, eta: 2 }).cvIsi);
    expect(cvs[0]).toBeLessThan(cvs[1]);
    expect(cvs[1]).toBeLessThan(cvs[2]);
  });

  it('fires almost clock-regularly when excitation dominates', () => {
    // g < 4 leaves the network excitation-dominated and strongly mean-driven.
    const excitatory = run({ g: 2.5, eta: 2 });
    expect(excitatory.cvIsi).toBeLessThan(0.15);
    expect(excitatory.rateHz).toBeGreaterThan(80);
    expect(classifyRegime(excitatory)).toBe('SR');
  });

  it('never exceeds the rate ceiling set by the refractory period', () => {
    const ceiling = 1000 / createNetworkConfig(TEST_NETWORK).refractoryMs;
    for (const g of [2.5, 5, 8]) expect(run({ g, eta: 2 }).rateHz).toBeLessThanOrEqual(ceiling);
  });
});

describe('summary shape', () => {
  it('reports the measured quantities a spiking network should expose', () => {
    const summary = run({ g: 5, eta: 2 });
    expect(summary.neurons).toBe(TEST_NETWORK.N);
    expect(summary.synapses).toBeGreaterThan(0);
    expect(summary.cvIsi).toBeGreaterThanOrEqual(0);
    expect(summary.fano).toBeGreaterThanOrEqual(0);
    expect(summary.peakHz).toBeGreaterThanOrEqual(0);
    for (const band of ['delta', 'theta', 'alpha', 'beta', 'gamma']) {
      expect(Number.isFinite(summary.bands[band])).toBe(true);
    }
  });

  it('collects a raster for visualization', () => {
    const network = simulateLif({ config: { ...TEST_NETWORK, g: 5, eta: 2 }, seed: 'raster', rasterNeurons: 20 });
    expect(network.rasterCount).toBe(20);
    expect(network.raster.length).toBeGreaterThan(0);
    for (const [neuron, timeMs] of network.raster.slice(0, 50)) {
      expect(neuron).toBeLessThan(20);
      expect(timeMs).toBeLessThanOrEqual(TEST_NETWORK.durationMs);
    }
  });
});

// KNOWN LIMITATION, stated rather than overclaimed.
//
// Brunel's asynchronous-irregular regime needs very large sparse networks
// (N ~ 10^4-10^5 with epsilon ~ 0.1) for presynaptic inputs to be effectively
// independent. At the sizes that fit in a browser the network reaches high
// irregularity but retains more population synchrony than the true AI state,
// so we assert the monotonic trends above rather than claiming to reproduce
// all four published regimes.
describe('documented limits', () => {
  it('retains measurable population synchrony at browser-affordable sizes', () => {
    expect(run({ g: 8, eta: 2 }).synchrony).toBeGreaterThan(0);
  });
});
