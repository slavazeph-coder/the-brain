import React, { useMemo, useState } from 'react';
import { Brain3D } from '../brain3d/Brain3D.jsx';
import { BRAIN_REGIONS } from '../brain3d/brainRegions.js';
import { mapResultToActivities, synchronyPalette } from '../brain3d/mapResultToBrain.js';
import { BrainVisualizer } from './BrainVisualizer.jsx';

// Results-mode wrapper for the 3D brain: same chrome and disclaimer as the 2D
// signal map, with a 7-region legend and the soliton synchrony state. Falls
// back to the proven 2D BrainVisualizer on low-end devices / no WebGL.
export function BrainSignalView({ result }) {
  const [selectedRegion, setSelectedRegion] = useState(null);
  const activities = useMemo(() => mapResultToActivities(result), [result]);
  const synchrony = result?.solitonField?.synchrony;
  const palette = synchronyPalette(synchrony);

  return (
    <section className="brain-visualizer" aria-labelledby="brain-signal-heading">
      <div className="brain-viz-header">
        <div>
          <p className="bsn-eyebrow">Neural view</p>
          <h2 id="brain-signal-heading">BrainSNN signal map</h2>
          <p className="bsn-note">A visual metaphor tied to displayed content signals, not a literal brain measurement.</p>
        </div>
        {synchrony ? (
          <span className="brain-signal-sync" style={{ color: palette.edge }}>
            <span aria-hidden="true">◉</span> lattice {palette.label}
          </span>
        ) : null}
      </div>
      <Brain3D
        mode="result"
        result={result}
        fallback={<BrainVisualizer result={result} />}
        ariaLabel="Interactive 3D brain showing how this content activates seven cognitive regions."
        onRegionSelect={setSelectedRegion}
      />
      <div className="brain-signal-legend" aria-label="Brain regions in this scan">
        {BRAIN_REGIONS.map((region) => (
          <span
            key={region.code}
            className={`brain-signal-chip ${selectedRegion === region.code ? 'active' : ''}`}
            style={{ '--legend-color': region.color }}
          >
            <i aria-hidden="true" />
            {region.name} {Math.round((activities[region.code] || 0) * 100)}
          </span>
        ))}
      </div>
      <p className="brain-summary">
        Drag to orbit, click a region to focus it. Region intensity comes from this scan's 7-region projection; particle
        speed and color follow the 39 Hz soliton field.
      </p>
    </section>
  );
}
