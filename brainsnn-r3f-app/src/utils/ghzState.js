/**
 * Layer 107 — GHZ Lab
 *
 * 3-qubit Greenberger-Horne-Zeilinger state. Extends Layer 102 (Bell pair)
 * from 2 qubits to 3:
 *
 *   |000⟩ → H ⊗ I ⊗ I → CNOT(0, 1) → CNOT(0, 2)  =  (|000⟩ + |111⟩) / √2.
 *
 * On measurement, the three qubits always agree: all 0 with probability
 * 1/2, all 1 with probability 1/2, and *zero* probability for any of the
 * 6 mixed outcomes. That zero is the GHZ-vs-Bell signature: a single
 * shared phase locks all 3 qubits, and any one-qubit measurement
 * instantly fixes the others (statistically — no signaling).
 *
 * Pure JS, no DOM, no quantum dependency. Implements just enough of a
 * 3-qubit state vector to support GHZ + a depolarizing-style noise mix.
 */

// ---------- 3-qubit state representation ----------------------------------
// We store the state as 8 complex amplitudes for basis kets in canonical
// order: |000⟩, |001⟩, |010⟩, |011⟩, |100⟩, |101⟩, |110⟩, |111⟩.
// Each entry is { re, im }.

function c(re = 0, im = 0) {
  return { re, im };
}

function addC(a, b) {
  return c(a.re + b.re, a.im + b.im);
}

function mulC(a, b) {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function abs2(z) {
  return z.re * z.re + z.im * z.im;
}

const ZERO = c(0, 0);

export function newState() {
  // |000⟩
  const s = Array.from({ length: 8 }, () => c());
  s[0] = c(1, 0);
  return s;
}

// ---------- gates -----------------------------------------------------------

/**
 * Apply a Hadamard to qubit `q ∈ {0, 1, 2}`. Indexing: bit 0 is the *least*
 * significant bit of the basis index; qubit 0 corresponds to bit 2 (the
 * leftmost ket character). We flip bit position `2 - q`.
 */
export function applyH(state, q) {
  const inv = 1 / Math.sqrt(2);
  const bit = 2 - q;
  const mask = 1 << bit;
  const out = state.map((z) => c(z.re, z.im));
  for (let i = 0; i < 8; i += 1) {
    if ((i & mask) !== 0) continue; // process pairs once
    const j = i | mask;
    const a = state[i];
    const b = state[j];
    out[i] = c((a.re + b.re) * inv, (a.im + b.im) * inv);
    out[j] = c((a.re - b.re) * inv, (a.im - b.im) * inv);
  }
  return out;
}

/**
 * Pauli-X on qubit q.
 */
export function applyX(state, q) {
  const bit = 2 - q;
  const mask = 1 << bit;
  const out = Array.from({ length: 8 }, () => ZERO);
  for (let i = 0; i < 8; i += 1) {
    out[i ^ mask] = state[i];
  }
  return out;
}

/**
 * CNOT with control qubit `c` and target qubit `t`.
 */
export function applyCNOT(state, ctrl, target) {
  const cBit = 2 - ctrl;
  const tBit = 2 - target;
  const cMask = 1 << cBit;
  const tMask = 1 << tBit;
  const out = state.map((z) => c(z.re, z.im));
  for (let i = 0; i < 8; i += 1) {
    if ((i & cMask) === 0) {
      out[i] = state[i];
    } else {
      out[i ^ tMask] = state[i];
    }
  }
  return out;
}

// ---------- measurement -----------------------------------------------------

/**
 * Return P(|000⟩), P(|001⟩), …, P(|111⟩). Sums to 1.
 */
export function measureDistribution(state) {
  return state.map(abs2);
}

/**
 * Mix the pure distribution toward the uniform [1/8] × 8 by `noise` ∈ [0, 1].
 * Noise = 0 keeps the pure distribution; noise = 1 fully randomises.
 */
export function applyDepolarizingNoise(distribution, noise) {
  const n = Math.max(0, Math.min(1, noise));
  const u = 1 / 8;
  return distribution.map((p) => (1 - n) * p + n * u);
}

/**
 * Sample `shots` outcomes from a distribution. Returns counts indexed by the
 * 8 basis kets.
 */
export function sampleShots(distribution, shots) {
  const counts = Array(8).fill(0);
  const cum = [];
  let acc = 0;
  for (const p of distribution) {
    acc += p;
    cum.push(acc);
  }
  for (let s = 0; s < shots; s += 1) {
    const r = Math.random();
    let i = 0;
    while (i < cum.length - 1 && r > cum[i]) i += 1;
    counts[i] += 1;
  }
  return counts;
}

// ---------- experiment ------------------------------------------------------

const KET_LABELS = ['000', '001', '010', '011', '100', '101', '110', '111'];

/**
 * Build the GHZ state and run a measurement.
 *
 *   |000⟩ → H ⊗ I ⊗ I → CNOT(0, 1) → CNOT(0, 2)
 *
 * Returns counts, distribution, and a few derived metrics:
 *   - parity: P(|000⟩) + P(|111⟩). Ideal = 1.0.
 *   - leakage: 1 - parity. Ideal = 0.
 *   - threeWayCorrelation: same as parity (renamed for clarity).
 */
export function runGhzExperiment({ shots = 1024, noise = 0 } = {}) {
  let state = newState();
  state = applyH(state, 0);
  state = applyCNOT(state, 0, 1);
  state = applyCNOT(state, 0, 2);
  const pure = measureDistribution(state);
  const distribution = applyDepolarizingNoise(pure, noise);
  const counts = sampleShots(distribution, shots);

  const parity = distribution[0] + distribution[7];
  const leakage = 1 - parity;

  return {
    distribution,
    counts,
    labels: KET_LABELS.slice(),
    parity,
    leakage,
    threeWayCorrelation: parity,
    shots,
    noise,
  };
}

/**
 * Map a GHZ result to brain region deltas (for Apply-to-brain). Same scheme
 * as L102 / L103: regions in [-0.5, +0.5], scaled in App.jsx.
 */
export function mapGhzToBrainState(result) {
  const clamp = (v) => Math.max(-0.5, Math.min(0.5, v));
  return {
    PFC: clamp(result.parity * 0.4),
    AMY: clamp(result.leakage),
    THL: clamp(result.parity * 0.3),
    HPC: clamp(result.parity * 0.5),
    BG: clamp(result.parity * 0.4),
    CBL: clamp(result.leakage * 0.8),
    CTX: clamp(result.shots / 8192),
  };
}
