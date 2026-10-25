import React from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';

export function CoherenceLanding({ onStart }) {
  return (
    <div className="bh-site" data-testid="coherence-landing">
      <PublicNav active="lab" />
      <main className="lab-index">
        <p className="bh-kicker">VIDEO COHERENCE BENCHMARK</p>
        <h1>Temporal Coherence &amp; Quality Gate Evidence</h1>
        <p>
          Fixed-pass evaluation of native 720p house walkthrough sequences, comparing frame-to-frame optical flow stability, edge preservation, and quality gate thresholds.
        </p>
        <div className="lab-cards">
          <article className="lab-card">
            <h2>Native 720p House Pass</h2>
            <p>Measured optical flow warp error and boundary flicker across held-out interior camera trajectories.</p>
            <a href="/coherence-evidence.html">Open full evidence report →</a>
          </article>
          <article className="lab-card">
            <h2>Passage &amp; Claim Review</h2>
            <p>Inspect claim boundaries and deterministic verification receipts in the Review Workbench.</p>
            <button
              type="button"
              className="bh-button bh-primary"
              onClick={() => onStart?.('Inspect video coherence claim boundaries.')}
            >
              Open in Review Workbench
            </button>
          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
