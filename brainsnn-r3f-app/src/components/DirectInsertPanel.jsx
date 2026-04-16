import React, { useState } from 'react';
import { insertContentList, getMultimodalStatus } from '../utils/multimodalRag';

const EXAMPLE_JSON = JSON.stringify([
  {
    type: 'text',
    docTitle: 'External Report',
    section: 'Intro',
    text: 'This document was parsed by an external tool and inserted directly.'
  },
  {
    type: 'table',
    docTitle: 'External Report',
    section: 'Data',
    headers: ['Model', 'F1', 'Latency'],
    rows: [
      ['BrainSNN v1', '0.87', '12ms'],
      ['BrainSNN v2', '0.93', '9ms']
    ],
    caption: 'Benchmark results from external evaluation.'
  },
  {
    type: 'image',
    docTitle: 'External Report',
    section: 'Figures',
    src: 'results/chart.png',
    alt: 'F1 over epochs',
    caption: 'Training convergence curve showing F1 plateau at epoch 40.'
  },
  {
    type: 'equation',
    docTitle: 'External Report',
    section: 'Theory',
    latex: 'Q = \\sum_{c} \\frac{L_c}{m} - \\left(\\frac{d_c}{2m}\\right)^2',
    caption: 'Newman modularity for community detection.'
  }
], null, 2);

/**
 * Layer 35 — Direct Content Insertion Panel
 *
 * Accepts a JSON array of pre-parsed content items and inserts them into
 * Layer 33's multimodal index without needing markdown parsing. This is
 * RAG-Anything's "direct content insertion" escape hatch — external
 * parsers (MinerU, Docling, PaddleOCR, Obsidian exports, MCP tool output)
 * can emit structured JSON and feed it straight in.
 *
 * Each item must have at minimum: { type, docTitle }
 * Supported types: text, image, table, equation, code
 */
export default function DirectInsertPanel() {
  const [json, setJson] = useState(EXAMPLE_JSON);
  const [inserting, setInserting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [parseError, setParseError] = useState(null);

  const mmStatus = getMultimodalStatus();

  function validateJson(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return 'Must be a JSON array';
      for (let i = 0; i < parsed.length; i++) {
        const item = parsed[i];
        if (!item.type) return `Item ${i}: missing "type"`;
        if (!item.docTitle) return `Item ${i}: missing "docTitle"`;
      }
      return null;
    } catch (err) {
      return `Invalid JSON: ${err.message}`;
    }
  }

  function handleJsonChange(raw) {
    setJson(raw);
    setParseError(validateJson(raw));
    setResult(null);
    setError(null);
  }

  async function handleInsert() {
    const validationErr = validateJson(json);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setInserting(true);
    setError(null);
    try {
      const items = JSON.parse(json);
      const res = await insertContentList(items);
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setInserting(false);
    }
  }

  const itemCount = (() => {
    try { return JSON.parse(json).length; } catch { return 0; }
  })();

  return (
    <section className="panel panel-pad rag-panel">
      <div className="eyebrow">Layer 35</div>
      <h2>Direct Content Insertion</h2>
      <p className="muted">
        Paste a JSON array of pre-parsed content items to insert directly
        into the multimodal index (Layer 33). No markdown parsing needed —
        external parsers (MinerU, Docling, Obsidian, MCP tools) emit
        structured JSON and feed it straight in.
      </p>

      <div className="rag-status-row">
        <div className="metric">
          <small>Current index</small>
          <strong>{mmStatus.indexed ? `${mmStatus.stats.items} items` : 'empty'}</strong>
        </div>
        <div className="metric">
          <small>Items to insert</small>
          <strong style={{ color: parseError ? '#ff8090' : '#7dd87f' }}>
            {parseError ? '—' : itemCount}
          </strong>
        </div>
        <div className="metric">
          <small>Validation</small>
          <strong style={{ color: parseError ? '#ff8090' : '#7dd87f' }}>
            {parseError ? 'error' : 'valid'}
          </strong>
        </div>
      </div>

      <label className="muted small-note">
        JSON content list — each item needs <code>type</code> + <code>docTitle</code>
      </label>
      <textarea
        className="rag-docs-input"
        value={json}
        onChange={(e) => handleJsonChange(e.target.value)}
        rows={16}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
        placeholder='[{ "type": "text", "docTitle": "Doc", "text": "..." }]'
      />

      {parseError && (
        <p className="rag-error small-note">{parseError}</p>
      )}

      <div className="rag-actions">
        <button
          className="primary"
          onClick={handleInsert}
          disabled={inserting || !!parseError}
        >
          {inserting ? 'Inserting…' : mmStatus.indexed ? 'Append to index' : 'Create index'}
        </button>
      </div>

      {error && <p className="rag-error small-note">{error}</p>}

      {result && (
        <p className="muted small-note" style={{ color: '#7dd87f' }}>
          Inserted {result.added} items → total {result.total} in index.
          Mode: {result.usingEmbeddings ? 'embeddings' : 'BM25'}.
        </p>
      )}

      <details style={{ marginTop: 12 }}>
        <summary className="muted small-note" style={{ cursor: 'pointer' }}>
          Schema reference
        </summary>
        <pre className="muted small-note" style={{ fontSize: 11, background: '#0f1218', padding: 8, borderRadius: 4 }}>
{`type: "text"     → { docTitle, section?, text }
type: "image"    → { docTitle, section?, src?, alt?, caption? }
type: "table"    → { docTitle, section?, headers[], rows[][], caption? }
type: "equation" → { docTitle, section?, latex, caption? }
type: "code"     → { docTitle, section?, lang, code }`}
        </pre>
      </details>
    </section>
  );
}
