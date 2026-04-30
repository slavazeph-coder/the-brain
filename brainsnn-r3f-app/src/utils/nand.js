/**
 * Layer 106 — NAND Lab
 *
 * The Boolean side of the universality bridge introduced in Layer 105.
 * NAND is functionally complete on {0, 1}: every Boolean function is
 * expressible as a circuit of NAND gates and constants. This module
 * implements NAND and derives the standard library (NOT / AND / OR /
 * NOR / XOR / XNOR / MUX) using only nested NAND calls — no native &&,
 * ||, !, or === is allowed in the definitions, only the primitive `nand`.
 *
 * The companion panel renders truth tables side by side and shows the
 * NAND composition tree per derived gate. Together with L105 (`eml`) and
 * the Qiskit suite (`{H, CNOT, T}`), this completes the three-way
 * universality story:
 *
 *     classical:  NAND
 *     continuous: eml(x, y) = exp(x) - ln(y)
 *     quantum:    {H, CNOT, T}
 */

// ---------- core primitive --------------------------------------------------

/**
 * NAND(a, b) = ¬(a ∧ b). Inputs and output are 0 / 1 (boolean coerced).
 */
export function nand(a, b) {
  return a && b ? 0 : 1;
}

// ---------- derived gates ---------------------------------------------------
// Each derivation uses ONLY nand and the literal constants 0 / 1. Comments
// give the explicit reduction; the panel mirrors them.

/** NOT a = NAND(a, a) */
export function emlNot(a) {
  return nand(a, a);
}

/** AND(a, b) = NOT(NAND(a, b)) = NAND(NAND(a, b), NAND(a, b)) */
export function emlAnd(a, b) {
  return emlNot(nand(a, b));
}

/** OR(a, b) = NAND(NOT a, NOT b) = NAND(NAND(a, a), NAND(b, b)) */
export function emlOr(a, b) {
  return nand(emlNot(a), emlNot(b));
}

/** NOR(a, b) = NOT(OR(a, b)) */
export function emlNor(a, b) {
  return emlNot(emlOr(a, b));
}

/**
 * XOR(a, b) = (a OR b) AND NAND(a, b)
 *           = AND(OR(a, b), NAND(a, b))
 *
 * Classic 4-NAND construction:
 *   t1 = NAND(a, b)
 *   t2 = NAND(a, t1)
 *   t3 = NAND(b, t1)
 *   y  = NAND(t2, t3)
 */
export function emlXor(a, b) {
  const t1 = nand(a, b);
  const t2 = nand(a, t1);
  const t3 = nand(b, t1);
  return nand(t2, t3);
}

/** XNOR(a, b) = NOT(XOR(a, b)) */
export function emlXnor(a, b) {
  return emlNot(emlXor(a, b));
}

/**
 * 2-to-1 MUX: y = (sel == 0) ? a : b
 * Reduces to: AND(NOT sel, a) OR AND(sel, b).
 */
export function emlMux(sel, a, b) {
  return emlOr(emlAnd(emlNot(sel), a), emlAnd(sel, b));
}

// ---------- truth-table helpers --------------------------------------------

/**
 * Render a unary truth table: every input in {0, 1}.
 */
export function unaryTable(fn) {
  return [0, 1].map((a) => ({ a, y: fn(a) }));
}

/**
 * Render a binary truth table: every input in {0, 1}².
 */
export function binaryTable(fn) {
  const rows = [];
  for (const a of [0, 1]) {
    for (const b of [0, 1]) {
      rows.push({ a, b, y: fn(a, b) });
    }
  }
  return rows;
}

/**
 * Reference truth-table generator using JS native operators. We use this in
 * tests to pin every NAND-derived gate against the language's own logic.
 */
export const REFERENCE = {
  not: (a) => (a ? 0 : 1),
  and: (a, b) => (a && b ? 1 : 0),
  or: (a, b) => (a || b ? 1 : 0),
  nor: (a, b) => (a || b ? 0 : 1),
  xor: (a, b) => (a ^ b ? 1 : 0),
  xnor: (a, b) => (a ^ b ? 0 : 1),
  mux: (sel, a, b) => (sel ? b : a),
};

// ---------- catalog rendered by the panel ----------------------------------

export const NAND_DERIVATIONS = [
  { id: 'not',  label: 'NOT a',     arity: 1, fn: emlNot,  rhs: 'NAND(a, a)' },
  { id: 'and',  label: 'a AND b',   arity: 2, fn: emlAnd,  rhs: 'NAND(NAND(a, b), NAND(a, b))' },
  { id: 'or',   label: 'a OR b',    arity: 2, fn: emlOr,   rhs: 'NAND(NAND(a, a), NAND(b, b))' },
  { id: 'nor',  label: 'a NOR b',   arity: 2, fn: emlNor,  rhs: 'NOT(OR(a, b))' },
  { id: 'xor',  label: 'a XOR b',   arity: 2, fn: emlXor,  rhs: 'NAND(NAND(a, NAND(a,b)), NAND(b, NAND(a,b)))' },
  { id: 'xnor', label: 'a XNOR b',  arity: 2, fn: emlXnor, rhs: 'NOT(XOR(a, b))' },
  { id: 'mux',  label: 'MUX(sel,a,b)', arity: 3, fn: emlMux, rhs: 'OR(AND(NOT sel, a), AND(sel, b))' },
];

/**
 * Universality bridge — same shape as utils/eml.js, repeated here so the
 * panel can render the three-way card without cross-importing eml's copy.
 */
export const UNIVERSALITY_BRIDGE = {
  classical: {
    primitive: 'NAND(a, b) = ¬(a ∧ b)',
    domain: 'Boolean {0, 1}',
    derives: 'NOT, AND, OR, XOR, MUX, full digital logic',
  },
  continuous: {
    primitive: 'eml(x, y) = exp(x) − ln(y)',
    domain: 'real / complex',
    derives: 'exp, ln, +, −, ·, sin, cos, sqrt, e, π, …',
    citation: 'Odrzywołek, arXiv:2603.21852',
  },
  quantum: {
    primitive: '{H, CNOT, T}',
    domain: 'qubit Hilbert space',
    derives: 'any unitary on n qubits to ε precision (Solovay–Kitaev)',
  },
};
