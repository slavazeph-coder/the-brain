import React, { useState } from 'react';
import { fusedQuery, buildFusionGraph } from '../utils/vectorGraphFusion';
import { getMultimodalStatus } from '../utils/multimodalRag';

/**
 * Layer 34 — Vector-Graph Fusion Panel
 *
 * Reranks Layer 33 retrieval with graph coherence: siblings,
 * sequence neighbors, and Louvain communities get pulled in
 * even when they didn't directly score on cosine/BM25.
 */
export default function VectorGraphFusionPanel({ onApplyToBrain }) {
  const [question, setQuestion] = useState('Which rows in the attack table show combo attacks?');
  const [graphWeight, setGraphWeight] = useState(0.35);
  const [querying, setQuerying] = useState(false);
  const [result, setResult] = useState(null);
  const [graphInfo, setGraphInfo] = useState(null);
  const [error, setError] = useState(null);

  const mmStatus = getMultimodalStatus();

  async function handleQuery() {
    if (!question.trim()) return;
    setQuerying(true);
    setError(null);
    try {
      const res = await fusedQuery(question, { graphWeight, topK: 6 });
      setResult(res);
      setGraphInfo(res.graph);
    } catch (err) {
      setError(err.message);
    } finally {
      setQuerying(false);
    }
  }

  function handleInspectGraph() {
    try {
      const g = buildFusionGraph();
      setGraphInfo({
        nodes: g.nodes.length,
        edges: g.edges.length,
        modularity: g.modularity,
        communities: g.communityList?.length || 0
      });
    } catch (err) {
      setError(err.message);
    }
  }

  function handleApply() {
    if (!result?.results?.length) return;
    onApplyToBrain?.(result);
  }

  return (
    <section className="panel panel-pad rag-panel">
      <div className="eyebrow">Layer 34</div>
      <h2>Vector-Graph Fusion</h2>
      <p className="muted">
        Reranks Layer 33 hits with graph coherence. Siblings (same doc/section),
        sequence neighbors, and Louvain community members get pulled in even if
        they didn't directly match the query. Cannibalized from RAG-Anything's
        vector-graph fusion strategy.
      </p>

      {!mmStatus.indexed && (
        <p className="rag-error small-note">
          Index content in Layer 33 first — this layer reranks those results.
        </p>
      )}

      {mmStatus.indexed && (
        <>
          <div className="rag-status-row">
            <div className="metric">
              <small>Graph nodes</small>
              <strong>{graphInfo?.nodes ?? '—'}</strong>
            </div>
            <div className="metric">
              <small>Graph edges</small>
              <strong>{graphInfo?.edges ?? '—'}</strong>
            </div>
            <div className="metric">
              <small>Communities</small>
              <strong>{graphInfo?.communities ?? '—'}</strong>
            </div>
            <div className="metric">
              <small>Modularity</small>
              <strong>{graphInfo?.modularity != null ? graphInfo.modularity.toFixed(3) : '—'}</strong>
            </div>
          </div>

          <label className="muted small-note" style={{ marginTop: 10 }}>
            Graph weight: <strong>{(graphWeight * 100).toFixed(0)}%</strong>
            <span className="muted"> (vector: {((1 - graphWeight) * 100).toFixed(0)}%)</span>
          </label>
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.05}
            value={graphWeight}
            onChange={(e) => setGraphWeight(parseFloat(e.target.value))}
            style={{ width: '100%', marginBottom: 8 }}
          />

          <div className="rag-actions" style={{ marginBottom: 8 }}>
            <button className="ghost small" onClick={handleInspectGraph}>
              Inspect graph
            </button>
          </div>

          <label className="muted small-note">Fused query</label>
          <div className="rag-query-row">
            <input
              className="rag-query-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
              placeholder="Ask — results will include graph neighbors…"
            />
            <button className="primary small" onClick={handleQuery} disabled={querying}>
              {querying ? 'Fusing…' : 'Fused search'}
            </button>
          </div>
        </>
      )}

      {error && <p className="rag-error small-note">{error}</p>}

      {result?.results?.length > 0 && (
        <div className="rag-results">
          <div className="rag-results-head">
            <strong>
              Top {result.results.length} · {result.mode}
            </strong>
            <button className="ghost small" onClick={handleApply}>
              Apply to brain
            </button>
          </div>

          {result.fusionStats && (
            <p className="muted small-note" style={{ marginBottom: 6 }}>
              {result.fusionStats.vectorCandidates} vector hits →
              {' '}{result.fusionStats.expanded} after graph expansion
              (siblings: {result.fusionStats.siblingPulls},
              {' '}community: {result.fusionStats.communityPulls},
              {' '}sequence: {result.fusionStats.sequencePulls})
            </p>
          )}

          {result.results.map((r, i) => (
            <div key={r.id} className="rag-result-card">
              <div className="rag-result-head">
                <span className="rag-result-rank">#{i + 1}</span>
                <span style={{ color: typeColor(r.type), fontWeight: 600, marginRight: 6 }}>
                  {r.type}
                </span>
                <span className="rag-result-doc">{r.docTitle}</span>
                <span
                  className="rag-result-chunk muted small-note"
                  style={{ color: sourceColor(r.source) }}
                >
                  {r.source}
                </span>
                <span className="rag-result-score" style={{ color: '#7dd87f' }}>
                  {(r.score * 100).toFixed(0)}%
                </span>
              </div>
              <p className="rag-result-text">{r.summary || r.renderedText?.slice(0, 200)}</p>
              {r.community && (
                <span className="muted small-note">community: {r.community}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function typeColor(t) {
  return {
    text: '#c0c4cc', heading: '#e6d28a', image: '#8fd3ff',
    table: '#ffb56b', equation: '#b78cff', code: '#a3e3a0'
  }[t] || '#c0c4cc';
}

function sourceColor(s) {
  if (s === 'vector+graph') return '#7dd87f';
  if (s === 'graph') return '#8fd3ff';
  return '#c0c4cc';
}
