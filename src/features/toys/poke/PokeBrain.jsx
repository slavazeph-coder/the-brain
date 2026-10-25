import React, { useState } from 'react';
import { BRAIN_REGIONS } from '../../brain3d/brainRegions.js';

export function PokeBrain() {
  const [activeRegion, setActiveRegion] = useState(BRAIN_REGIONS[0]);
  const [spikes, setSpikes] = useState(12);

  function handlePoke(region) {
    setActiveRegion(region);
    setSpikes((count) => count + 1);
  }

  return (
    <section className="lab-index" data-testid="poke-brain">
      <p className="bh-kicker">SAPIENT PLAYGROUND · 7-REGION CONNECTOME</p>
      <h1>Poke the Brain. Watch the cascade travel.</h1>
      <p>
        Trigger an impulse in any of the seven simulated cortical and subcortical regions to inspect its propagation pathway and firing response.
      </p>
      <div className="lab-cards" style={{ marginTop: '1.25rem' }}>
        <article className="lab-card">
          <h2>Regions ({spikes} impulses triggered)</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
            {BRAIN_REGIONS.map((region) => (
              <button
                key={region.id}
                type="button"
                onClick={() => handlePoke(region)}
                className={`bh-button ${activeRegion?.id === region.id ? 'bh-primary' : 'bh-secondary'}`}
              >
                {region.name || region.label || region.id}
              </button>
            ))}
          </div>
        </article>
        {activeRegion && (
          <article className="lab-card">
            <p className="bh-kicker">ACTIVE REGION</p>
            <h2>{activeRegion.name || activeRegion.label || activeRegion.id}</h2>
            <p>{activeRegion.description || activeRegion.role || 'Simulated spiking hub in the 7-region connectome.'}</p>
          </article>
        )}
      </div>
    </section>
  );
}
