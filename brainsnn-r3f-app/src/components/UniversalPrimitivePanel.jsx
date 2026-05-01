import React, { useMemo, useState } from 'react';
import {
  eml,
  emlExp,
  emlLn,
  emlNeg,
  emlAdd,
  emlSubPositive,
  emlMulPositive,
  emlSqrt,
  emlSin,
  emlCos,
  emlE,
  emlZero,
  emlPi,
  DERIVATIONS,
  UNIVERSALITY_BRIDGE,
} from '../utils/eml';

/**
 * Layer 105 — Universal Primitive Lab.
 *
 * Demonstrates Odrzywołek's `eml(x, y) = exp(x) - ln(y)` as the continuous
 * analog of NAND: a single binary operator from which (with the literal
 * constant 1) the entire scientific-calculator library is reachable. Sits
 * next to the Quantum Coherence cluster because the same "one primitive,
 * all the math" story underpins {H, CNOT, T} universality for quantum
 * computation.
 *
 * Source: arXiv:2603.21852 — "All elementary functions from a single
 * binary operator" (Andrzej Odrzywołek).
 */

const FNS = {
  exp: { fn: emlExp, kind: 'unary', label: 'exp(x)' },
  ln: { fn: emlLn, kind: 'unary-positive', label: 'ln(y)' },
  neg: { fn: emlNeg, kind: 'unary', label: '-x' },
  sqrt: { fn: emlSqrt, kind: 'unary-positive', label: '√x' },
  sin: { fn: emlSin, kind: 'unary', label: 'sin(x)' },
  cos: { fn: emlCos, kind: 'unary', label: 'cos(x)' },
  add: { fn: emlAdd, kind: 'binary', label: 'a + b' },
  sub: { fn: emlSubPositive, kind: 'binary-positive', label: 'a − b  (a > 0)' },
  mul: { fn: emlMulPositive, kind: 'binary-positive', label: 'a · b  (a, b > 0)' },
  raw: { fn: eml, kind: 'binary-positive-y', label: 'eml(x, y) raw' },
};

const REFERENCE = {
  exp: Math.exp,
  ln: Math.log,
  neg: (x) => -x,
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  raw: (x, y) => Math.exp(x) - Math.log(y),
};

function safeRun(fn, kind, a, b) {
  try {
    if (kind === 'unary' || kind === 'unary-positive') return fn(a);
    if (kind === 'binary' || kind === 'binary-positive' || kind === 'binary-positive-y') return fn(a, b);
    return NaN;
  } catch (err) {
    return { error: err.message };
  }
}

function fmt(v) {
  if (v && typeof v === 'object' && v.error) return `error: ${v.error}`;
  if (!Number.isFinite(v)) return String(v);
  if (Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-4)) return v.toExponential(6);
  return v.toFixed(6);
}

