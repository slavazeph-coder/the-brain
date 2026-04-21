import React, { useMemo, useState } from 'react';
import { analyzeInbox, inboxSummary, buildInboxPayload, inboxUrl, INBOX_EXAMPLE } from '../utils/inbox';

/**
 * Layer 44 — Inbox Mode panel.
 * Paste delimited messages, get a ranked triage list, share an anonymized
 * summary via /n/<hash>.
 */
export default function InboxPanel() {
  const [raw, setRaw] = useState('');
  const [title, setTitle] = useState('');
  const [copied, setCopied] = useState(false);

  const items = useMemo(() => raw.trim() ? analyzeInbox(raw) : [], [raw]);
  const summary = useMemo(() => inboxSummary(items), [items]);

  async function handleShare() {
    if (!items.length) return;
    const payload = buildInboxPayload({ title, items });
    const url = inboxUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy anonymized inbox URL:', url);
    }
  }

  function handleTweet() {
    if (!items.length) return;
    const payload = buildInboxPayload({ title, items });
    const url = inboxUrl(window.location.origin, payload);
    const tweet = `Inbox triage: ${summary.count} messages · ${summary.high} high-pressure · mean ${Math.round(summary.meanPressure * 100)}%. ${url}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, '_blank', 'noopener');
  }

  return (
    <section className="panel panel-pad inbox-panel">
      <div className="eyebrow">Layer 44 · inbox mode</div>
      <h2>Bulk triage</h2>
      <p className="muted">
        Paste emails, DMs, or tickets separated by <code>---</code> (or
        <code>From: </code> headers). You get a pressure-ranked list,
        per-item templates, and a shareable anonymized summary.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          className="share-input"
          placeholder="Title (optional) — e.g. 'Monday inbox'"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 48))}
          maxLength={48}
          style={{ flex: 1 }}
        />
      </div>

      <textarea
        className="firewall-input"
        placeholder={"From: sender@example.com\nSubject: URGENT...\nBody...\n\n---\n\nFrom: ..."}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
      />

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => setRaw(INBOX_EXAMPLE)}>Try example</button>
        <button className="btn" onClick={() => setRaw('')} disabled={!raw}>Clear</button>
        {items.length > 0 && (
          <>
            <button className="btn primary" onClick={handleShare}>
              {copied ? 'Link copied ✓' : 'Share anonymized'}
            </button>
            <button className="btn" onClick={handleTweet}>Tweet</button>
          </>
        )}
      </div>

      {items.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              marginBottom: 12,
            }}
          >
            <span>
              <strong>{summary.count}</strong> messages · mean{' '}
              <strong>{Math.round(summary.meanPressure * 100)}%</strong> ·{' '}
              <strong>{summary.high}</strong> high-pressure
            </span>
            <span className="muted">sorted by pressure</span>
          </div>

          {items.map((it) => (
            <div
              key={it.idx}
              style={{
                padding: '10px 12px',
                borderLeft: `3px solid ${it.pressure > 0.55 ? '#dd6974' : it.pressure > 0.3 ? '#fdab43' : '#6daa45'}`,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 6,
                marginTop: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <strong>{it.subject || '(no subject)'}</strong>
                <span style={{ color: '#cbd5e1' }}>
                  {Math.round(it.pressure * 100)}%
                </span>
              </div>
              <div className="muted small-note" style={{ marginBottom: 4 }}>
                from <strong>{it.from || 'unknown'}</strong>
                {it.templates.length > 0 && (
                  <> · templates: {it.templates.map((t) => t.label).join(', ')}</>
                )}
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.4 }}>
                {it.text.slice(0, 220)}{it.text.length > 220 ? '…' : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
