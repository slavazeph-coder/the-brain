import test from 'node:test';
import assert from 'node:assert/strict';

import {
  I,
  H,
  T,
  Tdag,
  RZ,
  mul2,
  distance,
  ALPHABET,
  sequenceToMatrix,
  findBestApproximation,
  approximationReport,
} from './solovayKitaev.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

test('I is the identity (distance 0 from itself)', () => {
  close(distance(I(), I()), 0);
});

test('H · H = I (distance 0)', () => {
  const HH = mul2(H(), H());
  close(distance(HH, I()), 0, 1e-12);
});

test('T · T† = I', () => {
  const TT = mul2(T(), Tdag());
  close(distance(TT, I()), 0, 1e-12);
});

test('T^8 = I (T is an 8th root of identity up to phase)', () => {
  let M = I();
  for (let i = 0; i < 8; i += 1) M = mul2(T(), M);
  close(distance(M, I()), 0, 1e-9);
});

test('RZ(0) is identity, RZ(2π) is identity (mod global phase)', () => {
  close(distance(RZ(0), I()), 0, 1e-12);
  close(distance(RZ(2 * Math.PI), I()), 0, 1e-12);
});

test('distance is symmetric', () => {
  const A = T();
  const B = mul2(H(), T());
  close(distance(A, B), distance(B, A), 1e-12);
});

test('ALPHABET has H, T, Tdag', () => {
  const ids = ALPHABET.map((g) => g.id);
  assert.ok(ids.includes('H'));
  assert.ok(ids.includes('T'));
  assert.ok(ids.includes('T†'));
});

test('sequenceToMatrix on empty sequence is identity', () => {
  close(distance(sequenceToMatrix([]), I()), 0);
});

test('sequenceToMatrix(["T"]) equals T', () => {
  close(distance(sequenceToMatrix(['T']), T()), 0, 1e-12);
});

test('findBestApproximation: identity target with maxLen 0 returns empty seq', () => {
  const r = findBestApproximation(I(), 0);
  assert.deepEqual(r.sequence, []);
  close(r.distance, 0);
});

test('findBestApproximation converges for RZ(π/4) — exact match at length 1 (T)', () => {
  const target = RZ(Math.PI / 4);
  const r = findBestApproximation(target, 4);
  // RZ(π/4) and T differ only in global phase, so distance modulo phase is 0
  close(r.distance, 0, 1e-9);
});

test('findBestApproximation: RZ(π/2) reachable with 2 T gates (distance 0)', () => {
  const target = RZ(Math.PI / 2);
  const r = findBestApproximation(target, 4);
  close(r.distance, 0, 1e-9);
});

test('approximationReport: distance is non-increasing with maxLen', () => {
  const rep = approximationReport(0.7, 6);
  for (let i = 1; i < rep.series.length; i += 1) {
    assert.ok(
      rep.series[i].distance <= rep.series[i - 1].distance + 1e-12,
      `distance increased at L=${i}: ${rep.series[i - 1].distance} -> ${rep.series[i].distance}`,
    );
  }
});

test('approximationReport: longer sequences improve approximation for non-T-multiple angle', () => {
  const rep = approximationReport(0.3, 6);
  // length-1 best should be worse than length-6 best
  assert.ok(rep.series[0].distance >= rep.series[5].distance);
});

test('approximationReport returns a best matrix close to target distance', () => {
  const rep = approximationReport(Math.PI / 4, 5);
  // π/4 is exactly T (mod global phase), so best should reach 0
  close(rep.best.distance, 0, 1e-9);
});
