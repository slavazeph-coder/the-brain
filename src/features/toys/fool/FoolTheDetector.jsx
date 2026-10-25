import React, { useState } from 'react';
import { getToy } from '../toyConfig.js';
import { ToyPage, SponsorSlot } from '../ToyChrome.jsx';
import { computeFirewall } from '../../../lib/firewallLayer.js';
import { analyzeContentLocally } from '../../../lib/analysisEngine.js';

const TOY = getToy('fool') || {
  id: 'fool',
  title: 'Fool the Detector',
  hook: 'Beat the firewall',
  blurb: 'Rewrite a manipulative pitch so it keeps its call-to-action without tripping the detector.',
};

export function FoolTheDetector() {
  const [draft, setDraft] = useState(
    'URGENT: Act immediately before your account is locked forever! Last chance to claim your spot!',
  );
  const base = analyzeContentLocally({ content: draft, contentType: 'text', forceFallback: true });
  const firewall = computeFirewall({ content: draft, metrics: base.metrics, isFallback: true });
  const pressure = firewall?.overallPressure ?? Math.round((base.metrics.fear + base.metrics.urgency + base.metrics.anger) / 3);
  const passed = pressure < 35 && draft.trim().length >= 25;

  return (
    <ToyPage toy={TOY}>
      <section className="toy-page" data-testid="fool-the-detector">
        <p className="bh-kicker">TOY · FOOL THE DETECTOR</p>
        <h1>Slip a pitch past the Cognitive Firewall</h1>
        <p>
          Keep a clear call-to-action of at least 25 characters while bringing manipulation pressure below 35/100.
        </p>
        <SponsorSlot toyId="fool" />
        <textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{
            width: '100%',
            marginTop: '1rem',
            padding: '0.85rem',
            borderRadius: '0.65rem',
            background: '#0f1422',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#f1f5f9',
          }}
        />
        <div className="lab-cards" style={{ marginTop: '1rem' }}>
          <article className="lab-card">
            <h2>Detector Readout</h2>
            <p>
              Manipulation Pressure: <strong>{pressure}/100</strong> · Status:{' '}
              <strong style={{ color: passed ? '#10b981' : '#f43f5e' }}>
                {passed ? 'Passed below threshold!' : 'Flagged by firewall'}
              </strong>
            </p>
          </article>
        </div>
      </section>
    </ToyPage>
  );
}