export default function UniversalPrimitivePanel() {
  const [selected, setSelected] = useState('exp');
  const [a, setA] = useState(1);
  const [b, setB] = useState(2);

  const meta = FNS[selected];
  const isBinary = meta.kind.startsWith('binary');
  const positiveA = meta.kind === 'unary-positive' || meta.kind === 'binary-positive';
  const positiveB = meta.kind === 'binary-positive' || meta.kind === 'binary-positive-y';

  const aVal = positiveA ? Math.max(0.0001, a) : a;
  const bVal = positiveB ? Math.max(0.0001, b) : b;

  const got = useMemo(
    () => safeRun(meta.fn, meta.kind, aVal, bVal),
    [meta, aVal, bVal],
  );
  const want = useMemo(() => {
    try {
      return isBinary ? REFERENCE[selected](aVal, bVal) : REFERENCE[selected](aVal);
    } catch (err) {
      return { error: err.message };
    }
  }, [selected, isBinary, aVal, bVal]);

  const error = useMemo(() => {
    if (typeof got !== 'number' || typeof want !== 'number') return null;
    if (!Number.isFinite(got) || !Number.isFinite(want)) return null;
    return Math.abs(got - want);
  }, [got, want]);

  const derivation = DERIVATIONS.find((d) => d.id === selected || d.symbol.startsWith(meta.label.split(' ')[0]));

  return (
    <section className="panel panel-pad universal-primitive-panel">
      <div className="eyebrow">Layer 105 · universal primitive</div>
      <h2>One operator, all the math: <code>eml(x, y) = e<sup>x</sup> − ln(y)</code></h2>
      <p className="muted">
        Odrzywołek (<a href="https://arxiv.org/abs/2603.21852" target="_blank" rel="noreferrer">arXiv:2603.21852</a>)
        shows that a single two-input gate plus the constant <code>1</code>
        generates the standard scientific-calculator library —
        constants <code>e</code>, <code>π</code>, <code>i</code>, the
        arithmetic operations, transcendentals, and the algebraic functions.
        It is the continuous-math sibling of NAND for Boolean logic and of
        the universal quantum gate set <code>{`{H, CNOT, T}`}</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {Object.entries(FNS).map(([id, m]) => (
          <button
            key={id}
            className={`btn ${selected === id ? 'primary' : ''}`}
            onClick={() => setSelected(id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted">{isBinary ? 'a' : 'x'} {positiveA ? '(must be > 0)' : ''}</span>
            <strong style={{ fontFamily: 'monospace' }}>{aVal.toFixed(3)}</strong>
          </div>
          <input
            type="range"
            min={positiveA ? '0.01' : '-3.14'}
            max="3.14"
            step="0.01"
            value={a}
            onChange={(e) => setA(parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>
        {isBinary && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span className="muted">{meta.kind === 'binary-positive-y' ? 'y (must be > 0)' : 'b'}</span>
              <strong style={{ fontFamily: 'monospace' }}>{bVal.toFixed(3)}</strong>
            </div>
            <input
              type="range"
              min={positiveB ? '0.01' : '-3.14'}
              max="3.14"
              step="0.01"
              value={b}
              onChange={(e) => setB(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: 14,
          padding: 12,
          background: 'rgba(255,255,255,0.025)',
          borderRadius: 6,
          fontFamily: 'monospace',
          fontSize: 13,
        }}
      >
        <div>
          <span className="muted">eml says: </span>
          <strong style={{ color: '#5ee69a' }}>{fmt(got)}</strong>
        </div>
        <div>
          <span className="muted">Math.* says: </span>
          <strong style={{ color: '#5ad4ff' }}>{fmt(want)}</strong>
        </div>
        {error !== null && (
          <div style={{ marginTop: 4 }}>
            <span className="muted">|Δ|: </span>
            <strong style={{ color: error < 1e-9 ? '#5ee69a' : '#fdab43' }}>{error.toExponential(2)}</strong>
            {error < 1e-9 && <span className="muted small-note"> (within numerical noise)</span>}
          </div>
        )}
        {derivation && (
          <div className="muted small-note" style={{ marginTop: 8 }}>
            derivation: <code>{derivation.rhs}</code>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Derived constants (no Math.*, just eml + 1)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {[
            { label: 'e', value: emlE, ref: Math.E },
            { label: '0', value: emlZero, ref: 0 },
            { label: 'π', value: emlPi, ref: Math.PI },
          ].map((c) => (
            <div
              key={c.label}
              style={{
                padding: 8,
                background: 'rgba(255,255,255,0.025)',
                borderRadius: 6,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              <div className="muted">{c.label}</div>
              <div style={{ color: '#5ee69a' }}>{fmt(c.value)}</div>
              <div className="muted small-note">|Δ| {Math.abs(c.value - c.ref).toExponential(1)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Universality bridge</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {[
            { id: 'classical', color: '#fdab43', title: 'Classical (Boolean)' },
            { id: 'continuous', color: '#5ee69a', title: 'Continuous (this paper)' },
            { id: 'quantum', color: '#a86fdf', title: 'Quantum' },
          ].map((row) => {
            const u = UNIVERSALITY_BRIDGE[row.id];
            return (
              <div
                key={row.id}
                style={{
                  padding: 10,
                  borderLeft: `3px solid ${row.color}`,
                  background: 'rgba(255,255,255,0.025)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <strong style={{ color: row.color }}>{row.title}</strong>
                <div style={{ marginTop: 4, fontFamily: 'monospace' }}>{u.primitive}</div>
                <div className="muted small-note" style={{ marginTop: 4 }}>domain: {u.domain}</div>
                <div className="muted small-note">derives: {u.derives}</div>
                {u.citation && <div className="muted small-note">{u.citation}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <p className="muted small-note" style={{ marginTop: 10 }}>
        The same structural fact — “a small primitive set is enough” — appears in
        three different mathematical universes. This panel is a teaching aid; it
        doesn’t claim deep physical equivalence between the three.
      </p>
    </section>
  );
}
