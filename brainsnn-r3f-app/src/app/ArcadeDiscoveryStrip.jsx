import React from 'react';
import { ArrowRight, Gamepad2, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';

const LABS = ['Defend the Brain', 'Fractal Reality Lab', 'Neuro Powder Lab'];

export function ArcadeDiscoveryStrip() {
  function openArcade() {
    window.location.assign('/arcade');
  }

  return (
    <section className="arcade-discovery-strip" aria-labelledby="arcade-discovery-heading">
      <div className="arcade-discovery-icon" aria-hidden="true">
        <Gamepad2 size={24} />
      </div>
      <div className="arcade-discovery-copy">
        <p className="bsn-kicker"><Sparkles size={14} aria-hidden="true" /> GaugeGap Arcade</p>
        <h2 id="arcade-discovery-heading">Done analyzing? Go play with the science.</h2>
        <p>Interactive brain games, simulations and experimental labs live one step away from the publishing engine.</p>
        <div className="arcade-discovery-labs" aria-label="Featured arcade experiences">
          {LABS.map((lab) => <span key={lab}>{lab}</span>)}
        </div>
      </div>
      <Button variant="secondary" onClick={openArcade}>
        Enter the Arcade <ArrowRight size={16} aria-hidden="true" />
      </Button>
    </section>
  );
}
