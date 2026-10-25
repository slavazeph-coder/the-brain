import React, { useState } from 'react';

export function SurvivalWorldPage() {
  const [tick, setTick] = useState(0);
  const [energy, setEnergy] = useState(84);
  const [hydration, setHydration] = useState(78);
  const [shelter, setShelter] = useState(65);

  function stepWorld(action) {
    setTick((t) => t + 1);
    if (action === 'forage') {
      setEnergy((e) => Math.min(100, e + 12));
      setHydration((h) => Math.max(0, h - 5));
    } else if (action === 'water') {
      setHydration((h) => Math.min(100, h + 15));
      setEnergy((e) => Math.max(0, e - 4));
    } else if (action === 'fortify') {
      setShelter((s) => Math.min(100, s + 14));
      setEnergy((e) => Math.max(0, e - 6));
    }
  }

  return (
    <main className="lab-index" data-testid="survival-world">
      <p className="bh-kicker">SYNTHETIC SURVIVAL WORLD</p>
      <h1>Finite Resource &amp; Policy Sandbox</h1>
      <p>
        Step a bounded agent through a synthetic survival environment and inspect how homeostatic drives trade off over time.
      </p>
      <div className="lab-cards" style={{ marginTop: '1.25rem' }}>
        <article className="lab-card">
          <h2>Agent Telemetry (Tick {tick})</h2>
          <p>Energy: <strong>{energy}%</strong></p>
          <p>Hydration: <strong>{hydration}%</strong></p>
          <p>Shelter Integrity: <strong>{shelter}%</strong></p>
        </article>
        <article className="lab-card">
          <h2>Policy Actions</h2>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            <button type="button" className="bh-button bh-primary" onClick={() => stepWorld('forage')}>
              Forage (+Energy)
            </button>
            <button type="button" className="bh-button bh-secondary" onClick={() => stepWorld('water')}>
              Collect Water (+Hydration)
            </button>
            <button type="button" className="bh-button bh-secondary" onClick={() => stepWorld('fortify')}>
              Fortify Shelter (+Shelter)
            </button>
          </div>
        </article>
      </div>
    </main>
  );
}
