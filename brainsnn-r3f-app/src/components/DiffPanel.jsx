import React, { useMemo, useState } from 'react';
import { runDiff, diffVerdict, buildDiffPayload, diffUrl, DIFF_EXAMPLE } from '../utils/diffMode';

/**
 * Layer 47 — Diff Mode panel.
 * Two textareas side-by-side, live comparison, share as /v/<hash>.
 */
export default function DiffPanel() {
  const [labelA, setLabelA] = useState('A');
  const [textA, setTextA] = useState('');
  const [labelB, setLabelB] = useState('B');
  const [textB, setTextB] = useState('');
  const [copied, setCopied] = useState(false);

  const diff = useMemo(() => {
    if (!textA.trim() || !textB.trim()) return null;
    return runDiff({ labelA, textA, labelB, textB });
  }, [labelA, textA, labelB, textB]);
  const verdict = diff ? diffVerdict(diff.absDelta) : null;

  async function handleShare() {
    if (!diff) return;
    const url = diffUrl(window.location.origin, buildDiffPayload(diff));
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy diff URL:', url);
    }
  }

  function loadExample() {
    setLabelA(DIFF_EXAMPLE.labelA);
    setTextA(DIFF_EXAMPLE.textA);
    setLabelB(DIFF_EXAMPLE.labelB);
    setTextB(DIFF_EXAMPLE.textB);
  }

  return (
    <section className="panel panel-pad diff-panel">
      <div className="eyebrow">Layer 47 · diff mode</div>
      <h2>A vs B</h2>
      <p className="muted">
        Drop two pieces of text in. See the manipulation delta side-by-side.
        Perfect for candidate statements, before/after edits, or quoted
        versus summarized framings.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
        <div>
          <input
            className="share-input"
            value={labelA}
            onChange={(e) => setLabelA(e.target.value.slice(0, 24))}
            placeholder="Label A"
            style={{ marginBottom: 6 }}
          />
          <textarea
            className="firewall-input"
            placeholder="Paste text A…"
            value={textA}
            onChange={(e) => setTextA(e.target.value)}
            rows={6}
          />
        </div>
        <div>
          <input
            className="share-input"
            value={labelB}
            onChange={(e) => setLabelB(e.target.value.slice(0, 24))}
            placeholder="Label B"
            style={{ marginBottom: 6 }}
          />
          <textarea
            className="firewall-input"
            placeholder="Paste text B…"
            value={textB}
            onChange={(e) => setTextB(e.target.value)}
            rows={6}
          />
        </div>
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={loadExample}>Try example</button>
        <button
          className="btn"
          onClick={() => { setTextA(''); setTextB(''); setLabelA('A'); setLabelB('B'); }}
          disabled={!textA && !textB}
        >
          Clear
        </button>
        {diff && (
          <button className="btn primary" onClick={handleShare}>
            {copied ? 'Link copied ✓' : 'Share diff'}
          </button>
        )}
      </div>

      {diff && verdict && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${verdict.color}14`,
              borderLeft: `3px solid ${verdict.color}`,
            }}
          >
            <span>
              <strong>{diff.a.label}</strong> {Math.round(diff.a.pressure * 100)}% · <strong>{diff.b.label}</strong> {Math.round(diff.b.pressure * 100)}%
            </span>
            <strong style={{ color: verdict.color }}>
              {diff.winner ? `${diff.winner === 'A' ? diff.a.label : diff.b.label} cleaner` : 'Tied'} · {verdict.label} · Δ{Math.round(diff.absDelta * 100)} pts
            </strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            {[diff.a, diff.b].map((side, i) => (
              <div
                key={i}
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  borderLeft: `3px solid ${side.pressure > 0.5 ? '#dd6974' : side.pressure > 0.25 ? '#fdab43' : '#6daa45'}`,
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <strong>{side.label}</strong>
                  <span>{Math.round(side.pressure * 100)}%</span>
                </div>
                <div className="muted small-note">
                  {side.templates.length > 0
                    ? side.templates.map((t) => t.label).join(', ')
                    : 'no templates detected'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
