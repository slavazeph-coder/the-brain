import React, { useRef, useState } from 'react';

/**
 * Layer 54 — Public API docs panel.
 * Documents POST /api/score + the OpenAPI spec, with a live-test
 * button that hits the endpoint from the browser.
 */
const EXAMPLE_TEXT = "URGENT: you won't believe what they covered up. Everyone knows the truth — act now!";

export default function ApiDocsPanel() {
  const [text, setText] = useState(EXAMPLE_TEXT);
  const [apiKey, setApiKey] = useState('demo-public-launch-key');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [streamEvents, setStreamEvents] = useState([]);
  const [streaming, setStreaming] = useState(false);

  async function tryIt() {
    setLoading(true); setErr(''); setResult(null);
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
        body: JSON.stringify({ text }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || `HTTP ${r.status}`); return; }
      setResult(data);
    } catch (e) {
      setErr(e.message || 'request failed');
    } finally {
      setLoading(false);
    }
  }

  async function tryStream() {
    setStreaming(true); setStreamEvents([]); setErr('');
    try {
      const r = await fetch('/api/score/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok || !r.body) {
        setErr(`HTTP ${r.status}`);
        return;
      }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split('\n\n');
        buf = chunks.pop() || '';
        for (const chunk of chunks) {
          const lines = chunk.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7);
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          try {
            setStreamEvents((prev) => [...prev, { event, data: JSON.parse(data || '{}') }]);
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      setErr(e.message || 'stream failed');
    } finally {
      setStreaming(false);
    }
  }

  const verticalUrl = `/api/og?size=vertical&h=eyJ0IjoiVVJHRU5UOiBzaG9ja2luZyBzY2FuZGFsISIsImUiOjAuNzIsImMiOjAuNjQsIm0iOjAuNjgsInUiOjAuNTEsImEiOiJvdXRyYWdlIiwidHMiOjF9`;

  const curl = `curl -X POST https://brainsnn.com/api/score \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${apiKey || '<your-key>'}" \\
  -d '${JSON.stringify({ text }).replace(/'/g, "'\"'\"'")}'`;

  return (
    <section className="panel panel-pad api-docs-panel">
      <div className="eyebrow">Layer 54 · public API</div>
      <h2>POST /api/score</h2>
      <p className="muted">
        Same Cognitive Firewall the panel uses, behind a plain REST
        endpoint. 20 req/min per IP, English + Spanish + French packs
        auto-detected, every response ships with a verifiable Receipt.
        Spec: <code>GET /api/openapi.json</code>
      </p>

      <label className="share-label" style={{ marginTop: 10, display: 'block' }}>API key</label>
      <input
        className="share-input"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="demo-public-launch-key"
        style={{ marginTop: 4 }}
      />

      <label className="share-label" style={{ marginTop: 10, display: 'block' }}>Text to score</label>
      <textarea
        className="firewall-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={tryIt} disabled={loading || text.trim().length < 5}>
          {loading ? 'Scoring…' : 'Try it live'}
        </button>
        <button className="btn" onClick={tryStream} disabled={streaming || text.trim().length < 5}>
          {streaming ? 'Streaming…' : 'Stream (SSE · L76)'}
        </button>
        <a className="btn" href={verticalUrl} target="_blank" rel="noreferrer">
          Vertical card (L78)
        </a>
      </div>

      {streamEvents.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(90,212,255,0.06)',
            borderLeft: '3px solid #5ad4ff',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          {streamEvents.map((ev, i) => (
            <div key={i} style={{ padding: '2px 0', color: ev.event === 'final' ? '#5ee69a' : '#cbd5e1' }}>
              <strong style={{ color: '#5ad4ff' }}>{ev.event}</strong>{' '}
              <span>{JSON.stringify(ev.data)}</span>
            </div>
          ))}
        </div>
      )}

      {err && <p className="muted" style={{ color: '#dd6974', marginTop: 8 }}>Error: {err}</p>}

      {result && (
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(94,230,154,0.06)',
            borderLeft: '3px solid #5ee69a',
            fontFamily: 'monospace',
            fontSize: 12,
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {JSON.stringify(result, null, 2)}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="eyebrow">cURL</div>
        <pre
          style={{
            marginTop: 6,
            padding: 12,
            borderRadius: 8,
            background: 'rgba(0,0,0,0.28)',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >{curl}</pre>
      </div>
    </section>
  );
}
