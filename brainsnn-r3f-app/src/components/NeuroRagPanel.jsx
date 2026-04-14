import React, { useEffect, useState } from 'react';
import {
  indexDocuments, queryRag, clearIndex, getRagStatus, subscribeRag,
  mapRagToRegions, highlightMatches
} from '../utils/neuroRag';
import { isReady as embeddingsReady } from '../utils/embeddings';

/**
 * Layer 28 — Neuro-RAG Panel
 *
 * Paste documents → chunk + embed → ask questions → top-k retrieval
 * with citations. Uses Layer 24 embeddings if ready, falls back to
 * BM25 + trigram hybrid. Applying results maps HPC/CTX/PFC activation.
 */
export default function NeuroRagPanel({ onApplyToBrain }) {
  const [raw, setRaw] = useState(EXAMPLE_DOCS);
  const [question, setQuestion] = useState('How does the firewall detect manipulation?');
  const [status, setStatus] = useState(getRagStatus());
  const [indexing, setIndexing] = useState(false);
  const [indexProgress, setIndexProgress] = useState(null);
  const [queryResult, setQueryResult] = useState(null);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => subscribeRag(setStatus), []);

  async function handleIndex() {
    setIndexing(true);
    setError(null);
    setQueryResult(null);
    setIndexProgress(null);
    try {
      const result = await indexDocuments(raw, {
        onProgress: (done, total) => setIndexProgress({ done, total })
      });
      setIndexProgress(null);
      setError(null);
      setQueryResult({ justIndexed: result });
    } catch (err) {
      setError(err.message);
    } finally {
      setIndexing(false);
    }
  }

  async function handleAsk() {
    if (!question.trim()) return;
    setQuerying(true);
    setError(null);
    try {
      const result = await queryRag(question, { topK: 4 });
      setQueryResult(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setQuerying(false);
    }
  }

  function handleClear() {
    clearIndex();
    setQueryResult(null);
    setError(null);
  }

  function handleApply() {
    if (!queryResult?.results?.length) return;
    onApplyToBrain?.(queryResult);
  }

  const embedsActive = embeddingsReady();

  return (
    <section className="panel panel-pad rag-panel">
      <div className="eyebrow">Layer 28</div>
      <h2>Neuro-RAG · Semantic Retrieval</h2>
      <p className="muted">
        Paste documents (separate with <code>=== Title ===</code>), index into
        overlapping chunks, then ask questions. Uses real embeddings from Layer 24
        when ready, otherwise BM25 + trigram hybrid. Retrieval maps onto brain:
        HPC fires with memory recall strength, CTX with context breadth.
      </p>

      <div className="rag-status-row">
        <div className="metric">
          <small>Index</small>
          <strong>{status.indexed ? `${status.stats.chunks} chunks` : 'empty'}</strong>
        </div>
        <div className="metric">
          <small>Documents</small>
          <strong>{status.stats.docs}</strong>
        </div>
        <div className="metric">
          <small>Words indexed</small>
          <strong>{status.stats.words.toLocaleString()}</strong>
        </div>
        <div className="metric">
          <small>Mode</small>
          <strong style={{ color: status.usingEmbeddings ? '#7dd87f' : '#f5c888' }}>
            {status.usingEmbeddings ? 'Embeddings' : embedsActive ? 'Ready to embed' : 'BM25 fallback'}
          </strong>
        </div>
      </div>

      <label className="muted small-note">Documents</label>
      <textarea
        className="rag-docs-input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        placeholder="=== Title ===\nDocument body here...\n\n=== Another ===\nMore content..."
      />

      <div className="rag-actions">
        <button className="primary" onClick={handleIndex} disabled={indexing}>
          {indexing
            ? indexProgress
              ? `Indexing… ${indexProgress.done}/${indexProgress.total}`
              : 'Indexing…'
            : status.indexed ? 'Re-index' : 'Index documents'}
        </button>
        {status.indexed && (
          <button className="ghost small" onClick={handleClear}>
            Clear index
          </button>
        )}
      </div>

      {status.indexed && (
        <>
          <label className="muted small-note">Ask a question</label>
          <div className="rag-query-row">
            <input
              className="rag-query-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              placeholder="Your question here…"
            />
            <button className="primary small" onClick={handleAsk} disabled={querying}>
              {querying ? 'Searching…' : 'Ask'}
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="rag-error small-note">{error}</p>
      )}

      {queryResult?.results && queryResult.results.length > 0 && (
        <div className="rag-results">
          <div className="rag-results-head">
            <strong>Top {queryResult.results.length} · {queryResult.mode}</strong>
            <button className="ghost small" onClick={handleApply}>
              Apply retrieval to brain
            </button>
          </div>
          {queryResult.results.map((r, i) => (
            <div key={r.id} className="rag-result-card">
              <div className="rag-result-head">
                <span className="rag-result-rank">#{i + 1}</span>
                <span className="rag-result-doc">{r.docTitle}</span>
                <span className="rag-result-chunk muted small-note">
                  chunk {r.chunkIdx}
                </span>
                <span className="rag-result-score" style={{ color: scoreColor(r.score, queryResult.mode) }}>
                  {scoreLabel(r.score, queryResult.mode)}
                </span>
              </div>
              <p className="rag-result-text">
                {highlightMatches(r.text, question).map((part, j) =>
                  part.match ? (
                    <mark key={j} className="rag-highlight">{part.text}</mark>
                  ) : (
                    <span key={j}>{part.text}</span>
                  )
                )}
              </p>
            </div>
          ))}
        </div>
      )}

      {queryResult?.justIndexed && !queryResult.results && (
        <p className="muted small-note">
          Indexed {queryResult.justIndexed.chunks} chunks across{' '}
          {queryResult.justIndexed.docs} document{queryResult.justIndexed.docs === 1 ? '' : 's'}.
          Mode: <strong>{queryResult.justIndexed.usingEmbeddings ? 'embeddings' : 'BM25'}</strong>.
          {!queryResult.justIndexed.usingEmbeddings && !embedsActive && (
            <> Enable Layer 24 embeddings for semantic retrieval.</>
          )}
        </p>
      )}

      <p className="muted small-note">
        Chunks: 180 words with 40-word overlap. All processing happens in-browser —
        documents never leave your machine.
      </p>
    </section>
  );
}

