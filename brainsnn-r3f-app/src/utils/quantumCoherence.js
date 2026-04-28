/**
 * Layer 101 — Quantum Coherence Lab
 *
 * Browser-native, JavaScript-only simulation of a single qubit going through
 * a tiny circuit:
 *
 *     |0⟩ → H → RZ(θ) → H → M
 *
 * Goal: teach the physical mechanism behind "alignment" — superposition,
 * phase, interference, observation, noise, and decoherence — without
 * claiming any of the metaphors are literal physics.
 *
 * No backend, no IBM/OriginQ keys. The function shapes here are intentionally
 * compatible with the Qiskit suite at /quantum_alignment/, so a future
 * version can swap the local sampler for hardware (Aer noisy / IBM Quantum /
 * OriginQ) without changing the panel.
 *
 * NOTHING in this file proves multiverse theory, consciousness collapse,
 * Planck foam, or spiritual portals. The metaphor framing lives only in
 * the panel UI, not in the math.
 */

// ---------- complex helpers -------------------------------------------------

export function complex(re, im = 0) {
  return { re, im };
}

export function addComplex(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function mulComplex(a, b) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

/** |z|^2 — squared magnitude. */
export function abs2(z) {
  return z.re * z.re + z.im * z.im;
}

// ---------- single-qubit state ---------------------------------------------

/**
 * State is a 2-vector of complex amplitudes [α, β] for |0⟩ and |1⟩.
 * normalizeState scales so |α|^2 + |β|^2 = 1 (or returns |0⟩ if zero).
 */
export function normalizeState(state) {
  const total = abs2(state[0]) + abs2(state[1]);
  if (!Number.isFinite(total) || total <= 1e-12) {
    return [complex(1, 0), complex(0, 0)];
  }
  const k = 1 / Math.sqrt(total);
  return [
    complex(state[0].re * k, state[0].im * k),
    complex(state[1].re * k, state[1].im * k),
  ];
}

const SQRT1_2 = 1 / Math.SQRT2;

/** Hadamard — creates / collapses superposition. */
export function applyH(state) {
  const a = state[0];
  const b = state[1];
  return [
    complex((a.re + b.re) * SQRT1_2, (a.im + b.im) * SQRT1_2),
    complex((a.re - b.re) * SQRT1_2, (a.im - b.im) * SQRT1_2),
  ];
}

/** Pauli-X — bit flip. */
export function applyX(state) {
  return [state[1], state[0]];
}

/** Pauli-Z — phase flip on |1⟩. */
export function applyZ(state) {
  return [state[0], complex(-state[1].re, -state[1].im)];
}

/**
 * RZ(θ) — rotate phase. Standard form: diag(e^{-iθ/2}, e^{+iθ/2}).
 * Global phase on |0⟩ is harmless for measurement; the *relative* phase
 * between the two basis amplitudes is what matters for interference.
 */
export function applyRZ(state, theta) {
  const half = theta / 2;
  const c0 = complex(Math.cos(-half), Math.sin(-half));
  const c1 = complex(Math.cos(half), Math.sin(half));
  return [mulComplex(c0, state[0]), mulComplex(c1, state[1])];
}

// ---------- measurement -----------------------------------------------------

/** Returns [P(0), P(1)] for a normalized (or near-normalized) state. */
export function measureDistribution(state) {
  const norm = normalizeState(state);
  const p0 = abs2(norm[0]);
  const p1 = abs2(norm[1]);
  const total = p0 + p1 || 1;
  return [p0 / total, p1 / total];
}

/**
 * Multinomial sample of `shots` measurements given a [P(0), P(1)] distribution.
 * Uses Math.random; tests should compare proportions with tolerances rather
 * than exact counts.
 */
export function sampleShots(distribution, shots) {
  const total = Math.max(0, Math.floor(shots) || 0);
  if (!total) return [0, 0];
  const p0 = Math.max(0, Math.min(1, distribution[0] ?? 0));
  let zeros = 0;
  for (let i = 0; i < total; i += 1) {
    if (Math.random() < p0) zeros += 1;
  }
  return [zeros, total - zeros];
}

// ---------- simple noise model ---------------------------------------------

/**
 * Dephasing damps the off-diagonal coherence. We model the state as a
 * length-2 amplitude vector but simulate the qualitative effect of T2
 * dephasing by squeezing the imaginary part of β toward zero. This
 * reproduces "lose interference fringe with noise" without a full
 * density-matrix sim.
 */
function dephase(state, factor) {
  const k = Math.max(0, Math.min(1, factor));
  if (k >= 0.999) return state;
  return [
    state[0],
    complex(state[1].re, state[1].im * k),
  ];
}

/**
 * Mix the ideal [P(0), P(1)] distribution with the uniform [0.5, 0.5] by
 * weight `noise`. This is a depolarizing-style channel applied at the
 * distribution level, which keeps tests deterministic in expectation —
 * unlike a sampled bit-flip, which produces a single ±1 trajectory.
 */
function depolarizeDistribution(distribution, noise) {
  const n = Math.max(0, Math.min(1, noise));
  if (n <= 0) return distribution;
  const [p0, p1] = distribution;
  return [(1 - n) * p0 + n * 0.5, (1 - n) * p1 + n * 0.5];
}

// ---------- experiments -----------------------------------------------------

/**
 * H → RZ(θ) → H → M.
 *
 * Pure (noise = 0):
 *   θ = 0     → P(0) = 1
 *   θ = π     → P(1) = 1
 *   θ = π/2   → P(0) = P(1) = 0.5
 *
 * Higher noise damps the interference fringe, pushing both outcomes toward
 * 0.5 regardless of θ. This is the "alignment" picture: phase coherence is
 * the resource; noise is the enemy.
 *
 * Mirrors `phase_circuit(theta)` in /quantum_alignment/quantum_alignment_tests.py.
 */
export function runPhaseExperiment({ theta = 0, shots = 1024, noise = 0 } = {}) {
  let state = [complex(1, 0), complex(0, 0)];
  state = applyH(state);
  state = applyRZ(state, theta);
  // Dephasing between RZ and final H damps the interference fringe.
  state = dephase(state, Math.max(0, 1 - noise));
  state = applyH(state);
  // Mix in uniform at the distribution level so noise=1 → 50/50 deterministically.
  const distribution = depolarizeDistribution(measureDistribution(state), noise);
  const counts = sampleShots(distribution, shots);
  return {
    kind: 'phase',
    theta,
    shots,
    noise,
    distribution,
    counts,
    finalState: state,
  };
}

/**
 * H → (optional middle measurement) → H → M.
 *
 * Without the middle measurement: H ∘ H = I, so |0⟩ stays |0⟩ → P(0) ≈ 1.
 * With the middle measurement: superposition collapses, the second H
 * spreads it back out → P(0) ≈ P(1) ≈ 0.5.
 *
 * Demonstrates "observation kills interference" — the quantum-Zeno /
 * which-path lesson, without invoking consciousness.
 *
 * Mirrors `observation_circuit_a/b` in /quantum_alignment/.
 */
export function runObservationExperiment({
  shots = 1024,
  observeMidway = false,
  noise = 0,
} = {}) {
  let state = [complex(1, 0), complex(0, 0)];
  state = applyH(state);

  if (observeMidway) {
    const [p0] = measureDistribution(state);
    const collapsed = Math.random() < p0
      ? [complex(1, 0), complex(0, 0)]
      : [complex(0, 0), complex(1, 0)];
    state = collapsed;
  } else {
    // Apply mild dephasing instead — a "soft watch" that costs coherence.
    state = dephase(state, Math.max(0, 1 - noise));
  }

  state = applyH(state);

  const distribution = depolarizeDistribution(measureDistribution(state), noise);
  const counts = sampleShots(distribution, shots);
  return {
    kind: 'observation',
    observeMidway,
    shots,
    noise,
    distribution,
    counts,
    finalState: state,
  };
}

/**
 * Stack `xxPairs` X-X pairs in a row. Algebraically X·X = I, so a perfect
 * machine returns P(0) = 1 regardless of depth. With noise, each gate is
 * a chance to misfire, so deeper circuits decohere — which is the point.
 *
 * Mirrors `noise_depth_circuit(num_xx_pairs)` in /quantum_alignment/.
 */
export function runDecoherenceExperiment({
  xxPairs = 1,
  shots = 1024,
  noise = 0,
} = {}) {
  const pairs = Math.max(0, Math.floor(xxPairs) || 0);
  // Pure-state algebra: X·X = I, so the ideal distribution is always [1, 0].
  // Effective depolarization compounds per pair: 1 - (1 - noise)^pairs.
  // This keeps the result deterministic in expectation while still showing
  // depth-driven decoherence growth.
  const ideal = [1, 0];
  const perPair = Math.max(0, Math.min(1, noise));
  const effective = pairs === 0 ? perPair : 1 - Math.pow(1 - perPair, pairs);
  const distribution = depolarizeDistribution(ideal, effective);
  const counts = sampleShots(distribution, shots);
  return {
    kind: 'decoherence',
    xxPairs: pairs,
    shots,
    noise,
    distribution,
    counts,
  };
}

// ---------- coherence score -------------------------------------------------

/**
 * 0 – 100 score capturing how much "quantum-ness" survived the run.
 * - More noise lowers the score.
 * - Deeper circuits lower the score.
 * - A midway measurement nukes the score (you broke the wavefunction).
 *
 * Pure determinism (no Math.random) so the UI is stable.
 */
export function coherenceScore({
  noise = 0,
  depth = 1,
  observedMidway = false,
} = {}) {
  const n = Math.max(0, Math.min(1, Number(noise) || 0));
  const d = Math.max(1, Math.floor(Number(depth) || 1));
  const observationPenalty = observedMidway ? 0.5 : 0;
  const depthFactor = Math.exp(-0.18 * (d - 1));
  const noiseFactor = 1 - n * 0.85;
  const raw = depthFactor * noiseFactor - observationPenalty;
  const clamped = Math.max(0, Math.min(1, raw));
  return Math.round(clamped * 100);
}

// ---------- brain mapping ---------------------------------------------------

/**
 * Convert a quantum experiment result into per-region brain deltas.
 * Returns a simple { REGION: delta } object — caller decides how strongly
 * to nudge state.regions (typical pattern is `delta * 0.3`).
 *
 *  - PFC ↑ with coherenceScore       (alignment / executive coherence)
 *  - AMY ↑ with noise                (the system is rattled)
 *  - THL ↑ with signal routing       (more shots = more relay traffic)
 *  - HPC ↑ when prior state survives (low depth + low noise = memory holds)
 *  - BG  ↑ when one outcome dominates (decisive gating)
 *  - CBL ↑ when error / noise correction is high (cerebellum tunes timing)
 *  - CTX ↑ with experiment complexity (more gates = more cortical work)
 *
 * Deltas are bounded to [-1, 1]; consumers should scale further.
 */
export function mapQuantumToBrainState(result) {
  if (!result || !result.distribution) {
    return { CTX: 0, HPC: 0, THL: 0, AMY: 0, BG: 0, PFC: 0, CBL: 0 };
  }
  const noise = Math.max(0, Math.min(1, Number(result.noise) || 0));
  const shots = Math.max(1, Number(result.shots) || 1);
  const depth = Math.max(1, Number(result.xxPairs ?? 1));
  const observedMidway = !!result.observeMidway;

  const score = coherenceScore({ noise, depth, observedMidway }) / 100;

  const [p0, p1] = result.distribution;
  const dominance = Math.abs((p0 ?? 0) - (p1 ?? 0));
  const survival = (p0 ?? 0);

  const routing = Math.min(1, Math.log10(shots) / 4);
  const complexity = Math.min(
    1,
    (result.kind === 'decoherence' ? depth / 10 : 0.35)
      + (result.kind === 'observation' && observedMidway ? 0.15 : 0)
      + (result.kind === 'phase' ? 0.4 : 0),
  );
  const correction = noise * (1 - score);

  const clamp = (v) => Math.max(-1, Math.min(1, v));

  return {
    PFC: clamp(score * 0.6),
    AMY: clamp(noise * 0.5),
    THL: clamp(routing * 0.45),
    HPC: clamp(survival * 0.5 * (1 - noise * 0.5)),
    BG: clamp(dominance * 0.5),
    CBL: clamp(correction * 0.6),
    CTX: clamp(complexity * 0.5),
  };
}
