import React from 'react';
import BrainScene from '../components/BrainScene';
import { REGION_INFO } from '../data/network';

/**
 * BrainViewport — the persistent 3D brain.
 *
 * Mounted ONCE at the AppShell level so tab navigation never remounts
 * the R3F Canvas (which costs 400-800ms). CSS classes (.is-promoted /
 * .is-strip) control whether the viewer takes the whole upper region
 * (BRAIN workspace) or compresses to a thin always-visible strip.
 *
 * Do NOT import BrainScene from anywhere else inside the shell.
 */
export default function BrainViewport({
  state,
  quality,
  knowledgeMode,
  affectOverride,
  promoted,
  onSelect,
  onQualityChange,
  modeLabel
}) {
  const stats = {
    mean: state.mean ?? Object.values(state.regions).reduce((a, v) => a + v, 0) / Object.keys(state.regions).length,
    plasticity: state.plasticity ?? Object.values(state.weights).reduce((a, v) => a + v, 0) / Object.keys(state.weights).length
  };

  return (
    <section className={`viewer-panel panel shell-viewport ${promoted ? 'is-promoted' : 'is-strip'}`}>
      <div className="viewer-overlay">
        <span className="viewer-chip">Tick {state.tick}</span>
        <span className="viewer-chip">Mean {stats.mean.toFixed(3)}</span>
        <span className="viewer-chip">Plasticity {stats.plasticity.toFixed(3)}</span>
        <span className="viewer-chip">{state.selected}</span>
        <span className="viewer-chip">Q · {quality}</span>
        <span className="viewer-chip">{modeLabel}</span>
        {promoted && state.selected && REGION_INFO[state.selected] && (
          <span className="viewer-chip viewer-chip-info">{REGION_INFO[state.selected].name}</span>
        )}
      </div>

      <div className="viewer-canvas-wrap">
        <BrainScene
          regions={state.regions}
          weights={state.weights}
          selected={state.selected}
          quality={quality}
          knowledgeMode={knowledgeMode}
          affectOverride={affectOverride}
          onQualityChange={onQualityChange}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
}
