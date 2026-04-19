import React, { useEffect, useState } from 'react';

const HANDLE_KEY = 'brainsnn_handle_v1';

function readHandle() {
  try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; }
}
function writeHandle(h) {
  try { localStorage.setItem(HANDLE_KEY, h); } catch { /* quota */ }
}

/**
 * Community "break the firewall" submissions. Extends Layer 25 (Red Team)
 * into an ongoing adversarial loop — any bypass (pressure < 0.4) gets
 * published on the weekly feed so the community can see what's evading
 * the scanner and help evolve Layer 31.
 */
export default function BypassSubmitPanel() {
  const [handle, setHandle] = useState(readHandle());
  const [text, setText] = useState('');
  const [intent, setIntent] = useState('manipulate');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [feed, setFeed] = useState(null);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { writeHandle(handle); }, [handle]);

  useEffect(() => { loadFeed(); }, []);

  async function loadFeed() {
    setLoadingFeed(true);
    try {
      const r = await fetch('/api/attacks');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setFeed(await r.json());
    } catch (e) {
      setErr(e.message || 'load failed');
    } finally {
      setLoadingFeed(false);
    }
  }

  async function submit() {
    if (text.trim().length < 20) return;
    setSubmitting(true);
    setResult(null);
    setErr('');
    try {
      const r = await fetch('/api/attacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), intent: intent.trim(), handle: handle.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        setResult({ error: data.error || `HTTP ${r.status}` });
        return;
      }
      setResult(data);
      loadFeed();
    } catch (e) {
      setResult({ error: e.message || 'submit failed' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel panel-pad bypass-submit-panel">
      <div className="eyebrow">Weekly adversarial feed · Layer 25 extension</div>
      <h2>Break the Firewall</h2>
      <p className="muted">
        Write an attack string that tries to manipulate without tripping the
        Cognitive Firewall. Anything that scores under 40% pressure is
        published on the weekly bypass feed for the evolve loop (Layer 31)
        to catch next round.
      </p>

      <div className="bypass-handle" style={{ marginTop: 10 }}>
        <label className="share-label" htmlFor="bypass-handle-input">Handle</label>
        <input
          id="bypass-handle-input"
          className="share-input"
          placeholder="anon"
          value={handle}
          onChange={(e) => setHandle(e.target.value.slice(0, 24))}
          maxLength={24}
          style={{ marginTop: 6 }}
        />
      </div>

      <textarea
        className="firewall-input"
        placeholder="Craft your bypass — urgency, outrage, certainty, fear — but disguise it..."
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 600))}
        rows={4}
        style={{ marginTop: 10 }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <label className="muted small-note" htmlFor="bypass-intent">Intent tag:</label>
        <input
          id="bypass-intent"
          className="share-input"
          placeholder="manipulate"
          value={intent}
          onChange={(e) => setIntent(e.target.value.slice(0, 80))}
          maxLength={80}
          style={{ flex: 1 }}
        />
        <span className="muted small-note">{text.length}/600</span>
      </div>

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button
          className="btn primary"
          onClick={submit}
          disabled={submitting || text.trim().length < 20}
        >
          {submitting ? 'Submitting…' : 'Submit bypass attempt'}
        </button>
        <button className="btn" onClick={loadFeed} disabled={loadingFeed}>
          {loadingFeed ? 'Loading…' : 'Refresh feed'}
        </button>
      </div>

      {result?.error && (
        <p className="muted" style={{ color: '#dd6974', marginTop: 6 }}>{result.error}</p>
      )}
      {result?.ok && (
        <p style={{ marginTop: 10, color: result.bypass ? '#5ee69a' : '#fdab43' }}>
          {result.message}
        </p>
      )}
      {err && <p className="muted small-note" style={{ color: '#dd6974' }}>Feed error: {err}</p>}

      {feed && (
        <div className="bypass-feed" style={{ marginTop: 14 }}>
          <div className="immunity-events-head">
            <strong>This week's bypasses · {feed.week}</strong>
            <span className="muted small-note">
              {feed.bypassed?.length || 0} bypassed · {feed.total || 0} total
            </span>
          </div>
          {feed.bypassed?.length ? (
            feed.bypassed.map((e, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 10px',
                  borderLeft: '3px solid #5ee69a',
                  background: 'rgba(94,230,154,0.05)',
                  borderRadius: 6,
                  marginTop: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{e.handle || 'anon'}</strong>
                  <span className="muted small-note">
                    {(e.pressure * 100).toFixed(0)}% pressure · {e.intent || 'manipulate'}
                  </span>
                </div>
                <p className="muted" style={{ margin: 0, fontStyle: 'italic' }}>
                  "{(e.text || '').slice(0, 200)}{(e.text || '').length > 200 ? '…' : ''}"
                </p>
              </div>
            ))
          ) : (
            <p className="muted small-note" style={{ marginTop: 8 }}>
              No bypasses this week yet — yours could be the first.
            </p>
          )}
          {feed.backend === 'memory' && (
            <p className="muted small-note" style={{ marginTop: 6 }}>
              (Feed runs in ephemeral mode — set UPSTASH_REDIS_REST_URL to persist.)
            </p>
          )}
        </div>
      )}
    </section>
  );
}
