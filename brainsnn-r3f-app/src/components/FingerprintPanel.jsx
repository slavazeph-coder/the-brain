import React, { useMemo, useState } from 'react';
import {
  fingerprint, compareFingerprints, similarityVerdict, FEATURE_LABELS,
} from '../utils/styleFingerprint';

/**
 * Layer 51 — Style Fingerprint panel.
 * Left textarea = reference text, right = challenger. Produces a
 * "same author?" cosine similarity + feature bars.
 */
export default function FingerprintPanel() {
  const [textA, setTextA] = useState('');
  const [textB, setTextB] = useState('');

  const fpA = useMemo(() => fingerprint(textA), [textA]);
  const fpB = useMemo(() => fingerprint(textB), [textB]);
  const sim = useMemo(() => compareFingerprints(fpA, fpB), [fpA, fpB]);
  const verdict = similarityVerdict(sim);

  return (
    <section className="panel panel-pad fingerprint-panel">
      <div className="eyebrow">Layer 51 · style fingerprint</div>
      <h2>Same author?</h2>
      <p className="muted">
        12 stylometric features per text: sentence-length distribution,
        function-word frequency, punctuation rhythm, CAPS-run density,
        hedging rate. Similar fingerprints = plausibly same author.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
        <textarea
          className="firewall-input"
          placeholder="Paste text A (at least 20 chars)"
          value={textA}
          onChange={(e) => setTextA(e.target.value)}
          rows={6}
        />
        <textarea
          className="firewall-input"
          placeholder="Paste text B (at least 20 chars)"
          value={textB}
          onChange={(e) => setTextB(e.target.value)}
          rows={6}
        />
      </div>

      {fpA.stats && fpB.stats && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: `${verdict.color}14`,
              borderLeft: `3px solid ${verdict.color}`,
            }}
          >
            <span>
              Cosine similarity <strong>{(sim * 100).toFixed(1)}%</strong>
            </span>
            <strong style={{ color: verdict.color }}>{verdict.label}</strong>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">Feature-by-feature</div>
            {FEATURE_LABELS.map((label, i) => (
              <div key={label} style={{ display: 'grid', gridTemplateColumns: '170px 1fr 1fr', gap: 6, alignItems: 'center', marginTop: 6 }}>
                <span className="muted small-note">{label}</span>
                <div style={{ width: '100%', height: 8, background: '#1a1f2e', borderRadius: 999 }}>
                  <div style={{ width: `${fpA.vector[i] * 100}%`, height: '100%', background: '#77dbe4', borderRadius: 999 }} />
                </div>
                <div style={{ width: '100%', height: 8, background: '#1a1f2e', borderRadius: 999 }}>
                  <div style={{ width: `${fpB.vector[i] * 100}%`, height: '100%', background: '#fdab43', borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
