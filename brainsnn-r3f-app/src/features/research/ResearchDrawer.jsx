import React from 'react';
import { FlaskConical } from 'lucide-react';
import { BenchmarksPanel } from './BenchmarksPanel.jsx';
import { CrumbPhysicsPanel } from './CrumbPhysicsPanel.jsx';

export function ResearchDrawer() {
  return (
    <div className="research-workspace" data-testid="research-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Research</p>
        <h1>Advanced SNN and Crumb lab.</h1>
        <p>Technical material is preserved here so the default product remains focused on business decisions and rewrite workflow.</p>
      </header>
      <div className="research-summary">
        <article>
          <h3>Production</h3>
          <p>Brain Scan, executive verdict, scorecard, content heatmap, Synapse rewrites, local Memory, local Neural Queue and export.</p>
        </article>
        <article>
          <h3>Experimental</h3>
          <p>Crumb LLM physics, wave parameters, cognitive firewall language, technical SNN metrics and older demo surfaces.</p>
        </article>
      </div>
      <CrumbPhysicsPanel />
      <BenchmarksPanel />
      <section className="legacy-lab-shell">
        <div>
          <p className="bsn-eyebrow">Legacy lab</p>
          <h2>Earlier BrainSNN research surface preserved</h2>
          <p className="bsn-note">
            The previous 35+ layer lab remains in source under components and features/research/LegacyResearchApp.jsx.
            It is intentionally not mounted in the buyer workflow because it bundles many experimental demos and slowed
            production builds.
          </p>
        </div>
        <FlaskConical size={28} aria-hidden="true" />
      </section>
      <section className="research-panel">
        <p className="bsn-eyebrow">Moved out of primary workflow</p>
        <h2>Technical demos now live behind Research</h2>
        <ul className="research-list">
          <li>Crumb LLM physics tuner and wave parameters</li>
          <li>Cognitive firewall and red-team demonstrations</li>
          <li>Legacy share-card experiments and browser extension demos</li>
          <li>Experimental video/reel, benchmark, EEG and simulation surfaces</li>
        </ul>
      </section>
    </div>
  );
}
