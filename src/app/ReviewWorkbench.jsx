import React, { useState } from 'react';
import { analyzeContentLocally } from '../lib/analysisEngine.js';
import { computeFirewall } from '../lib/firewallLayer.js';

export function ReviewWorkbench({ initialInput = '' }) {
  const [text, setText] = useState(
    initialInput || 'Act now! Limited window before access closes forever — verify our published benchmark data.',
  );
  const [result, setResult] = useState(() => {
    const base = analyzeContentLocally({ content: text, contentType: 'text', forceFallback: true });
    const firewall = computeFirewall({ content: text, metrics: base.metrics, isFallback: true });
    return { base, firewall };
  });

  function runScan(e) {
    e.preventDefault();
    const base = analyzeContentLocally({ content: text, contentType: 'text', forceFallback: true });
    const firewall = computeFirewall({ content: text, metrics: base.metrics, isFallback: true });
    setResult({ base, firewall });
  }

  return (
    <main id="review-main" className="lab-index" data-testid="review-workbench">
      <p className="bh-kicker">OFFICE · REVIEW WORKBENCH</p>
      <h1>Inspect manipulation pressure &amp; signal cues</h1>
      <p>
        Deterministic client-side cognitive firewall and affective cue readout. Scores reflect lexical and structural patterns in the draft.
      </p>
      <form onSubmit={runScan} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '1.25rem' }}>
        <textarea
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a passage or draft to inspect…"
          style={{
            width: '100%',
            padding: '0.9rem',
            borderRadius: '0.65rem',
            background: '#0f1422',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#f1f5f9',
            fontFamily: 'inherit',
          }}
        />
        <div>
          <button type="submit" className="bh-button bh-primary">
            Analyze passage
          </button>
        </div>
      </form>

      {result && (
        <section className="lab-cards" style={{ marginTop: '1.5rem' }}>
          <article className="lab-card">
            <h2>Summary</h2>
            <p>{result.base.summary}</p>
            <p>
              <strong>Risk rating:</strong> {result.base.riskRating} · <strong>Firing rate:</strong>{' '}
              {result.base.metrics.firingRate} Hz
            </p>
          </article>
          <article className="lab-card">
            <h2>Signal Breakdown</h2>
            <p>
              Urgency: <strong>{result.base.metrics.urgency}</strong> · Fear: <strong>{result.base.metrics.fear}</strong> ·
              Trust: <strong>{result.base.metrics.trust}</strong>
            </p>
            <p>{result.base.riskDescription}</p>
          </article>
        </section>
      )}
    </main>
  );
}
