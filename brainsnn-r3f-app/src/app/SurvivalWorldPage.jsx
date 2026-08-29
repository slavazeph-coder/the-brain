import React, { useEffect } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { track } from '../lib/analytics.js';
import '../styles/behaviour-home.css';

const LAB_URL = 'https://xioaisolutions.github.io/gaugegap-foundry/brainsnn-lab/';

export function SurvivalWorldPage() {
  useEffect(() => {
    document.title = 'Survival World | BrainSNN Behaviour Lab';
    track('survival_world_opened');
  }, []);

  return (
    <div className="bh-lab-shell">
      <header className="bh-lab-bar">
        <a href="/"><ArrowLeft size={15} /> BrainSNN</a>
        <strong>Survival World · Lab 001</strong>
        <span>Finite synthetic simulation · GaugeGap evidence</span>
        <a href={LAB_URL} target="_blank" rel="noreferrer" onClick={() => track('survival_world_external_clicked')}>Open full screen <ExternalLink size={13} /></a>
      </header>
      <iframe
        className="bh-lab-frame"
        src={LAB_URL}
        title="BrainSNN Survival World"
        allow="clipboard-write"
        loading="eager"
      />
      <noscript className="bh-lab-fallback">JavaScript is required to run Survival World. Open {LAB_URL} directly.</noscript>
    </div>
  );
}
