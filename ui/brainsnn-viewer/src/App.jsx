import React, { useEffect, useMemo, useState } from 'react';
import BrainScene from './components/BrainScene';
import ControlsBar from './components/ControlsBar';
import InspectorPanel from './components/InspectorPanel';
import { REGION_INFO } from './data/network';
import { applyScenario, createInitialState, resetState, simulateStep } from './utils/sim';

export default function App() {
  const [state, setState] = useState(() => createInitialState());

  useEffect(() => {
    const id = setInterval(() => {
      setState((prev) => simulateStep(prev));
    }, 180);
    return () => clearInterval(id);
  }, []);

  const stats = useMemo(() => ({
    mean: state.mean ?? Object.values(state.regions).reduce((a, v) => a + v, 0) / Object.keys(state.regions).length,
    plasticity: state.plasticity ?? Object.values(state.weights).reduce((a, v) => a + v, 0) / Object.keys(state.weights).length
  }), [state]);

  return (
    <div className="app-shell">
      <div className="backdrop" />
      <main className="app-layout">
        <section className="main-column">
          <ControlsBar
            state={state}
            onToggleRun={() => setState((s) => ({ ...s, running: !s.running }))}
            onBurst={() => setState((s) => ({ ...s, burst: 20, scenario: 'Sensory Burst' }))}
            onReset={() => setState(resetState())}
            onScenario={(key) => setState((s) => applyScenario(s, key))}
          />

          <section className="viewer-panel panel">
            <div className="viewer-overlay">
              <span className="viewer-chip">Tick {state.tick}</span>
              <span className="viewer-chip">Mean firing {stats.mean.toFixed(3)}</span>
              <span className="viewer-chip">Plasticity {stats.plasticity.toFixed(3)}</span>
              <span className="viewer-chip">Selected {state.selected}</span>
            </div>
            <div className="viewer-canvas-wrap">
              <BrainScene
                regions={state.regions}
                weights={state.weights}
                selected={state.selected}
                onSelect={(id) => setState((s) => ({ ...s, selected: id || s.selected }))}
              />
            </div>
          </section>

          <section className="lower-grid">
            <div className="panel panel-pad metric-grid">
              <div className="metric"><small>Regions</small><strong>7</strong></div>
              <div className="metric"><small>Connections</small><strong>10</strong></div>
              <div className="metric"><small>Scenario</small><strong>{state.scenario}</strong></div>
              <div className="metric"><small>Lead region</small><strong>{Object.entries(state.regions).sort((a,b)=>b[1]-a[1])[0][0]}</strong></div>
            </div>
            <div className="panel panel-pad explainer">
              <div className="eyebrow">Selected region</div>
              <h2>{state.selected} · {REGION_INFO[state.selected].name}</h2>
              <p className="muted">{REGION_INFO[state.selected].role}</p>
              <p className="muted small-note">Use the inspector to jump between incoming and outgoing pathways. Click any node in the 3D scene to focus it.</p>
            </div>
          </section>
        </section>

        <InspectorPanel state={state} onSelect={(id) => setState((s) => ({ ...s, selected: id }))} />
      </main>
    </div>
  );
}
