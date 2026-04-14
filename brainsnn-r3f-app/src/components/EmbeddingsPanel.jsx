import React, { useEffect, useState } from 'react';
import {
  initEmbeddings, subscribeStatus, getEmbeddingStatus, clearEmbeddingCache, embed
} from '../utils/embeddings';

/**
 * Layer 24 — Real Embeddings Panel
 *
 * Opt-in to real semantic embeddings via transformers.js loaded from CDN.
 * Model: Xenova/all-MiniLM-L6-v2 (~25MB on first use, cached by browser).
 * Once loaded, Layer 20 hybrid search uses cosine similarity instead of
 * trigram Jaccard; Layer 18 classification can query by meaning.
 */
export default function EmbeddingsPanel() {
  const [status, setStatus] = useState(getEmbeddingStatus());
  const [testQuery, setTestQuery] = useState('authentication login flow');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => subscribeStatus(setStatus), []);

  async function handleEnable() {
    try {
      await initEmbeddings();
    } catch {
      // status already captures the error
    }
  }

  async function handleTest() {
    if (!testQuery.trim()) return;
    setTesting(true);
    try {
      const t0 = performance.now();
      const vec = await embed(testQuery);
      const dt = performance.now() - t0;
      setTestResult({
        dim: vec.length,
        ms: dt.toFixed(0),
        preview: Array.from(vec.slice(0, 8)).map((v) => v.toFixed(3)).join(', ')
      });
    } catch (err) {
      setTestResult({ error: err.message });
    } finally {
      setTesting(false);
    }
  }

  const isReady = status.state === 'ready';
  const isLoading = status.state === 'loading' || status.state === 'model-loading';

  return (
    <section className="panel panel-pad embeddings-panel">
      <div className="eyebrow">Layer 24</div>
      <h2>Real Embeddings · transformers.js</h2>
      <p className="muted">
        Opt-in to real semantic embeddings via <code>Xenova/all-MiniLM-L6-v2</code> (384-dim, quantized).
        Loaded from <code>esm.run</code> CDN on demand — no build dependency. Once ready, Layer 20 hybrid
        search and Layer 18 classification swap trigram Jaccard for cosine similarity on real embeddings.
      </p>

      <div className="embeddings-status">
        <div className="embeddings-status-row">
          <span className="muted small-note">Status:</span>
          <strong className={`embeddings-state embeddings-state-${status.state}`}>
            {labelForState(status.state)}
          </strong>
        </div>
        <div className="embeddings-status-row">
          <span className="muted small-note">Model:</span>
          <code>{status.modelId}</code>
        </div>
        <div className="embeddings-status-row">
          <span className="muted small-note">Cache:</span>
          <strong>{status.cacheSize ?? 0} embeddings</strong>
        </div>
        {status.error && (
          <div className="embeddings-error">{status.error}</div>
        )}
      </div>

      <div className="embeddings-actions">
        {!isReady && (
          <button
            className="primary"
            onClick={handleEnable}
            disabled={isLoading}
          >
            {isLoading ? labelForState(status.state) : 'Enable real embeddings'}
          </button>
        )}
        {isReady && (
          <>
            <button className="ghost" onClick={clearEmbeddingCache}>Clear cache</button>
          </>
        )}
      </div>

      {isReady && (
        <div className="embeddings-test">
          <label className="muted small-note">Test embed:</label>
          <div className="embeddings-test-row">
            <input
              className="embeddings-test-input"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTest()}
            />
            <button className="ghost" onClick={handleTest} disabled={testing}>
              {testing ? 'Embedding…' : 'Embed'}
            </button>
          </div>
          {testResult && (
            <div className="embeddings-test-result muted small-note">
              {testResult.error ? (
                <span style={{ color: '#ff8090' }}>{testResult.error}</span>
              ) : (
                <>
                  Dim <strong>{testResult.dim}</strong> · <strong>{testResult.ms}ms</strong>
                  <br />
                  <code>[{testResult.preview}…]</code>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <p className="muted small-note">
        First use downloads ~25MB of model weights (cached by the browser for future sessions).
        All processing runs client-side — text never leaves the browser.
      </p>
    </section>
  );
}

function labelForState(s) {
  switch (s) {
    case 'idle': return 'Not loaded';
    case 'loading': return 'Loading library from CDN…';
    case 'model-loading': return 'Downloading model weights (~25MB)…';
    case 'ready': return 'Ready';
    case 'error': return 'Error';
    default: return s;
  }
}
