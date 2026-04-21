import React, { useMemo, useState } from 'react';
import { analyzeEchoes, echoRisk } from '../utils/echoDetector';

const EXAMPLE = [
  'BREAKING: URGENT action required. Sign before midnight or you lose access.',
  'URGENT — action required. Sign before midnight or lose access to your account.',
  "Heads up, the review meeting got moved to Thursday. No other changes, docs are in the folder.",
  "Let me know if Thursday still works after the shift change — otherwise we can push to next week.",
  'BREAKING: Action required URGENTLY. Sign before midnight, otherwise you lose access.',
  'Breaking: immediate action required. Sign tonight or access will be revoked.',
].join('\n---\n');

function splitItems(raw) {
  return String(raw || '')
    .split(/\n[\-=]{3,}\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Layer 53 — Echo Detector panel.
 * Paste multiple messages separated by --- lines. Get cluster
 * detection + coordinated-campaign risk tier.
 */
export default function EchoPanel() {
  const [raw, setRaw] = useState('');
  const items = useMemo(() => splitItems(raw).map((text, idx) => ({ id: idx + 1, text })), [raw]);
  const result = useMemo(() => items.length >= 2 ? analyzeEchoes(items) : null, [items]);
  const risk = result ? echoRisk(result) : null;

  return (
    <section className="panel panel-pad echo-panel">
      <div className="eyebrow">Layer 53 · echo detector</div>
      <h2>Coordinated campaign?</h2>
      <p className="muted">
        Paste multiple messages separated by <code>---</code>. If several share
        long n-grams, they're probably echoes of the same underlying script —
        a classic signature of coordinated amplification or bot networks.
      </p>

      <div className="control-actions" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={() => setRaw(EXAMPLE)}>Try example</button>
        <button className="btn" onClick={() => setRaw('')} disabled={!raw}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder={`Message 1...\n---\nMessage 2...\n---\nMessage 3...`}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
      />

      {result && risk && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${risk.color}14`,
              borderLeft: `3px solid ${risk.color}`,
            }}
          >
            <span>
              <strong>{result.total}</strong> messages · <strong>{result.echoed}</strong> echoed ·{' '}
              <strong>{result.clusters.length}</strong> cluster{result.clusters.length === 1 ? '' : 's'}
            </span>
            <strong style={{ color: risk.color }}>{risk.label}</strong>
          </div>

          {result.clusters.length > 0 ? (
            result.clusters.map((c) => (
              <div
                key={c.id}
                style={{
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 8,
                  borderLeft: '3px solid #dd6974',
                  background: 'rgba(221,105,116,0.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{c.id}</strong>
                  <span className="muted small-note">{c.size} messages</span>
                </div>
                <p className="muted" style={{ margin: '4px 0', fontStyle: 'italic' }}>
                  exemplar: "{c.exemplar}"
                </p>
                <div className="muted small-note">
                  members: {c.members.map((m) => `#${m.id}`).join(', ')}
                </div>
              </div>
            ))
          ) : (
            <p className="muted small-note" style={{ marginTop: 10 }}>
              No duplicate clusters found — messages appear distinct.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
