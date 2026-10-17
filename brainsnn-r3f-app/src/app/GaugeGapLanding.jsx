import React, { useEffect } from 'react';
import { ExperimentArcade } from '../features/gaugegap/ExperimentArcade.jsx';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { track } from '../lib/analytics.js';
import '../styles/gaugegap.css';
import '../styles/arcade-discovery.css';

export function GaugeGapLanding({ onStart }) {
  useEffect(() => { document.title = 'Arcade | BrainSNN'; track('gaugegap_landing_viewed'); }, []);
  return <div className="bh-site gg-site"><PublicNav active="lab" />
    <main className="lab-index"><p className="bh-kicker"><a href="/lab">Lab</a> / Arcade</p><h1>Arcade</h1>
      <p>Interactive experiments in physics, living systems and content. Each simulation describes its own conditions.</p>
      <ExperimentArcade onOpenScanner={onStart} />
    </main><PublicFooter />
  </div>;
}