function scoreColor(score, mode) {
  if (mode === 'embeddings') {
    if (score > 0.6) return '#7dd87f';
    if (score > 0.4) return '#a3d9a5';
    if (score > 0.25) return '#f5c888';
    return '#ff8090';
  }
  // BM25 scores are unbounded
  if (score > 0.04) return '#7dd87f';
  if (score > 0.02) return '#f5c888';
  return '#8a8f99';
}

function scoreLabel(score, mode) {
  if (mode === 'embeddings') return `${(score * 100).toFixed(0)}%`;
  return score.toFixed(3);
}

const EXAMPLE_DOCS = `=== Cognitive Firewall ===
The Cognitive Firewall is a regex-based content scanning engine that detects
manipulation patterns across four dimensions: urgency, outrage, fear, and
certainty theater. When a pattern matches, the firewall produces risk scores
for emotional activation, cognitive suppression, manipulation pressure, and
trust erosion. High scores trigger brain state changes: the amygdala and
thalamus spike while the prefrontal cortex dampens.

=== Red Team Testing ===
Red team simulation generates a synthetic attack corpus with ten samples per
category (urgency, outrage, fear, certainty, combo) plus fifteen benign
controls. Each sample runs through the firewall and produces a manipulation
pressure score. The red team reports detection rate and false-positive rate
at three thresholds: 0.2, 0.3, and 0.4. Adversarial training mines missed
attacks for discriminative n-grams.

=== Dream Mode ===
Dream mode is an idle-triggered replay consolidation system. When the brain
has been idle for more than thirty seconds, recent snapshots cycle through in
slow replay while STDP-style weight reinforcement nudges connections toward
co-activation averages. This is analogous to hippocampal replay during sleep.
Any user activity wakes the brain and resets the idle timer.`;
