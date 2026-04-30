import test from 'node:test';
import assert from 'node:assert/strict';

import {
  newState,
  applyH,
  applyX,
  applyCNOT,
  measureDistribution,
  applyDepolarizingNoise,
  runGhzExperiment,
  mapGhzToBrainState,
} from './ghzState.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);
const sum = (arr) => arr.reduce((s, x) => s + x, 0);

test('newState is |000⟩', () => {
  const s = newState();
  assert.equal(s.length, 8);
  close(s[0].re, 1);
  for (let i = 1; i < 8; i += 1) {
    close(s[i].re, 0);
    close(s[i].im, 0);
  }
});

test('measureDistribution sums to 1 on |000⟩', () => {
  const d = measureDistribution(newState());
  close(sum(d), 1);
});

test('applyX on qubit 0 of |000⟩ yields |100⟩', () => {
  const s = applyX(newState(), 0);
  const d = measureDistribution(s);
  // |100⟩ corresponds to bit 100 = index 4
  close(d[4], 1);
});

test('applyH on qubit 0 of |000⟩ yields equal mix of |000⟩ and |100⟩', () => {
  const s = applyH(newState(), 0);
  const d = measureDistribution(s);
  close(d[0], 0.5);
  close(d[4], 0.5);
});

test('applyCNOT(0, 1) on H ⊗ I ⊗ I gives Bell-like 2q correlation in 3q space', () => {
  let s = newState();
  s = applyH(s, 0);
  s = applyCNOT(s, 0, 1);
  const d = measureDistribution(s);
  // We expect |000⟩ and |110⟩ (control + target both on, qubit 2 still 0)
  close(d[0], 0.5);
  close(d[6], 0.5);
});

test('GHZ pipeline produces |000⟩ + |111⟩ with no leakage', () => {
  const r = runGhzExperiment({ shots: 1024, noise: 0 });
  close(r.distribution[0], 0.5);
  close(r.distribution[7], 0.5);
  for (const i of [1, 2, 3, 4, 5, 6]) close(r.distribution[i], 0);
  close(r.parity, 1);
  close(r.leakage, 0);
});

test('GHZ counts approximately 50/50 between |000⟩ and |111⟩', () => {
  const r = runGhzExperiment({ shots: 4096, noise: 0 });
  const sumCounts = sum(r.counts);
  assert.equal(sumCounts, 4096);
  // |000⟩ and |111⟩ should dominate
  const dominant = r.counts[0] + r.counts[7];
  assert.ok(dominant === 4096, `expected 4096 in {|000⟩, |111⟩}, got ${dominant}`);
});

test('GHZ noise = 1 spreads to uniform 1/8 each', () => {
  const r = runGhzExperiment({ shots: 1024, noise: 1 });
  for (const p of r.distribution) close(p, 1 / 8);
  close(r.parity, 1 / 4);  // P(000) + P(111) = 2/8
  close(r.leakage, 3 / 4);
});

test('applyDepolarizingNoise clamps and mixes correctly', () => {
  const pure = [1, 0, 0, 0, 0, 0, 0, 0];
  const half = applyDepolarizingNoise(pure, 0.5);
  close(half[0], 0.5 + 0.5 * (1 / 8));
  for (let i = 1; i < 8; i += 1) close(half[i], 0.5 * (1 / 8));
  close(sum(half), 1);
});

test('mapGhzToBrainState returns 7 named regions in [-0.5, 0.5]', () => {
  const r = runGhzExperiment({ shots: 1024, noise: 0.1 });
  const d = mapGhzToBrainState(r);
  for (const k of ['PFC', 'AMY', 'THL', 'HPC', 'BG', 'CBL', 'CTX']) {
    assert.ok(k in d, `missing ${k}`);
    assert.ok(d[k] >= -0.5 && d[k] <= 0.5, `${k} out of range: ${d[k]}`);
  }
});

test('labels are the 8 basis kets in canonical order', () => {
  const r = runGhzExperiment({ shots: 64, noise: 0 });
  assert.deepEqual(r.labels, ['000', '001', '010', '011', '100', '101', '110', '111']);
});
