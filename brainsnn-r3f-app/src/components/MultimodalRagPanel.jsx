import React, { useEffect, useMemo, useState } from 'react';
import {
  indexMultimodal,
  queryMultimodal,
  clearMultimodalIndex,
  getMultimodalStatus,
  subscribeMultimodalRag,
  MODALITIES
} from '../utils/multimodalRag';
import { isReady as embeddingsReady } from '../utils/embeddings';
import { isGemmaConfigured } from '../utils/gemmaEngine';

/**
 * Layer 33 — Multimodal RAG Router Panel
 *
 * Paste heterogeneous content (text + fenced image/table/equation/code
 * blocks) → route each item to a per-modality handler → unified retrieval
 * over the same vector space. Cannibalized from HKUDS/RAG-Anything's
 * modalprocessors pattern.
 */
export default function MultimodalRagPanel({ onApplyToBrain }) {
  const [raw, setRaw] = useState(EXAMPLE_DOCS);
  const [question, setQuestion] = useState('What firewall dimensions exist and which table row shows combo?');
  const [status, setStatus] = useState(getMultimodalStatus());
  const [filterTypes, setFilterTypes] = useState(new Set(MODALITIES));
  const [useGemma, setUseGemma] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(null);
  const [querying, setQuerying] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => subscribeMultimodalRag(setStatus), []);

  const embedsOn = embeddingsReady();
  const gemmaOn = isGemmaConfigured();

  const modalityBadges = useMemo(() => {
    return MODALITIES.map((m) => ({
      key: m,
      count: status.stats.byModality?.[m] || 0
    }));
  }, [status]);

  async function handleIndex() {
    setIndexing(true);
    setError(null);
    setResult(null);
    setIndexProgress(null);
    try {
      const res = await indexMultimodal({
        rawText: raw,
        useGemma: useGemma && gemmaOn,
        onProgress: (p) => setIndexProgress(p)
      });
      setResult({ justIndexed: res });
    } catch (err) {
      setError(err.message);
    } finally {
      setIndexing(false);
      setIndexProgress(null);
    }
  }

  async function handleAsk() {
    if (!question.trim()) return;
    setQuerying(true);
    setError(null);
    try {
      const filterArr = filterTypes.size === MODALITIES.length ? null : [...filterTypes];
      const res = await queryMultimodal(question, { topK: 5, filterTypes: filterArr });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setQuerying(false);
    }
  }

  function handleClear() {
    clearMultimodalIndex();
    setResult(null);
    setError(null);
  }

  function toggleType(t) {
    const next = new Set(filterTypes);
    if (next.has(t)) next.delete(t); else next.add(t);
    if (!next.size) next.add('text'); // never let the filter be empty
    setFilterTypes(next);
  }

  function handleApply() {
    if (!result?.results?.length) return;
    onApplyToBrain?.(result);
  }

  return (
    <section className="panel panel-pad rag-panel">
      <div className="eyebrow">Layer 33</div>
      <h2>Multimodal RAG · Router</h2>
      <p className="muted">
        Paste markdown with fenced blocks (<code>```image</code>, <code>```table</code>,
        <code>```equation</code>, <code>```code</code>). Each item routes through a
        per-modality handler, renders to embeddable text, and joins the same
        retrieval pool. Cannibalized from <em>HKUDS/RAG-Anything</em> — no
        LightRAG, no MinerU, no LibreOffice.
      </p>

      <div className="rag-status-row">
        <div className="metric">
          <small>Items</small>
          <strong>{status.stats.items}</strong>
        </div>
        <div className="metric">
          <small>Documents</small>
          <strong>{status.stats.docs}</strong>
        </div>
        <div className="metric">
          <small>belongs_to edges</small>
          <strong>{status.hierarchySize}</strong>
        </div>
        <div className="metric">
          <small>Mode</small>
          <strong style={{ color: status.usingEmbeddings ? '#7dd87f' : '#f5c888' }}>
            {status.usingEmbeddings ? 'Embeddings' : embedsOn ? 'Ready to embed' : 'BM25 fallback'}
          </strong>
        </div>
      </div>

      <div className="rag-status-row" style={{ marginTop: 8 }}>
        {modalityBadges.map((b) => (
          <div key={b.key} className="metric" style={{ opacity: b.count ? 1 : 0.45 }}>
            <small>{b.key}</small>
            <strong>{b.count}</strong>
          </div>
        ))}
      </div>

      <label className="muted small-note">Content (markdown with fenced blocks)</label>
      <textarea
        className="rag-docs-input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={14}
        placeholder={'=== Title ===\n\nParagraph text.\n\n```image { "src": "...", "alt": "...", "caption": "..." }```\n\n```table\nH1 | H2\na  | b\n```'}
      />

      <div className="rag-actions">
        <button className="primary" onClick={handleIndex} disabled={indexing}>
          {indexing
            ? indexProgress
              ? `${indexProgress.phase}… ${indexProgress.done}/${indexProgress.total}`
              : 'Indexing…'
            : status.indexed ? 'Re-index' : 'Index content'}
        </button>
        {status.indexed && (
          <button className="ghost small" onClick={handleClear}>Clear index</button>
        )}
        <label className="small-note" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={useGemma}
            onChange={(e) => setUseGemma(e.target.checked)}
            disabled={!gemmaOn}
          />
          <span style={{ color: gemmaOn ? undefined : '#8a8f99' }}>
            Enrich images via Gemma 4 {gemmaOn ? '' : '(not configured)'}
          </span>
        </label>
      </div>

      {status.indexed && (
        <>
          <label className="muted small-note" style={{ marginTop: 10 }}>Filter modalities</label>
          <div className="rag-actions" style={{ flexWrap: 'wrap', gap: 6 }}>
            {MODALITIES.map((t) => (
              <button
                key={t}
                className={filterTypes.has(t) ? 'primary small' : 'ghost small'}
                onClick={() => toggleType(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <label className="muted small-note" style={{ marginTop: 10 }}>Ask a question</label>
          <div className="rag-query-row">
            <input
              className="rag-query-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              placeholder="Ask anything about the indexed content…"
            />
            <button className="primary small" onClick={handleAsk} disabled={querying}>
              {querying ? 'Searching…' : 'Ask'}
            </button>
          </div>
        </>
      )}

      {error && <p className="rag-error small-note">{error}</p>}

      {result?.results && result.results.length > 0 && (
        <div className="rag-results">
          <div className="rag-results-head">
            <strong>
              Top {result.results.length} · {result.mode}
              {result.byModality && (
                <span className="muted" style={{ marginLeft: 8 }}>
                  {Object.entries(result.byModality).map(([k, v]) => `${k}:${v}`).join('  ')}
                </span>
              )}
            </strong>
            <button className="ghost small" onClick={handleApply}>
              Apply retrieval to brain
            </button>
          </div>
          {result.results.map((r, i) => (
            <div key={r.id} className="rag-result-card">
              <div className="rag-result-head">
                <span className="rag-result-rank">#{i + 1}</span>
                <span
                  className="rag-result-chunk"
                  style={{ color: typeColor(r.type), fontWeight: 600 }}
                >
                  {r.type}
                </span>
                <span className="rag-result-doc">{r.docTitle}</span>
                <span className="rag-result-score" style={{ color: scoreColor(r.score, result.mode) }}>
                  {scoreLabel(r.score, result.mode)}
                </span>
              </div>
              <ResultBody r={r} />
            </div>
          ))}
        </div>
      )}

      {result?.justIndexed && !result.results && (
        <p className="muted small-note">
          Indexed {result.justIndexed.items} items across{' '}
          {result.justIndexed.docs} document{result.justIndexed.docs === 1 ? '' : 's'}.
          Mode: <strong>{result.justIndexed.usingEmbeddings ? 'embeddings' : 'BM25'}</strong>.
          Modalities:{' '}
          {Object.entries(result.justIndexed.byModality)
            .map(([k, v]) => `${k}:${v}`)
            .join('  ')}
        </p>
      )}

      <p className="muted small-note">
        Images → Gemma 4 captions (when configured). Tables → row-level sentences.
        Equations → symbol set. Code → identifiers + comments. All items share the
        same vector space so a single query retrieves across modalities.
      </p>
    </section>
  );
}

function ResultBody({ r }) {
  if (r.type === 'image') {
    return (
      <div>
        <p className="rag-result-text"><strong>Caption:</strong> {r.payload.caption || r.payload.alt || '(no caption)'}</p>
        {r.payload.src && <p className="rag-result-text muted small-note">src: <code>{r.payload.src}</code></p>}
        {r.gemmaUsed && <p className="rag-result-text small-note" style={{ color: '#7dd87f' }}>Enriched via Gemma 4</p>}
      </div>
    );
  }
  if (r.type === 'table') {
    return (
      <div style={{ overflowX: 'auto' }}>
        <table className="mm-table">
          <thead>
            <tr>{(r.payload.headers || []).map((h, i) => <th key={i}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(r.payload.rows || []).slice(0, 8).map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
        {r.payload.caption && <p className="rag-result-text muted small-note">{r.payload.caption}</p>}
      </div>
    );
  }
  if (r.type === 'equation') {
    return <p className="rag-result-text"><code>{r.payload.latex}</code></p>;
  }
  if (r.type === 'code') {
    return (
      <pre className="rag-result-text" style={{ background: '#0f1218', padding: 8, borderRadius: 4, overflowX: 'auto' }}>
        <code>{r.payload.code}</code>
      </pre>
    );
  }
  return <p className="rag-result-text">{r.renderedText}</p>;
}

function typeColor(t) {
  return {
    text: '#c0c4cc',
    heading: '#e6d28a',
    image: '#8fd3ff',
    table: '#ffb56b',
    equation: '#b78cff',
    code: '#a3e3a0'
  }[t] || '#c0c4cc';
}

function scoreColor(score, mode) {
  if (mode === 'embeddings') {
    if (score > 0.6) return '#7dd87f';
    if (score > 0.4) return '#a3d9a5';
    if (score > 0.25) return '#f5c888';
    return '#ff8090';
  }
  if (score > 0.04) return '#7dd87f';
  if (score > 0.02) return '#f5c888';
  return '#8a8f99';
}

function scoreLabel(score, mode) {
  if (mode === 'embeddings') return `${(score * 100).toFixed(0)}%`;
  return score.toFixed(3);
}

const EXAMPLE_DOCS = `=== Cognitive Firewall ===

The firewall scores content across four manipulation dimensions. High scores
trigger amygdala and thalamus activation while dampening prefrontal control.

\`\`\`table
Dimension             | Signal                 | Region
emotionalActivation   | fear/outrage words     | AMY
cognitiveSuppression  | urgency/certainty      | PFC
manipulationPressure  | combined pressure      | AMY+PFC
trustErosion          | sensationalism         | HPC
\`\`\`

\`\`\`equation
F1 = 2 * (precision * recall) / (precision + recall)
\`\`\`

=== Attack Categories ===

Red-team samples fall into five attack categories plus a benign control set.

\`\`\`table
Category  | Count | Example trigger
urgency   | 10    | "You must act NOW"
outrage   | 10    | "SCANDAL exposed"
fear      | 10    | "You are in danger"
certainty | 10    | "THE truth they hide"
combo     | 10    | "URGENT SCANDAL: act now"
benign    | 15    | "The meeting is at noon"
\`\`\`

\`\`\`image { "src": "diagrams/firewall.png", "alt": "Firewall architecture", "caption": "Four-dimension scoring pipeline feeding brain regions" }\`\`\`

\`\`\`code lang=js
function scoreContent(text, rules) {
  // Regex-based dimension scoring
  return dimensions.map((d) => matchRate(text, rules[d]));
}
\`\`\`
`;
