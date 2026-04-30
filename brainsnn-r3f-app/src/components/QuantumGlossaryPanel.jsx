import React, { useMemo, useState } from 'react';
import {
  GLOSSARY_TERMS,
  GLOSSARY_CATEGORY_LABEL,
  GLOSSARY_CATEGORY_COLOR,
  searchGlossary,
} from '../utils/quantumGlossary';

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
 *
 * Term data lives in utils/quantumGlossary.js so the structure is testable
 * without a JSX runtime.
 */

export default function QuantumGlossaryPanel() {
  const [q, setQ] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const filtered = useMemo(
    () => searchGlossary(GLOSSARY_TERMS, q, activeCategory),
    [q, activeCategory],
  );

  const counts = useMemo(() => {
    const c = { all: GLOSSARY_TERMS.length };
    for (const t of GLOSSARY_TERMS) c[t.category] = (c[t.category] || 0) + 1;
    return c;
  }, []);

  return (
    <section className="panel panel-pad quantum-glossary-panel">
      <div className="eyebrow">Layer 104 · quantum glossary</div>
      <h2>{GLOSSARY_TERMS.length} terms used in the quantum cluster</h2>
      <p className="muted">
        Plain language plus the math, side by side. Includes a metaphor
        column — these are explicitly framed as <em>teaching aids</em>, not
        physics claims about consciousness, multiverses, or anything beyond
        what the math says.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          className="share-input"
          placeholder={`Search ${GLOSSARY_TERMS.length} terms…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select className="share-input" value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)}>
          <option value="all">All ({counts.all})</option>
          {Object.entries(GLOSSARY_CATEGORY_LABEL).map(([id, label]) => (
            <option key={id} value={id}>{label} ({counts[id] || 0})</option>
          ))}
        </select>
      </div>

      <p className="muted small-note" style={{ marginTop: 6 }}>
        Showing <strong>{filtered.length}</strong> of {GLOSSARY_TERMS.length}
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
              borderLeft: `3px solid ${GLOSSARY_CATEGORY_COLOR[t.category]}`,
              background: 'rgba(255,255,255,0.025)',
              borderRadius: 6,
              marginTop: 6,
            }}
          >
            <div>
              <strong style={{ fontFamily: 'monospace', color: GLOSSARY_CATEGORY_COLOR[t.category] }}>{t.term}</strong>
              <div className="muted small-note" style={{ marginTop: 2 }}>
                {GLOSSARY_CATEGORY_LABEL[t.category]}
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
