import React, { useMemo, useState } from 'react';

/**
 * Layer 104 — Quantum Glossary panel.
 *
 * A searchable reference card for every quantum term used in the L101 –
 * L103 cluster. Plain language + the math, side by side. Complements the
 * Metaphor toggle in the other panels: lets a user look up an unfamiliar
 * symbol without leaving the page.
 *
 * Nothing in here claims literal multiverse / consciousness / portal
 * physics. The "metaphor" column is explicitly framed as a teaching aid.
 */

const TERMS = [
  {
    term: '|0⟩, |1⟩',
    category: 'state',
    plain: 'The two definite answers a single qubit can give when measured.',
    math: 'Computational basis states. State vector [1, 0] and [0, 1].',
    metaphor: 'Two doors. After you measure, the qubit is behind one of them.',
  },
  {
    term: '|+⟩, |-⟩',
    category: 'state',
    plain: 'Equal-strength mixtures of |0⟩ and |1⟩, with relative phase + or -.',
    math: '(|0⟩ ± |1⟩) / √2.',
    metaphor: 'A coin spinning. + = clockwise, - = counter-clockwise; both still 50/50 when it lands.',
  },
  {
    term: 'Superposition',
    category: 'state',
    plain: 'A qubit holding both 0 and 1 at the same time, with relative weights and a phase.',
    math: 'α|0⟩ + β|1⟩ with |α|² + |β|² = 1.',
    metaphor: 'A coin in flight — neither heads nor tails until something lands the question.',
  },
  {
    term: 'Phase (relative)',
    category: 'state',
    plain: 'The angle between the |0⟩ and |1⟩ amplitudes — invisible until you interfere them.',
    math: 'arg(β / α). Global phase doesn’t affect probabilities.',
    metaphor: 'How the coin spins. Two spins that are out of step cancel each other.',
  },
  {
    term: 'Amplitude',
    category: 'state',
    plain: 'Complex number whose squared magnitude is the probability of an outcome.',
    math: 'P(state) = |amplitude|².',
    metaphor: 'The strength and direction of one side of a wave.',
  },
  {
    term: 'Hadamard (H)',
    category: 'gate',
    plain: 'Turns |0⟩ into an equal superposition |+⟩ — and back.',
    math: 'H = (1/√2) [[1, 1], [1, -1]]. H · H = I.',
    metaphor: 'Spin the coin. Spin it again with the same flick — it lands the way it started.',
  },
  {
    term: 'Pauli-X',
    category: 'gate',
    plain: 'Bit flip — swap |0⟩ and |1⟩.',
    math: 'X = [[0, 1], [1, 0]].',
    metaphor: 'Pull the switch from "off" to "on".',
  },
  {
    term: 'Pauli-Z',
    category: 'gate',
    plain: 'Phase flip — multiplies |1⟩ by -1, leaves |0⟩ alone.',
    math: 'Z = [[1, 0], [0, -1]].',
    metaphor: 'Reverse the spin direction without changing whether it’s heads or tails.',
  },
  {
    term: 'RZ(θ)',
    category: 'gate',
    plain: 'Rotates the relative phase by an angle θ.',
    math: 'RZ(θ) = diag(e^{-iθ/2}, e^{+iθ/2}).',
    metaphor: 'Twist the coin’s spin axis by θ before it lands.',
  },
  {
    term: 'RY(θ)',
    category: 'gate',
    plain: 'Rotates around the Y axis — moves probability between |0⟩ and |1⟩ smoothly.',
    math: 'RY(θ) = [[cos(θ/2), -sin(θ/2)], [sin(θ/2), cos(θ/2)]].',
    metaphor: 'Tilt the coin: more heads or more tails depending on how far you tilt.',
  },
  {
    term: 'CNOT',
    category: 'gate',
    plain: 'Two-qubit gate: flips the target qubit only when the control is |1⟩.',
    math: 'CNOT|c, t⟩ = |c, t ⊕ c⟩.',
    metaphor: 'A pair of coins glued together: flipping coin A flips coin B if A landed heads.',
  },
  {
    term: 'Bell state |Φ+⟩',
    category: 'state',
    plain: 'Maximally entangled two-qubit state where both qubits always agree when measured.',
    math: '(|00⟩ + |11⟩) / √2. Built by H ⊗ I → CNOT.',
    metaphor: 'Two coins that always land the same way — but only because their flips were prepared together, not because one signals the other.',
  },
  {
    term: 'Entanglement',
    category: 'state',
    plain: 'A correlation between two qubits stronger than any classical pair can have.',
    math: 'A pure 2-qubit state that is *not* expressible as |a⟩ ⊗ |b⟩.',
    metaphor: '"Linked dice." Not telepathy — the link comes from how they were built, and it carries no information by itself.',
  },
  {
    term: 'Measurement',
    category: 'process',
    plain: 'Sample one of the basis states with probability |amplitude|². The state collapses.',
    math: 'For α|0⟩ + β|1⟩: P(0) = |α|², P(1) = |β|². Post-measurement state = the basis ket you got.',
    metaphor: 'The coin lands. After that, it’s heads-or-tails, not spinning.',
  },
  {
    term: 'Mid-circuit measurement',
    category: 'process',
    plain: 'Measuring partway through a circuit. Destroys interference for any later gates.',
    math: 'Projects the state onto the measurement basis; the rest of the circuit acts on a classical bit.',
    metaphor: 'Peeking at the spinning coin before it lands stops the spin.',
  },
  {
    term: 'Interference',
    category: 'process',
    plain: 'When two paths through a circuit reinforce or cancel based on their relative phase.',
    math: 'Constructive: amplitudes add. Destructive: they cancel.',
    metaphor: 'Two ripples in a pond meeting peak-to-peak (taller) or peak-to-trough (flat).',
  },
  {
    term: 'Decoherence',
    category: 'noise',
    plain: 'Loss of phase information through unwanted coupling to the environment.',
    math: 'T2 dephasing damps off-diagonal density-matrix elements.',
    metaphor: 'A whisper getting drowned out as a room fills up.',
  },
  {
    term: 'Dephasing',
    category: 'noise',
    plain: 'A specific decoherence channel: the relative phase randomizes while populations stay.',
    math: 'Damps imaginary parts of off-diagonal amplitudes / matrix elements.',
    metaphor: 'The coin keeps spinning at the same speed but its axis wobbles randomly.',
  },
  {
    term: 'Bit-flip channel',
    category: 'noise',
    plain: 'A gate misfire: with probability p, the qubit’s state is X-flipped.',
    math: 'ρ → (1-p) ρ + p X ρ X.',
    metaphor: 'A 1-in-N chance the switch jiggled to the wrong position.',
  },
  {
    term: 'Depolarizing noise',
    category: 'noise',
    plain: 'With probability p, replace the qubit’s state with a uniform random one.',
    math: 'ρ → (1-p) ρ + p · I/2.',
    metaphor: 'A small chance the coin gets snatched and replaced with a freshly-tossed one.',
  },
  {
    term: 'Coherence score (this app)',
    category: 'metric',
    plain: '0–100 summary of how much quantum-ness survived a run. Drops with noise and depth.',
    math: 'See utils/quantumCoherence.js → coherenceScore().',
    metaphor: 'Battery left in the qubit at the end of the experiment.',
  },
  {
    term: 'Correlation strength (this app)',
    category: 'metric',
    plain: 'Bell-pair signed correlation: +1 mirrored, 0 independent, -1 anti-mirrored.',
    math: '(P(00) + P(11)) - (P(01) + P(10)).',
    metaphor: 'How much the two coins agree across many tosses.',
  },
  {
    term: 'Shots',
    category: 'metric',
    plain: 'How many times you rerun the circuit and measure. More shots = smoother bars.',
    math: 'Shot noise scales as 1 / √N.',
    metaphor: 'How many coin tosses you average over.',
  },
];

