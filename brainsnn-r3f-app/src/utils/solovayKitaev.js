/**
 * Layer 108 — Solovay-Kitaev mini-demo.
 *
 * Educational *basic-approximation* step of the Solovay-Kitaev theorem
 * (Solovay 1995; Kitaev 1997). Full SK recursively composes two basic
 * approximations to drive ε down exponentially in the recursion depth.
 * This module implements only the brute-force basic approximation: given
 * a target 1-qubit unitary U and a max gate-sequence length L, search the
 * universal gate set {H, T, T†} for the sequence whose product is closest
 * to U under Frobenius distance modulo global phase.
 *
 * That alone is enough to teach the headline result: a finite gate set is
 * dense in SU(2), so any target can be approximated to ε precision by
 * a sequence of length growing as O(log(1/ε)^c).
 *
 * Pure JS, no external deps. The 2x2 complex matrices are stored as flat
 * arrays of length 4: [m00, m01, m10, m11], each entry { re, im }.
 */

// ---------- complex helpers -------------------------------------------------

function c(re = 0, im = 0) {
  return { re, im };
}

function addC(a, b) { return c(a.re + b.re, a.im + b.im); }
function subC(a, b) { return c(a.re - b.re, a.im - b.im); }
function mulC(a, b) { return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
function conjC(a) { return c(a.re, -a.im); }
function abs2C(a) { return a.re * a.re + a.im * a.im; }
function absC(a) { return Math.sqrt(abs2C(a)); }

// ---------- 2x2 unitary helpers --------------------------------------------

/** Identity matrix I = [[1, 0], [0, 1]]. */
export function I() {
  return [c(1, 0), c(0, 0), c(0, 0), c(1, 0)];
}

/** Hadamard. */
export function H() {
  const inv = 1 / Math.sqrt(2);
  return [c(inv, 0), c(inv, 0), c(inv, 0), c(-inv, 0)];
}

/** T = diag(1, e^(iπ/4)). */
export function T() {
  const phi = Math.PI / 4;
  return [c(1, 0), c(0, 0), c(0, 0), c(Math.cos(phi), Math.sin(phi))];
}

/** T† = diag(1, e^(-iπ/4)). */
export function Tdag() {
  const phi = -Math.PI / 4;
  return [c(1, 0), c(0, 0), c(0, 0), c(Math.cos(phi), Math.sin(phi))];
}

/** RZ(theta) = diag(e^{-iθ/2}, e^{+iθ/2}). */
export function RZ(theta) {
  const half = theta / 2;
  return [
    c(Math.cos(-half), Math.sin(-half)),
    c(0, 0),
    c(0, 0),
    c(Math.cos(half), Math.sin(half)),
  ];
}

/** Multiply two 2x2 matrices A · B. */
export function mul2(A, B) {
  const [a00, a01, a10, a11] = A;
  const [b00, b01, b10, b11] = B;
  return [
    addC(mulC(a00, b00), mulC(a01, b10)),
    addC(mulC(a00, b01), mulC(a01, b11)),
    addC(mulC(a10, b00), mulC(a11, b10)),
    addC(mulC(a10, b01), mulC(a11, b11)),
  ];
}

/**
 * Frobenius distance between two 2x2 matrices A and B, taken modulo
 * global phase: d(A, B) = sqrt(min over φ in [0, 2π) of ||A - e^{iφ} B||²).
 *
 * The minimiser of ||A - e^{iφ} B||² is a closed form: trace inner
 * product peaks when e^{iφ} aligns with arg(<A, B>). At that φ,
 *   ||A - e^{iφ} B||² = ||A||² + ||B||² - 2 |<A, B>|
 * where <A, B> = sum_{ij} conj(A_ij) · B_ij.
 */
export function distance(A, B) {
  let aSq = 0;
  let bSq = 0;
  let inner = c(0, 0);
  for (let i = 0; i < 4; i += 1) {
    aSq += abs2C(A[i]);
    bSq += abs2C(B[i]);
    inner = addC(inner, mulC(conjC(A[i]), B[i]));
  }
  const sq = aSq + bSq - 2 * absC(inner);
  return Math.sqrt(Math.max(0, sq));
}

// ---------- gate alphabet ---------------------------------------------------

/**
 * The universal alphabet for the brute-force search. {H, T, T†} is enough
 * to densely cover SU(2). We include the explicit name so the panel can
 * print the sequence.
 */
export const ALPHABET = [
  { id: 'H', matrix: H() },
  { id: 'T', matrix: T() },
  { id: 'T†', matrix: Tdag() },
];

/**
 * Apply a sequence (array of letter ids) to the identity, in left-to-right
 * order. Returns the resulting 2x2 matrix.
 */
export function sequenceToMatrix(sequence) {
  let acc = I();
  for (const letter of sequence) {
    const gate = ALPHABET.find((g) => g.id === letter);
    if (!gate) throw new Error(`Unknown gate: ${letter}`);
    acc = mul2(gate.matrix, acc);
  }
  return acc;
}

// ---------- brute-force basic approximation --------------------------------

/**
 * Iterate every sequence of length ≤ maxLen over ALPHABET and return the
 * one whose product is closest to the target unitary, modulo global phase.
 *
 * This is exponential in maxLen: |alphabet|^maxLen. For maxLen ≤ 8 the
 * count stays under ~10k and runs in a few ms; the panel caps it at 8.
 */
export function findBestApproximation(target, maxLen = 8) {
  let best = { sequence: [], matrix: I(), distance: distance(target, I()) };
  // BFS over sequences in ascending length, retaining only the best so far.
  const queue = [[]];
  while (queue.length) {
    const seq = queue.shift();
    if (seq.length > 0) {
      const M = sequenceToMatrix(seq);
      const d = distance(target, M);
      if (d < best.distance) {
        best = { sequence: seq, matrix: M, distance: d };
      }
    }
    if (seq.length < maxLen) {
      for (const letter of ALPHABET) {
        // skip immediately-cancelling consecutive T / T† pairs to keep the
        // search compact (T·T† = I).
        const last = seq[seq.length - 1];
        if ((last === 'T' && letter.id === 'T†') || (last === 'T†' && letter.id === 'T')) continue;
        queue.push([...seq, letter.id]);
      }
    }
  }
  return best;
}

/**
 * For a target rotation RZ(theta), return a structured report containing:
 *   - the target matrix
 *   - a few brute-force approximations at increasing maxLen
 *   - a "convergence series" (length, distance) the panel plots
 */
export function approximationReport(theta, maxLenCap = 8) {
  const target = RZ(theta);
  const series = [];
  for (let L = 1; L <= maxLenCap; L += 1) {
    const r = findBestApproximation(target, L);
    series.push({ maxLen: L, distance: r.distance, sequence: r.sequence });
  }
  const best = series[series.length - 1];
  return { theta, target, series, best };
}
