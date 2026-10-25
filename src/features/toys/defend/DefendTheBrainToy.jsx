import React, { useState } from 'react';
import { getToy } from '../toyConfig.js';
import { ToyPage, SponsorSlot } from '../ToyChrome.jsx';
import { analyzeContentLocally } from '../../../lib/analysisEngine.js';

const TOY = getToy('defend') || {
  id: 'defend',
  title: 'Defend the Brain',
  hook: 'Shield the connectome',
  blurb: 'Neutralise high-pressure manipulation waves with evidence-backed counter-drafts.',
};

export function DefendTheBrainToy() {
  const [counterDraft, setCounterDraft] = useState(
    'Here is the measured benchmark data, methodology, and peer-reviewed source links so you can evaluate at your own pace.',
  );
  const scan = analyzeContentLocally({ content: counterDraft, contentType: 'text', forceFallback: true });
  const shieldStrength = Math.max(0, Math.min(100, scan.metrics.trust - Math.round((scan.metrics.fear + scan.metrics.urgency) / 4)));

  return (
    <ToyPage toy={TOY}>
      <section className="toy-page" data-testid="defend-the-brain">
        <p className="bh-kicker">TOY · DEFEND THE BRAIN</p>
        <h1>Shield the network with evidence-anchored phrasing</h1>
        <p>Write a calm, transparent response to raise cortical shield coherence and dampen incoming fear cascades.</p>
        <SponsorSlot toyId="defend" />
        <textarea
          rows={4}
          value={counterDraft}
          onChange={(e) => setCounterDraft(e.target.value)}
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
            <h2>Shield Coherence: {shieldStrength}%</h2>
            <p>
              Trust anchor: <strong>{scan.metrics.trust}/100</strong> · Urgency pressure:{' '}
              <strong>{scan.metrics.urgency}/100</strong>
            </p>
          </article>
        </div>
      </section>
    </ToyPage>
  );
}
