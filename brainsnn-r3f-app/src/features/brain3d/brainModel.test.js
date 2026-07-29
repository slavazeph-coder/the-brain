import { describe, expect, it } from '../../test/tinyVitest.js';
import { BRAIN_REGIONS, PATHWAYS } from './brainRegions.js';
import {
  createBrainParams,
  createBrainState,
  DEFAULT_PARAMS,
  runBrainTrial,
  spikeProbability,
  stepBrain,
} from './brainModel.js';
import { createRng } from '../../lib/rng.js';

const PRESSURE_TARGETS = { THL: 0.8, CTX: 0.4, HPC: 0.3, PFC: 0.2, AMY: 0.85, BG: 0.8, CBL: 0.3 };
const CALM_TARGETS = { THL: 0.45, CTX: 0.6, HPC: 0.5, PFC: 0.8, AMY: 0.15, BG: 0.2, CBL: 0.4 };

describe('stepBrain', () => {
  it('is deterministic for a given seed', () => {
    const a = runBrainTrial({ targets: PRESSURE_TARGETS, seed: 'seed-a', ticks: 60 });
    const b = runBrainTrial({ targets: PRESSURE_TARGETS, seed: 'seed-a', ticks: 60 });
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
  });

  it('produces a different trace for a different seed', () => {
    const a = runBrainTrial({ targets: PRESSURE_TARGETS, seed: 'seed-a', ticks: 60 });
    const b = runBrainTrial({ targets: PRESSURE_TARGETS, seed: 'seed-b', ticks: 60 });
    expect(JSON.stringify(a.trace) === JSON.stringify(b.trace)).toBe(false);
  });

  it('keeps activities and weights inside their configured bounds', () => {
    const params = createBrainParams();
    const { trace } = runBrainTrial({ targets: PRESSURE_TARGETS, seed: 'bounds', ticks: 120 });
    for (const frame of trace) {
      for (const region of BRAIN_REGIONS) {
        expect(frame.activities[region.code]).toBeGreaterThanOrEqual(0);
        expect(frame.activities[region.code]).toBeLessThanOrEqual(params.activityCeiling);
      }
      for (const pathway of PATHWAYS) {
        expect(frame.weights[pathway.id]).toBeGreaterThanOrEqual(params.weightFloor);
        expect(frame.weights[pathway.id]).toBeLessThanOrEqual(params.weightCeiling);
      }
    }
  });

  it('stays finite under extreme parameters', () => {
    const { trace } = runBrainTrial({
      targets: PRESSURE_TARGETS,
      params: { synapticGain: 3, hebbianRate: 0.5, noiseAmplitude: 0.4, leak: 0.99 },
      seed: 'extreme',
      ticks: 80,
    });
    for (const frame of trace) {
      for (const value of Object.values(frame.activities)) expect(Number.isFinite(value)).toBe(true);
      for (const value of Object.values(frame.weights)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('interventions', () => {
  it('silences a lesioned region and starves its targets', () => {
    const lesioned = runBrainTrial({
      targets: PRESSURE_TARGETS,
      interventions: { lesions: ['AMY'], cuts: [], stimuli: {} },
      seed: 'lesion',
      ticks: 80,
    });
    for (const frame of lesioned.trace) {
      expect(frame.activities.AMY).toBe(0);
      expect(frame.spikes.AMY).toBe(false);
    }
    // AMY is BG's only input, so BG loses its excitatory drive entirely.
    const lastFrame = lesioned.trace[lesioned.trace.length - 1];
    expect(lastFrame.drive.BG.excitatory).toBe(0);
  });

  it('freezes a cut pathway rather than deleting it', () => {
    const { trace } = runBrainTrial({
      targets: PRESSURE_TARGETS,
      interventions: { lesions: [], cuts: ['BG-THL'], stimuli: {} },
      seed: 'cut',
      ticks: 60,
    });
    const initial = PATHWAYS.find((pathway) => pathway.id === 'BG-THL').initialWeight;
    for (const frame of trace) {
      expect(frame.weights['BG-THL']).toBe(initial);
      // THL keeps its excitatory drive but loses the inhibitory brake.
      expect(frame.drive.THL.inhibitory).toBe(0);
    }
  });

  it('raises a region when current is injected', () => {
    const base = runBrainTrial({ targets: CALM_TARGETS, seed: 'inject', ticks: 60 });
    const boosted = runBrainTrial({
      targets: CALM_TARGETS,
      interventions: { lesions: [], cuts: [], stimuli: { PFC: 0.25 } },
      seed: 'inject',
      ticks: 60,
    });
    const meanOf = (trial) => trial.trace.reduce((sum, frame) => sum + frame.activities.PFC, 0) / trial.trace.length;
    expect(meanOf(boosted)).toBeGreaterThan(meanOf(base));
  });
});

describe('spikeProbability', () => {
  it('is silent at or below threshold and rises linearly above it', () => {
    expect(spikeProbability(0.1)).toBe(0);
    expect(spikeProbability(DEFAULT_PARAMS.spikeThreshold)).toBe(0);
    expect(spikeProbability(0.8)).toBeGreaterThan(spikeProbability(0.5));
  });

  it('cannot reach the spikeMax cap while activity is capped at 1', () => {
    // (1 - 0.24) * 1.1 = 0.836 < spikeMax 0.85, so the cap is unreachable
    // under DEFAULT_PARAMS. Pinned so a future retune notices the dead ceiling.
    const atCeiling = spikeProbability(DEFAULT_PARAMS.activityCeiling);
    expect(atCeiling).toBeLessThan(DEFAULT_PARAMS.spikeMax);
    expect(Math.abs(atCeiling - 0.836)).toBeLessThan(1e-9);
  });

  it('honours a lowered cap', () => {
    const params = createBrainParams({ spikeMax: 0.3 });
    expect(spikeProbability(1, params)).toBe(0.3);
  });
});

describe('parameters', () => {
  it('defaults reproduce the original constants', () => {
    const params = createBrainParams();
    expect(params.leak).toBe(0.78);
    expect(params.synapticGain).toBe(0.18);
    expect(params.stdpPotentiation).toBe(0.014);
    expect(params.weightSetPoint).toBe(0.44);
  });

  it('accepts overrides without mutating the defaults', () => {
    const params = createBrainParams({ leak: 0.5 });
    expect(params.leak).toBe(0.5);
    expect(DEFAULT_PARAMS.leak).toBe(0.78);
  });

  it('steps from a fresh state without targets', () => {
    const rng = createRng('no-targets');
    const next = stepBrain(createBrainState(), { rng });
    expect(next.tick).toBe(1);
    expect(Number.isFinite(next.meanFiring)).toBe(true);
  });
});
