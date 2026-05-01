import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  eml,
  emlExp,
  emlE,
  emlZero,
  emlLn,
  emlNeg,
  emlAdd,
  emlSubPositive,
  emlSub,
  emlMulPositive,
  emlPow,
  emlSqrt,
  emlPi,
  emlSin,
  emlCos,
  DERIVATIONS,
  UNIVERSALITY_BRIDGE,
} from './eml.js';

const EPS = 1e-10;
const close = (a, b, eps = EPS) => assert.ok(Math.abs(a - b) <= eps, `${a} !≈ ${b}`);

test('core: eml(x, y) = exp(x) - ln(y)', () => {
  close(eml(1, 1), Math.E);
  close(eml(0, 1), 1);
  close(eml(2, Math.E), Math.E ** 2 - 1);
  close(eml(0, Math.E), 0);
});

test('core: eml rejects y <= 0 (real branch)', () => {
  assert.throws(() => eml(0, 0), RangeError);
  assert.throws(() => eml(0, -1), RangeError);
});

test('first ring: e and 0 are exact', () => {
  close(emlE, Math.E);
  close(emlZero, 0);
});

test('first ring: emlExp matches Math.exp', () => {
  for (const x of [-2, -0.5, 0, 0.5, 1, 2.7]) close(emlExp(x), Math.exp(x));
});

test('first ring: emlLn matches Math.log for y > 0', () => {
  for (const y of [0.1, 0.5, 1, 2, 10, 1234]) close(emlLn(y), Math.log(y), 1e-9);
});

test('first ring: emlSubPositive matches a - b for a > 0', () => {
  for (const [a, b] of [[1, 1], [2, 0.5], [10, -3], [0.7, 0.3]]) {
    close(emlSubPositive(a, b), a - b, 1e-9);
  }
});

test('first ring: emlSub general matches a - b', () => {
  for (const [a, b] of [[0, 0], [-5, -7], [3, 8], [-1.2, 4.4]]) {
    close(emlSub(a, b), a - b, 1e-9);
  }
});

test('first ring: emlNeg / emlAdd', () => {
  close(emlNeg(3), -3, 1e-9);
  close(emlNeg(-3), 3, 1e-9);
  for (const [a, b] of [[2, 3], [-5, 5], [0.1, 0.2], [-7.7, 1.1]]) {
    close(emlAdd(a, b), a + b, 1e-8);
  }
});

test('second ring: emlMulPositive matches a * b for positives', () => {
  for (const [a, b] of [[2, 3], [0.5, 4], [10, 0.1]]) {
    close(emlMulPositive(a, b), a * b, 1e-8);
  }
});

test('second ring: emlPow integer + real exponents', () => {
  close(emlPow(2, 3), 8, 1e-7);
  close(emlPow(3, 0), 1, 1e-9);
  close(emlPow(4, 0.5), 2, 1e-9);
  close(emlPow(2, 1.5), Math.sqrt(8), 1e-9);
});

test('second ring: emlSqrt matches Math.sqrt', () => {
  for (const a of [0.25, 1, 2, 9, 100]) close(emlSqrt(a), Math.sqrt(a), 1e-9);
});

test('second ring: π matches Math.PI', () => {
  close(emlPi, Math.PI);
});

test('second ring: emlSin / emlCos match Math within Taylor precision', () => {
  for (const x of [-3, -1.5, -0.5, 0, 0.3, 1.2, 2.5, 3]) {
    close(emlSin(x), Math.sin(x), 1e-9);
    close(emlCos(x), Math.cos(x), 1e-9);
  }
});

test('catalog: every DERIVATION constant value is finite + matches reference', () => {
  const byId = Object.fromEntries(DERIVATIONS.map((d) => [d.id, d]));
  close(byId['e'].value, Math.E);
  close(byId['0'].value, 0);
  close(byId['pi'].value, Math.PI);
});

test('catalog: every DERIVATION fn returns finite numbers on a smoke input', () => {
  const x = 0.7;
  for (const d of DERIVATIONS) {
    if (!d.fn) continue;
    let got;
    if (d.family === 'unary' || d.family === 'unary-positive') got = d.fn(x);
    else if (d.family === 'binary') got = d.fn(x, 0.3);
    else if (d.family === 'binary-positive') got = d.fn(2, 3);
    assert.ok(Number.isFinite(got), `${d.id} returned non-finite ${got}`);
  }
});

test('universality bridge: all three primitives are described', () => {
  assert.ok(UNIVERSALITY_BRIDGE.classical.primitive.includes('NAND'));
  assert.ok(UNIVERSALITY_BRIDGE.continuous.primitive.includes('eml'));
  assert.ok(UNIVERSALITY_BRIDGE.quantum.primitive.includes('H'));
  assert.ok(UNIVERSALITY_BRIDGE.continuous.citation.includes('2603.21852'));
});
