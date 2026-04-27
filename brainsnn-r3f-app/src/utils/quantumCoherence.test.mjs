/**
 * Layer 101 — Quantum Coherence Lab tests.
 *
 * Run from brainsnn-r3f-app/ with:
 *   node --test src/utils/quantumCoherence.test.mjs
 *
 * Uses Node's built-in test runner (Node 18+). No extra dev deps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runPhaseExperiment,
  runObservationExperiment,
  runDecoherenceExperiment,
  coherenceScore,
  measureDistribution,
  applyH,
  applyX,
  applyZ,
  applyRZ,
  complex,
  abs2,
  normalizeState,
  mapQuantumToBrainState,
} from './quantumCoherence.js';

const SHOTS = 4096;

test('phase experiment with theta=0 returns high P(0)', () => {
  const res = runPhaseExperiment({ theta: 0, shots: SHOTS, noise: 0 });
  assert.equal(res.kind, 'phase');
  assert.ok(
    res.distribution[0] > 0.95,
    `expected P(0) > 0.95, got ${res.distribution[0]}`,
  );
});

test('phase experiment with theta=pi returns high P(1)', () => {
  const res = runPhaseExperiment({ theta: Math.PI, shots: SHOTS, noise: 0 });
  assert.ok(
    res.distribution[1] > 0.95,
    `expected P(1) > 0.95, got ${res.distribution[1]}`,
  );
});

test('phase experiment at theta=pi/2 splits ~50/50', () => {
  const res = runPhaseExperiment({ theta: Math.PI / 2, shots: SHOTS, noise: 0 });
  assert.ok(
    Math.abs(res.distribution[0] - 0.5) < 0.05,
    `expected P(0) ~ 0.5, got ${res.distribution[0]}`,
  );
});

test('observation experiment with observeMidway=false returns high P(0)', () => {
  // H ∘ H = I, so |0⟩ stays |0⟩.
  const res = runObservationExperiment({ shots: SHOTS, observeMidway: false, noise: 0 });
  assert.ok(
    res.distribution[0] > 0.95,
    `expected P(0) > 0.95 with no midway observation, got ${res.distribution[0]}`,
  );
});

test('observation experiment with observeMidway=true is more random', () => {
  // Average over runs since the midway measurement is stochastic.
  let p0Sum = 0;
  const trials = 40;
  for (let i = 0; i < trials; i += 1) {
    const r = runObservationExperiment({ shots: 256, observeMidway: true, noise: 0 });
    p0Sum += r.distribution[0];
  }
  const avgP0 = p0Sum / trials;
  assert.ok(
    avgP0 > 0.35 && avgP0 < 0.65,
    `expected avg P(0) ~ 0.5 after midway measurement, got ${avgP0.toFixed(3)}`,
  );
});

test('increasing noise lowers coherenceScore', () => {
  const low = coherenceScore({ noise: 0, depth: 1, observedMidway: false });
  const mid = coherenceScore({ noise: 0.5, depth: 1, observedMidway: false });
  const high = coherenceScore({ noise: 1, depth: 1, observedMidway: false });
  assert.ok(low > mid, `expected ${low} > ${mid}`);
  assert.ok(mid > high, `expected ${mid} > ${high}`);
});

test('increasing depth lowers coherenceScore', () => {
  const shallow = coherenceScore({ noise: 0.1, depth: 1, observedMidway: false });
  const deeper = coherenceScore({ noise: 0.1, depth: 5, observedMidway: false });
  const deepest = coherenceScore({ noise: 0.1, depth: 12, observedMidway: false });
  assert.ok(shallow > deeper, `expected ${shallow} > ${deeper}`);
  assert.ok(deeper > deepest, `expected ${deeper} > ${deepest}`);
});

test('observing midway dings coherenceScore', () => {
  const watched = coherenceScore({ noise: 0, depth: 1, observedMidway: true });
  const unwatched = coherenceScore({ noise: 0, depth: 1, observedMidway: false });
  assert.ok(unwatched > watched, `expected ${unwatched} > ${watched}`);
});

test('decoherence experiment ideal (noise=0) returns ~P(0)=1', () => {
  const res = runDecoherenceExperiment({ xxPairs: 8, shots: SHOTS, noise: 0 });
  assert.ok(
    res.distribution[0] > 0.99,
    `X·X pairs are identity at noise=0; got P(0)=${res.distribution[0]}`,
  );
});

test('decoherence experiment with noise lowers P(0) vs ideal', () => {
  const ideal = runDecoherenceExperiment({ xxPairs: 6, shots: SHOTS, noise: 0 });
  const noisy = runDecoherenceExperiment({ xxPairs: 6, shots: SHOTS, noise: 0.7 });
  assert.ok(
    noisy.distribution[0] < ideal.distribution[0],
    `expected noisy P(0) < ideal P(0); got ${noisy.distribution[0]} vs ${ideal.distribution[0]}`,
  );
});

test('Hadamard on |0> gives equal probabilities', () => {
  const state = applyH([complex(1, 0), complex(0, 0)]);
  const [p0, p1] = measureDistribution(state);
  assert.ok(Math.abs(p0 - 0.5) < 1e-9);
  assert.ok(Math.abs(p1 - 0.5) < 1e-9);
});

test('Pauli-X flips |0> to |1>', () => {
  const state = applyX([complex(1, 0), complex(0, 0)]);
  const [p0, p1] = measureDistribution(state);
  assert.ok(p1 > 0.999);
  assert.ok(p0 < 0.001);
});

test('Pauli-Z preserves probabilities (phase only)', () => {
  const start = applyH([complex(1, 0), complex(0, 0)]);
  const after = applyZ(start);
  const before = measureDistribution(start);
  const post = measureDistribution(after);
  assert.ok(Math.abs(before[0] - post[0]) < 1e-9);
});

test('RZ(2π) acts as identity on probabilities', () => {
  const start = applyH([complex(1, 0), complex(0, 0)]);
  const after = applyRZ(start, Math.PI * 2);
  assert.ok(Math.abs(abs2(start[0]) - abs2(after[0])) < 1e-9);
  assert.ok(Math.abs(abs2(start[1]) - abs2(after[1])) < 1e-9);
});

test('normalizeState normalizes near-zero state to |0>', () => {
  const norm = normalizeState([complex(0, 0), complex(0, 0)]);
  assert.equal(norm[0].re, 1);
  assert.equal(norm[1].re, 0);
});

test('mapQuantumToBrainState returns 7 region deltas in [-1, 1]', () => {
  const res = runPhaseExperiment({ theta: 0, shots: 1024, noise: 0 });
  const deltas = mapQuantumToBrainState(res);
  for (const region of ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL']) {
    assert.ok(region in deltas, `missing region ${region}`);
    assert.ok(deltas[region] >= -1 && deltas[region] <= 1, `${region} out of range: ${deltas[region]}`);
  }
});

test('mapQuantumToBrainState: AMY rises with noise', () => {
  const clean = mapQuantumToBrainState(runPhaseExperiment({ theta: 0, shots: 256, noise: 0 }));
  const noisy = mapQuantumToBrainState(runPhaseExperiment({ theta: 0, shots: 256, noise: 0.9 }));
  assert.ok(noisy.AMY > clean.AMY, `expected noisy AMY > clean AMY; got ${noisy.AMY} vs ${clean.AMY}`);
});

test('mapQuantumToBrainState: PFC rises with coherence (clean run > noisy run)', () => {
  const clean = mapQuantumToBrainState(runPhaseExperiment({ theta: 0, shots: 256, noise: 0 }));
  const noisy = mapQuantumToBrainState(runPhaseExperiment({ theta: 0, shots: 256, noise: 0.95 }));
  assert.ok(clean.PFC > noisy.PFC, `expected clean PFC > noisy PFC; got ${clean.PFC} vs ${noisy.PFC}`);
});
