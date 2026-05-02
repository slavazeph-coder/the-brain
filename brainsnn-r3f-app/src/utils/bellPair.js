/**
 * Layer 102 — Bell Pair Lab utilities
 *
 * Two-qubit entanglement, browser-native. Builds the Bell state
 *
 *     |Φ+⟩ = (|00⟩ + |11⟩) / √2
 *
 * by running |00⟩ → H ⊗ I → CNOT(0,1), and lets the user rotate one of the
 * qubits before measurement to see correlations break / persist.
 *
 * Convention: a 2-qubit state is a length-4 array of complex amplitudes,
 * indexed as state[2*q1 + q0] for basis ket |q1 q0⟩. Qubit 0 is the
 * "right" / least-significant bit.
 *
 * Reuses the complex helpers from quantumCoherence.js. Single-qubit gates
 * are lifted into the 2-qubit space pair-by-pair to keep allocations tiny.
 */

import { complex, mulComplex, abs2 } from './quantumCoherence.js';

const SQRT1_2 = 1 / Math.SQRT2;

// ---------- 2-qubit state helpers ------------------------------------------

export function zeroPair() {
  return [complex(1, 0), complex(0, 0), complex(0, 0), complex(0, 0)];
}

function cloneState(state) {
  return state.map((z) => ({ re: z.re, im: z.im }));
}

/**
 * Apply a 2x2 matrix `[[m00, m01], [m10, m11]]` (each entry complex) to one
 * qubit of a 2-qubit state. `qubit` is 0 or 1; we pair indices that differ
 * only in that bit and apply the matrix to each pair.
 */
function applySingleQubit(state, qubit, m00, m01, m10, m11) {
  const out = cloneState(state);
  const stride = 1 << qubit;
  for (let i = 0; i < 4; i += 1) {
    if ((i & stride) !== 0) continue;
    const j = i | stride;
    const a = state[i];
    const b = state[j];
    // out[i] = m00*a + m01*b
    out[i] = {
      re: m00.re * a.re - m00.im * a.im + m01.re * b.re - m01.im * b.im,
      im: m00.re * a.im + m00.im * a.re + m01.re * b.im + m01.im * b.re,
    };
    // out[j] = m10*a + m11*b
    out[j] = {
      re: m10.re * a.re - m10.im * a.im + m11.re * b.re - m11.im * b.im,
      im: m10.re * a.im + m10.im * a.re + m11.re * b.im + m11.im * b.re,
    };
  }
  return out;
}

export function applyHadamard(state, qubit) {
  const h = complex(SQRT1_2, 0);
  const negH = complex(-SQRT1_2, 0);
  return applySingleQubit(state, qubit, h, h, h, negH);
}

export function applyPauliX(state, qubit) {
  return applySingleQubit(state, qubit, complex(0, 0), complex(1, 0), complex(1, 0), complex(0, 0));
}

/**
 * RY(θ) = [[cos(θ/2), -sin(θ/2)], [sin(θ/2), cos(θ/2)]] — real-valued,
 * which is convenient because it produces measurement-axis rotations
 * that the user can see in the joint distribution.
 */
export function applyRY(state, qubit, theta) {
  const c = complex(Math.cos(theta / 2), 0);
  const s = complex(Math.sin(theta / 2), 0);
  const negS = complex(-s.re, 0);
  return applySingleQubit(state, qubit, c, negS, s, c);
}

/** RZ on a 2-qubit state (single qubit). */
export function applyRZQubit(state, qubit, theta) {
  const half = theta / 2;
  const m00 = complex(Math.cos(-half), Math.sin(-half));
  const m11 = complex(Math.cos(half), Math.sin(half));
  return applySingleQubit(state, qubit, m00, complex(0, 0), complex(0, 0), m11);
}

/**
 * CNOT — controlled-X. Flips `target` iff `control` is |1⟩.
 * Implemented as a permutation of amplitudes.
 */
