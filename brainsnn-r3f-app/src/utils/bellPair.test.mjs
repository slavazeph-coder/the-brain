/**
 * Layer 102 — Bell Pair Lab tests.
 *
 * Run from brainsnn-r3f-app/ with:
 *   node --test src/utils/bellPair.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  zeroPair,
  applyHadamard,
  applyCNOT,
  applyPauliX,
  applyRY,
  jointDistribution,
  correlationStrength,
  runBellPairExperiment,
  mapBellToBrainState,
} from './bellPair.js';

test('zeroPair starts at |00>', () => {
  const dist = jointDistribution(zeroPair());
  assert.ok(dist[0] > 0.999);
  assert.ok(dist[1] < 0.001);
  assert.ok(dist[2] < 0.001);
  assert.ok(dist[3] < 0.001);
});

test('Hadamard on qubit 0 of |00> gives (|00>+|01>)/sqrt(2)', () => {
  const state = applyHadamard(zeroPair(), 0);
  const dist = jointDistribution(state);
  assert.ok(Math.abs(dist[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(dist[1] - 0.5) < 1e-9);
  assert.ok(Math.abs(dist[2]) < 1e-9);
  assert.ok(Math.abs(dist[3]) < 1e-9);
});

test('CNOT(0,1) flips qubit 1 only when qubit 0 is 1', () => {
  // |01> (qubit 0 = 1, qubit 1 = 0) -> |11>
  let state = applyPauliX(zeroPair(), 0);
  state = applyCNOT(state, 0, 1);
  const dist = jointDistribution(state);
  assert.ok(dist[3] > 0.999, `expected |11>, got ${JSON.stringify(dist)}`);
});

test('Bell state |Φ+> = H ⊗ I then CNOT gives 50/50 on |00> and |11>', () => {
  let state = applyHadamard(zeroPair(), 0);
  state = applyCNOT(state, 0, 1);
  const dist = jointDistribution(state);
  assert.ok(Math.abs(dist[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(dist[3] - 0.5) < 1e-9);
  assert.ok(dist[1] < 1e-9);
  assert.ok(dist[2] < 1e-9);
});

test('correlationStrength of Bell state is +1', () => {
  let state = applyHadamard(zeroPair(), 0);
  state = applyCNOT(state, 0, 1);
  const dist = jointDistribution(state);
  assert.ok(correlationStrength(dist) > 0.999);
});

test('rotation by pi/2 on Bell state breaks correlation toward 0', () => {
  let state = applyHadamard(zeroPair(), 0);
  state = applyCNOT(state, 0, 1);
  state = applyRY(state, 0, Math.PI / 2);
  const dist = jointDistribution(state);
  const corr = correlationStrength(dist);
  assert.ok(Math.abs(corr) < 0.05, `expected ~0 correlation after pi/2 rotation; got ${corr}`);
});

test('rotation by pi flips correlation to anti-correlated', () => {
  let state = applyHadamard(zeroPair(), 0);
  state = applyCNOT(state, 0, 1);
  state = applyRY(state, 0, Math.PI);
  const dist = jointDistribution(state);
  // After RY(pi) on qubit 0 of (|00>+|11>)/sqrt(2): qubit 0 flips amplitude
  // sign per branch — measurement now favors |10> and |01> (anti-correlated).
  assert.ok(correlationStrength(dist) < -0.99,
    `expected fully anti-correlated, got ${correlationStrength(dist)}`);
});

test('runBellPairExperiment with rotationTheta=0 noise=0 reports correlation=1', () => {
  const res = runBellPairExperiment({ rotationTheta: 0, shots: 4096, noise: 0 });
  assert.equal(res.kind, 'bell');
  assert.ok(res.correlation > 0.999, `got ${res.correlation}`);
  // counts should be split between [0] and [3], with [1] and [2] tiny
  assert.ok(res.counts[0] + res.counts[3] === 4096);
});

test('runBellPairExperiment with high noise lowers correlation', () => {
  const clean = runBellPairExperiment({ rotationTheta: 0, shots: 4096, noise: 0 });
  const noisy = runBellPairExperiment({ rotationTheta: 0, shots: 4096, noise: 0.9 });
  assert.ok(noisy.correlation < clean.correlation,
    `noisy ${noisy.correlation} >= clean ${clean.correlation}`);
});

test('mapBellToBrainState: HPC rises with correlation', () => {
  const correlated = mapBellToBrainState(runBellPairExperiment({ rotationTheta: 0, shots: 256, noise: 0 }));
  const decorrelated = mapBellToBrainState(runBellPairExperiment({ rotationTheta: Math.PI / 2, shots: 256, noise: 0 }));
  assert.ok(correlated.HPC > decorrelated.HPC,
    `HPC: correlated ${correlated.HPC} should exceed decorrelated ${decorrelated.HPC}`);
});

test('mapBellToBrainState: AMY rises with noise', () => {
  const clean = mapBellToBrainState(runBellPairExperiment({ rotationTheta: 0, shots: 256, noise: 0 }));
  const noisy = mapBellToBrainState(runBellPairExperiment({ rotationTheta: 0, shots: 256, noise: 0.85 }));
  assert.ok(noisy.AMY > clean.AMY);
});

test('all brain deltas are bounded to [-1, 1]', () => {
  const res = runBellPairExperiment({ rotationTheta: Math.PI / 3, shots: 1024, noise: 0.4 });
  const deltas = mapBellToBrainState(res);
  for (const [region, v] of Object.entries(deltas)) {
    assert.ok(v >= -1 && v <= 1, `${region}=${v} out of range`);
  }
});