const CATEGORY_LABEL = {
  state: 'States',
  gate: 'Gates',
  process: 'Processes',
  noise: 'Noise',
  metric: 'Metrics',
};

const CATEGORY_COLOR = {
  state: '#5ad4ff',
  gate: '#a86fdf',
  process: '#fdab43',
  noise: '#dd6974',
  metric: '#5ee69a',
};

export default function QuantumGlossaryPanel() {
  const [q, setQ] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TERMS.filter((t) => {
      if (activeCategory !== 'all' && t.category !== activeCategory) return false;
      if (!needle) return true;
      return (
        t.term.toLowerCase().includes(needle)
        || t.plain.toLowerCase().includes(needle)
        || t.math.toLowerCase().includes(needle)
        || t.metaphor.toLowerCase().includes(needle)
      );
    });
  }, [q, activeCategory]);

  const counts = useMemo(() => {
    const c = { all: TERMS.length };
    for (const t of TERMS) c[t.category] = (c[t.category] || 0) + 1;
    return c;
  }, []);

  return (
    <section className="panel panel-pad quantum-glossary-panel">
      <div className="eyebrow">Layer 104 · quantum glossary</div>
      <h2>{TERMS.length} terms used in the quantum cluster</h2>
      <p className="muted">
        Plain language plus the math, side by side. Includes a metaphor
        column — these are explicitly framed as <em>teaching aids</em>, not
        physics claims about consciousness, multiverses, or anything beyond
        what the math says.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          className="share-input"
          placeholder={`Search ${TERMS.length} terms…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select className="share-input" value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)}>
          <option value="all">All ({counts.all})</option>
          {Object.entries(CATEGORY_LABEL).map(([id, label]) => (
            <option key={id} value={id}>{label} ({counts[id] || 0})</option>
          ))}
        </select>
      </div>

      <p className="muted small-note" style={{ marginTop: 6 }}>
        Showing <strong>{filtered.length}</strong> of {TERMS.length}
      </p>

      <div style={{ marginTop: 8 }}>
        {filtered.map((t) => (
          <div
            key={t.term}
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: 10,
              padding: '10px 12px',
              borderLeft: `3px solid ${CATEGORY_COLOR[t.category]}`,
              background: 'rgba(255,255,255,0.025)',
              borderRadius: 6,
              marginTop: 6,
            }}
          >
            <div>
              <strong style={{ fontFamily: 'monospace', color: CATEGORY_COLOR[t.category] }}>{t.term}</strong>
              <div className="muted small-note" style={{ marginTop: 2 }}>
                {CATEGORY_LABEL[t.category]}
              </div>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>
              <div>{t.plain}</div>
              <div className="muted" style={{ marginTop: 4, fontSize: 12, fontFamily: 'monospace' }}>{t.math}</div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#cbd5e1', fontStyle: 'italic' }}>
                <span className="muted">metaphor: </span>{t.metaphor}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="muted small-note" style={{ marginTop: 10 }}>No matches.</p>}
      </div>
    </section>
  );
}