export function applyCNOT(state, control, target) {
  if (control === target) return cloneState(state);
  const out = cloneState(state);
  for (let i = 0; i < 4; i += 1) {
    const cBit = (i >> control) & 1;
    if (cBit === 1) {
      const j = i ^ (1 << target);
      if (j > i) {
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
    }
  }
  return out;
}

// ---------- joint measurement ----------------------------------------------

/**
 * Returns the 4-element probability vector for outcomes
 * |00⟩, |01⟩, |10⟩, |11⟩ (normalized).
 */
export function jointDistribution(state) {
  const probs = state.map(abs2);
  const total = probs.reduce((a, v) => a + v, 0) || 1;
  return probs.map((p) => p / total);
}

/**
 * Sample `shots` joint measurements; returns counts [c00, c01, c10, c11].
 */
export function sampleJointShots(distribution, shots) {
  const total = Math.max(0, Math.floor(shots) || 0);
  if (!total) return [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  // Build cumulative thresholds.
  const cum = [];
  let acc = 0;
  for (let i = 0; i < 4; i += 1) {
    acc += distribution[i] ?? 0;
    cum.push(acc);
  }
  for (let s = 0; s < total; s += 1) {
    const r = Math.random();
    for (let i = 0; i < 4; i += 1) {
      if (r < cum[i]) {
        counts[i] += 1;
        break;
      }
    }
  }
  return counts;
}

/**
 * Probability that the two qubits agree (both 0 or both 1).
 * For a pure Bell state |Φ+⟩ this is 1; rotation breaks the correlation
 * smoothly, which is the lesson of the panel.
 */
export function correlationStrength(distribution) {
  const agree = (distribution[0] ?? 0) + (distribution[3] ?? 0);
  const disagree = (distribution[1] ?? 0) + (distribution[2] ?? 0);
  return agree - disagree; // -1 (anti-correlated) … 1 (correlated)
}

// ---------- Bell pair experiment -------------------------------------------

/**
 * Build the Bell state, optionally rotate qubit 0 by `rotationTheta` (RY) to
 * preview correlation breakdown, and measure.
 *
 *   |00⟩ → H ⊗ I → CNOT(0, 1) → RY(theta) on qubit 0 → joint measurement.
 *
 * Noise model: depolarizing-style. We mix the pure-state distribution with
 * the uniform distribution by weight `noise` — i.e. with probability `noise`
 * we pretend the qubits got randomized. This cleanly takes correlation from
 * +1 (noise=0) toward 0 (noise=1), unlike a bit-flip channel that just
 * toggles between perfectly correlated and perfectly anti-correlated.
 */
export function runBellPairExperiment({
  rotationTheta = 0,
  shots = 1024,
  noise = 0,
} = {}) {
  let state = zeroPair();
  state = applyHadamard(state, 0);
  state = applyCNOT(state, 0, 1);
  if (rotationTheta !== 0) {
    state = applyRY(state, 0, rotationTheta);
  }

  let distribution = jointDistribution(state);
  const n = Math.max(0, Math.min(1, Number(noise) || 0));
  if (n > 0) {
    distribution = distribution.map((p) => (1 - n) * p + n * 0.25);
  }
  const counts = sampleJointShots(distribution, shots);
  const correlation = correlationStrength(distribution);
  return {
    kind: 'bell',
    rotationTheta,
    shots,
    noise: n,
    distribution,
    counts,
    correlation,
    finalState: state,
  };
}

// ---------- brain mapping ---------------------------------------------------

/**
 * Bell-pair brain mapping — entanglement = strong inter-region binding.
 *  - HPC ↑ correlation (binding two threads = associative memory)
 *  - PFC ↑ |correlation| (executive lock-on to a coherent answer)
 *  - CTX ↑ shots / 4096 (more data = more cortex)
 *  - AMY ↑ noise
 *  - THL ↑ when |rotationTheta| > 0 (relay traffic between qubits)
 *  - BG  ↑ dominance of the lead outcome
 *  - CBL ↑ noise * (1 - |correlation|) (correction work when binding fails)
 */
export function mapBellToBrainState(result) {
  if (!result || !result.distribution) {
    return { CTX: 0, HPC: 0, THL: 0, AMY: 0, BG: 0, PFC: 0, CBL: 0 };
  }
  const corr = Math.max(-1, Math.min(1, result.correlation || 0));
  const noise = Math.max(0, Math.min(1, Number(result.noise) || 0));
  const rot = Math.abs(result.rotationTheta || 0);
  const shots = Math.max(1, Number(result.shots) || 1);
  const lead = Math.max(...result.distribution);
  const dominance = Math.max(0, lead - 0.25); // 0 = uniform, 0.75 = pure
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return {
    HPC: clamp(corr * 0.6),
    PFC: clamp(Math.abs(corr) * 0.55),
    CTX: clamp(Math.min(1, Math.log10(shots) / 4) * 0.4),
    AMY: clamp(noise * 0.5),
    THL: clamp(Math.min(1, rot / Math.PI) * 0.45),
    BG: clamp(dominance * 0.55),
    CBL: clamp(noise * (1 - Math.abs(corr)) * 0.6),
  };
}
