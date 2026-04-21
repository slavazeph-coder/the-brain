import React, { useState } from 'react';
import { searchSimilar, haystackSize } from '../utils/similaritySearch';

/**
 * Layer 69 — Similarity Search panel.
 */
export default function SimilaritySearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [via, setVia] = useState('');
  const size = haystackSize();

  async function run() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const out = await searchSimilar(query);
      setResults(out);
      setVia(out[0]?.via || 'none');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel panel-pad similarity-panel">
      <div className="eyebrow">Layer 69 · find similar</div>
      <h2>Have I seen this before?</h2>
      <p className="muted">
        Searches across your local receipt log + tagged context entries
        for excerpts similar to the query. Prefers in-browser MiniLM
        embeddings (Layer 24) when warm; falls back to trigram Jaccard
        when cold. Nothing leaves the device.
      </p>
      <p className="muted small-note">
        Searchable excerpts in memory: <strong>{size}</strong>
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          className="share-input"
          placeholder="Paste a phrase to search for similar past scans…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
          style={{ flex: 1 }}
        />
        <button className="btn primary" onClick={run} disabled={loading || !query.trim()}>
          {loading ? 'Searching…' : 'Find similar'}
        </button>
      </div>

      {via && <p className="muted small-note" style={{ marginTop: 6 }}>match engine: {via}</p>}

      {results.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          {results.map((r) => {
            const pct = Math.round(r.score * 100);
            const tone = pct >= 60 ? '#5ee69a' : pct >= 30 ? '#77dbe4' : '#fdab43';
            return (
              <div
                key={r.id}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  borderLeft: `3px solid ${tone}`,
                  background: 'rgba(255,255,255,0.03)',
                  marginTop: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{r.source === 'context' ? `@${r.entity}` : 'receipt'}</strong>
                  <span style={{ color: tone, fontFamily: 'monospace' }}>
                    {pct}% · pressure {Math.round(r.pressure * 100)}%
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>
                  "{r.excerpt}"
                </p>
                <div className="muted small-note">
                  {new Date(r.ts).toISOString().slice(0, 10)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        query && !loading && <p className="muted small-note" style={{ marginTop: 10 }}>No matches.</p>
      )}
    </section>
  );
}
