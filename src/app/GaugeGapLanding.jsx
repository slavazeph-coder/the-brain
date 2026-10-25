import React from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';

export function GaugeGapLanding({ onStart }) {
  return (
    <div className="bh-site" data-testid="arcade-landing">
      <PublicNav active="lab" />
      <main className="lab-index">
        <p className="bh-kicker">NEURAL ARCADE &amp; BENCHMARKS</p>
        <h1>Interactive Simulations &amp; Signal Experiments</h1>
        <p>
          Explore interactive physics sandboxes, spiking neural network circuits, and deterministic content experiments.
        </p>
        <div className="lab-cards">
          <a className="lab-card" href="/lab/powder">
            <h2>Neuro Powder Lab</h2>
            <p>Falling-sand cellular automaton wired with leaky integrate-and-fire neurons and STDP synapses.</p>
            <span>Open Powder Lab →</span>
          </a>
          <a className="lab-card" href="/toys/fool-the-detector">
            <h2>Fool the Detector</h2>
            <p>Rewrite high-pressure sales copy to slip past the Cognitive Firewall while keeping the pitch intact.</p>
            <span>Play Fool the Detector →</span>
          </a>
          <a className="lab-card" href="/toys/draft-duel">
            <h2>Draft Duel</h2>
            <p>Pit two passages head-to-head across urgency, trust, and manipulation pressure rounds.</p>
            <span>Play Draft Duel →</span>
          </a>
          <article className="lab-card">
            <h2>Review Workbench</h2>
            <p>Run a passage through the deterministic SNN and firewall stack.</p>
            <button type="button" className="bh-button bh-primary" onClick={() => onStart?.('')}>
              Open Workbench
            </button>
          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
