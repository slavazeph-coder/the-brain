import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nand,
  emlNot,
  emlAnd,
  emlOr,
  emlNor,
  emlXor,
  emlXnor,
  emlMux,
  unaryTable,
  binaryTable,
  REFERENCE,
  NAND_DERIVATIONS,
  UNIVERSALITY_BRIDGE,
} from './nand.js';

test('nand truth table', () => {
  assert.equal(nand(0, 0), 1);
  assert.equal(nand(0, 1), 1);
  assert.equal(nand(1, 0), 1);
  assert.equal(nand(1, 1), 0);
});

test('NOT a = NAND(a, a)', () => {
  for (const a of [0, 1]) assert.equal(emlNot(a), REFERENCE.not(a));
});

test('AND, OR, NOR match reference truth tables', () => {
  for (const a of [0, 1]) for (const b of [0, 1]) {
    assert.equal(emlAnd(a, b), REFERENCE.and(a, b));
    assert.equal(emlOr(a, b), REFERENCE.or(a, b));
    assert.equal(emlNor(a, b), REFERENCE.nor(a, b));
  }
});

test('XOR / XNOR match reference', () => {
  for (const a of [0, 1]) for (const b of [0, 1]) {
    assert.equal(emlXor(a, b), REFERENCE.xor(a, b));
    assert.equal(emlXnor(a, b), REFERENCE.xnor(a, b));
  }
});

test('MUX matches reference for all 8 inputs', () => {
  for (const sel of [0, 1]) for (const a of [0, 1]) for (const b of [0, 1]) {
    assert.equal(emlMux(sel, a, b), REFERENCE.mux(sel, a, b));
  }
});

test('unaryTable / binaryTable shapes', () => {
  const u = unaryTable(emlNot);
  assert.equal(u.length, 2);
  assert.deepEqual(u, [{ a: 0, y: 1 }, { a: 1, y: 0 }]);
  const b = binaryTable(emlAnd);
  assert.equal(b.length, 4);
});

test('every NAND_DERIVATION fn maps {0,1}^arity onto {0,1}', () => {
  for (const d of NAND_DERIVATIONS) {
    if (d.arity === 1) {
      for (const a of [0, 1]) {
        const y = d.fn(a);
        assert.ok(y === 0 || y === 1, `${d.id}: non-binary output ${y}`);
      }
    } else if (d.arity === 2) {
      for (const a of [0, 1]) for (const b of [0, 1]) {
        const y = d.fn(a, b);
        assert.ok(y === 0 || y === 1, `${d.id}: non-binary output ${y}`);
      }
    } else {
      for (const sel of [0, 1]) for (const a of [0, 1]) for (const b of [0, 1]) {
        const y = d.fn(sel, a, b);
        assert.ok(y === 0 || y === 1, `${d.id}: non-binary output ${y}`);
      }
    }
  }
});

test('every NAND_DERIVATION matches its REFERENCE counterpart exactly', () => {
  for (const d of NAND_DERIVATIONS) {
    if (!REFERENCE[d.id]) continue;
    if (d.arity === 1) {
      for (const a of [0, 1]) assert.equal(d.fn(a), REFERENCE[d.id](a));
    } else if (d.arity === 2) {
      for (const a of [0, 1]) for (const b of [0, 1]) {
        assert.equal(d.fn(a, b), REFERENCE[d.id](a, b));
      }
    } else {
      for (const sel of [0, 1]) for (const a of [0, 1]) for (const b of [0, 1]) {
        assert.equal(d.fn(sel, a, b), REFERENCE[d.id](sel, a, b));
      }
    }
  }
});

test('universality bridge has all three primitives + arxiv citation', () => {
  assert.ok(UNIVERSALITY_BRIDGE.classical.primitive.includes('NAND'));
  assert.ok(UNIVERSALITY_BRIDGE.continuous.primitive.includes('eml'));
  assert.ok(UNIVERSALITY_BRIDGE.quantum.primitive.includes('H'));
  assert.ok(UNIVERSALITY_BRIDGE.continuous.citation.includes('2603.21852'));
});
