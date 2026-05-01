import React, { useState, useMemo } from 'react';
import {
  nand,
  emlNot,
  emlAnd,
  emlOr,
  emlNor,
  emlXor,
  emlXnor,
  emlMux,
  binaryTable,
  unaryTable,
  REFERENCE,
  NAND_DERIVATIONS,
  UNIVERSALITY_BRIDGE,
} from '../utils/nand';

/**
 * Layer 106 — NAND Lab.
 *
 * The Boolean side of the universality bridge (L105 covers continuous;
 * Qiskit covers quantum). NAND alone, with no other gate, is sufficient
 * for the entire digital-logic library. This panel renders truth tables
 * of every derived gate next to its NAND composition, and lets the user
 * tinker with two-input combinations live.
 */

const FN_BY_ID = {
  not: { fn: emlNot, arity: 1 },
  and: { fn: emlAnd, arity: 2 },
  or: { fn: emlOr, arity: 2 },
  nor: { fn: emlNor, arity: 2 },
  xor: { fn: emlXor, arity: 2 },
  xnor: { fn: emlXnor, arity: 2 },
  mux: { fn: emlMux, arity: 3 },
};

function bit(v) {
  return v ? '1' : '0';
}

export default function NandLabPanel() {
  const [selected, setSelected] = useState('xor');
  const [a, setA] = useState(1);
  const [b, setB] = useState(0);
  const [sel, setSel] = useState(0);

  const meta = FN_BY_ID[selected];
  const der = NAND_DERIVATIONS.find((d) => d.id === selected);

  const got = useMemo(() => {
    if (meta.arity === 1) return meta.fn(a);
    if (meta.arity === 2) return meta.fn(a, b);
    return meta.fn(sel, a, b);
  }, [meta, a, b, sel]);

  const want = useMemo(() => {
    const ref = REFERENCE[selected];
    if (!ref) return got;
    if (meta.arity === 1) return ref(a);
    if (meta.arity === 2) return ref(a, b);
    return ref(sel, a, b);
  }, [selected, meta, a, b, sel]);

  const table = useMemo(() => {
    if (meta.arity === 1) return unaryTable(meta.fn);
    if (meta.arity === 2) return binaryTable(meta.fn);
    // 3-input: render 8 rows
    const rows = [];
    for (const s of [0, 1]) for (const aa of [0, 1]) for (const bb of [0, 1]) {
      rows.push({ sel: s, a: aa, b: bb, y: meta.fn(s, aa, bb) });
    }
    return rows;
  }, [meta]);

  return (
    <section className="panel panel-pad nand-lab-panel">
      <div className="eyebrow">Layer 106 · NAND lab</div>
      <h2>One Boolean primitive: NAND, derives all of digital logic</h2>
      <p className="muted">
        The classical sibling of Layer 105 (<code>eml</code>) and the
        Qiskit suite (<code>{`{H, CNOT, T}`}</code>). Every derived gate
        below uses <em>only</em> nested <code>NAND</code> calls and the
        constants 0 / 1 — no native <code>&amp;&amp;</code>, <code>||</code>,
        or <code>!</code>. The truth tables are pinned against JS native
        logic in <code>nand.test.mjs</code>.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {NAND_DERIVATIONS.map((d) => (
          <button
            key={d.id}
            className={`btn ${selected === d.id ? 'primary' : ''}`}
            onClick={() => setSelected(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {meta.arity === 3 && (
          <ToggleBit label="sel" value={sel} setValue={setSel} />
        )}
        <ToggleBit label="a" value={a} setValue={setA} />
        {meta.arity >= 2 && (
          <ToggleBit label="b" value={b} setValue={setB} />
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
          <span className="muted">NAND-composition says: </span>
          <strong style={{ color: '#5ee69a' }}>{bit(got)}</strong>
        </div>
        <div>
          <span className="muted">JS native logic says:  </span>
          <strong style={{ color: '#5ad4ff' }}>{bit(want)}</strong>
        </div>
        {der && (
          <div className="muted small-note" style={{ marginTop: 8 }}>
            derivation: <code>{der.rhs}</code>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Truth table</h3>
        <table style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
              {meta.arity === 3 && <th>sel</th>}
              <th>a</th>
              {meta.arity >= 2 && <th>b</th>}
              <th>y</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r, i) => (
              <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                {meta.arity === 3 && <td>{bit(r.sel)}</td>}
                <td>{bit(r.a)}</td>
                {meta.arity >= 2 && <td>{bit(r.b)}</td>}
                <td style={{ color: '#5ee69a' }}>{bit(r.y)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14 }}>
        <h3 style={{ fontSize: 14, marginBottom: 6 }}>Universality bridge</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {[
            { id: 'classical', color: '#fdab43', title: 'Classical (this lab)' },
            { id: 'continuous', color: '#5ee69a', title: 'Continuous (L105)' },
            { id: 'quantum', color: '#a86fdf', title: 'Quantum (Qiskit)' },
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
                <div className="muted small-note" style={{ marginTop: 4 }}>derives: {u.derives}</div>
                {u.citation && <div className="muted small-note">{u.citation}</div>}
              </div>
            );
          })}
        </div>
      </div>

      <p className="muted small-note" style={{ marginTop: 10 }}>
        Pedagogical claim: a small primitive set is enough in three different
        mathematical universes. This isn’t a deep physical equivalence — just a
        shared structural fact. <code>nand({a}, {b}) = {bit(nand(a, b))}</code>.
      </p>
    </section>
  );
}

function ToggleBit({ label, value, setValue }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span className="muted small-note" style={{ minWidth: 30, fontFamily: 'monospace' }}>{label}</span>
      <button className={`btn ${value === 0 ? 'primary' : ''}`} onClick={() => setValue(0)}>0</button>
      <button className={`btn ${value === 1 ? 'primary' : ''}`} onClick={() => setValue(1)}>1</button>
    </div>
  );
}
