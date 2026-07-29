import { describe, expect, it } from '../../test/tinyVitest.js';
import { runBrainTrial } from './brainModel.js';
import { computeBrainMetrics, CONTROL_LOOP, METRIC_DESCRIPTORS } from './brainMetrics.js';

const PRESSURE_TARGETS = { THL: 0.8, CTX: 0.4, HPC: 0.3, PFC: 0.2, AMY: 0.85, BG: 0.8, CBL: 0.3 };
const CALM_TARGETS = { THL: 0.45, CTX: 0.6, HPC: 0.5, PFC: 0.8, AMY: 0.15, BG: 0.2, CBL: 0.4 };

function metricsFor(options) {
  return computeBrainMetrics(runBrainTrial({ seed: 'metrics', ticks: 180, ...options }));
}

describe('computeBrainMetrics', () => {
  it('returns null for an empty trial', () => {
    expect(computeBrainMetrics(null)).toBe(null);
    expect(computeBrainMetrics({ trace: [], finalState: null })).toBe(null);
  });

  it('is deterministic for a given seed', () => {
    const a = metricsFor({ targets: PRESSURE_TARGETS });
    const b = metricsFor({ targets: PRESSURE_TARGETS });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reports firing rates in Hz consistent with the tick rate', () => {
    const metrics = metricsFor({ targets: PRESSURE_TARGETS });
    expect(metrics.seconds).toBeGreaterThan(0);
    for (const rate of Object.values(metrics.firingRateHz)) {
      expect(rate).toBeGreaterThanOrEqual(0);
      // Ceiling is the tick rate itself: at most one spike per 120 ms tick.
      expect(rate).toBeLessThanOrEqual(1000 / 120);
    }
  });

  it('separates high-pressure content from calm content', () => {
    const pressure = metricsFor({ targets: PRESSURE_TARGETS });
    const calm = metricsFor({ targets: CALM_TARGETS });
    expect(pressure.hijackIndex).toBeGreaterThan(calm.hijackIndex);
    expect(calm.controlRatio).toBeGreaterThan(pressure.controlRatio);
  });

  it('drops the hijack index when the threat region is lesioned', () => {
    const intact = metricsFor({ targets: PRESSURE_TARGETS });
    const lesioned = metricsFor({
      targets: PRESSURE_TARGETS,
      interventions: { lesions: ['AMY'], cuts: [], stimuli: {} },
    });
    expect(lesioned.hijackIndex).toBeLessThan(intact.hijackIndex);
  });

  it('loses the inhibitory brake when the gate pathway is cut', () => {
    const cut = metricsFor({
      targets: PRESSURE_TARGETS,
      interventions: { lesions: [], cuts: ['BG-THL'], stimuli: {} },
    });
    // With BG-THL cut, THL receives no inhibition at all.
    expect(cut.eiBalance.THL).toBe(0);
  });

  it('keeps bounded metrics inside their ranges', () => {
    const metrics = metricsFor({ targets: PRESSURE_TARGETS });
    expect(metrics.hijackIndex).toBeGreaterThanOrEqual(0);
    expect(metrics.hijackIndex).toBeLessThanOrEqual(100);
    expect(metrics.synchronyIndex).toBeGreaterThanOrEqual(-1);
    expect(metrics.synchronyIndex).toBeLessThanOrEqual(1);
    for (const balance of Object.values(metrics.eiBalance)) {
      expect(balance).toBeGreaterThanOrEqual(-1);
      expect(balance).toBeLessThanOrEqual(1);
    }
  });

  it('computes loop gain from the four control-loop weights', () => {
    const trial = runBrainTrial({ targets: PRESSURE_TARGETS, seed: 'loop', ticks: 90 });
    const metrics = computeBrainMetrics(trial);
    const expected = CONTROL_LOOP.reduce((product, id) => product * trial.finalState.weights[id], 1);
    expect(Math.abs(metrics.loopGain - expected)).toBeLessThan(1e-6);
  });

  it('reports settling time only when targets are supplied', () => {
    expect(metricsFor({}).settlingTicks).toBe(null);
    const settled = metricsFor({ targets: CALM_TARGETS }).settlingTicks;
    expect(settled === null || settled >= 0).toBe(true);
  });
});

describe('METRIC_DESCRIPTORS', () => {
  it('describes each headline metric with a direction', () => {
    const metrics = metricsFor({ targets: PRESSURE_TARGETS });
    for (const descriptor of METRIC_DESCRIPTORS) {
      expect(typeof descriptor.label).toBe('string');
      expect(['higher-good', 'lower-good', 'contextual'].includes(descriptor.direction)).toBe(true);
      expect(metrics[descriptor.id] !== undefined).toBe(true);
    }
  });
});
