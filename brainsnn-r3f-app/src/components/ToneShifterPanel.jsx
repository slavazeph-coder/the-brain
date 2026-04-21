import React, { useState } from 'react';
import { SHIFT_STYLES, shiftTone, TONE_EXAMPLE } from '../utils/toneShifter';

/**
 * Layer 68 — Tone Shifter panel.
 */
export default function ToneShifterPanel() {
  const [text, setText] = useState(TONE_EXAMPLE);
  const [styleId, setStyleId] = useState('urgency');
  const [result, setResult] = useState(null);

  function run() {
    setResult(shiftTone(text, styleId));
  }

  return (
    <section className="panel panel-pad tone-shifter-panel">
      <div className="eyebrow">Layer 68 · tone shifter · defensive training only</div>
      <h2>What manipulation drift looks like</h2>
      <p className="muted">
        The opposite of Counter-Draft: inject a chosen manipulation style
        into neutral text so you can see what your writing would sound like
        if it drifted into that genre. For red-team training, adversarial
        sample creation, and "have I been writing like this lately?"
        self-audit.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <label className="muted small-note">Style:</label>
        <select
          className="share-input"
          value={styleId}
          onChange={(e) => setStyleId(e.target.value)}
          style={{ flex: 1, maxWidth: 280 }}
        >
          {SHIFT_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <button className="btn primary" onClick={run} disabled={text.trim().length < 5}>
          Apply style
        </button>
      </div>

      <textarea
        className="firewall-input"
        placeholder="Neutral text you want to see drifted…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        style={{ marginTop: 10 }}
      />

      {result?.ok && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              borderLeft: '3px solid #dd6974',
              background: 'rgba(221,105,116,0.08)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <strong>{result.style.label} drift</strong>
              <span style={{ color: '#dd6974', fontFamily: 'monospace' }}>
                {Math.round(result.beforePressure * 100)}% → {Math.round(result.afterPressure * 100)}% · +{Math.round(result.increase * 100)} pts
              </span>
            </div>
            <p className="muted small-note" style={{ margin: 0 }}>{result.style.desc}</p>
            <p style={{ marginTop: 8, fontStyle: 'italic', lineHeight: 1.45 }}>
              "{result.after}"
            </p>
            <div className="control-actions" style={{ marginTop: 8 }}>
              <button
                className="btn-sm"
                onClick={() => navigator.clipboard?.writeText(result.after).catch(() => {})}
              >
                Copy drifted text
              </button>
            </div>
          </div>
        </div>
      )}
      {result?.error && <p className="muted" style={{ color: '#dd6974' }}>{result.error}</p>}
    </section>
  );
}
