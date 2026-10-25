import React from 'react';
import { ArrowRight, Bot, ScanLine, Sparkles } from 'lucide-react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';

export function LobbyHome() {
  return (
    <div className="bh-site">
      <PublicNav active="home" />
      <main className="lab-index" data-testid="lobby-home">
        <p className="bh-kicker">
          <Sparkles size={15} aria-hidden="true" /> BRAINSNN WORKSPACE
        </p>
        <h1>Build worlds, test robot policies, and inspect neural models.</h1>
        <p>
          Explore the 3D World Builder, run robot evaluation packs in the Arena, or test spiking circuits in the Neuro Powder Lab.
        </p>
        <div className="lab-cards">
          <a className="lab-card" href="/world/index.html#workspace">
            <h2>World Builder</h2>
            <p>Turn room captures, floorplans, and dimension presets into editable 3D scenes.</p>
            <span>Open World Builder <ArrowRight size={15} /></span>
          </a>
          <a className="lab-card" href="/arena/">
            <h2>
              <Bot size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Robot Arena
            </h2>
            <p>Evaluate robot policies across manipulation and navigation missions with full telemetry replay.</p>
            <span>Enter Arena <ArrowRight size={15} /></span>
          </a>
          <a className="lab-card" href="/scan">
            <h2>
              <ScanLine size={18} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Capture Studio
            </h2>
            <p>Upload walkthrough frames or depth scans to reconstruct structured room geometry.</p>
            <span>Start scanning <ArrowRight size={15} /></span>
          </a>
          <a className="lab-card" href="/lab/powder">
            <h2>Neuro Powder Lab</h2>
            <p>Draw leaky integrate-and-fire neurons, STDP synapses, and dopamine baths on a 2D cellular grid.</p>
            <span>Open Powder Lab <ArrowRight size={15} /></span>
          </a>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
