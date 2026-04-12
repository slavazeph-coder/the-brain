import React, { useState } from 'react';
import BrainScene from './BrainScene';
import { listSnapshots, loadSnapshot, compareSnapshots } from '../utils/snapshots';
import { REGION_INFO } from '../data/network';

function DeltaBadge({ value }) {
  if (!value || Math.abs(value) < 0.005) return null;
  const cls = value > 0 ? 'split-delta-up' : 'split-delta-down';
  return <span className={`split-delta ${cls}`}>{value > 0 ? '+' : ''}{(value * 100).toFixed(1)}%</span>;
}

export default function SplitBrainView({ currentState, quality }) {
  const [open, setOpen] = useState(false);
  const [selectedSnapId, setSelectedSnapId] = useState('');
  const [snapState, setSnapState] = useState(null);
  const [comparison, setComparison] = useState(null);

  const snapshots = listSnapshots();

  const handleSelect = (id) => {
    setSelectedSnapId(id);
    const snap = loadSnapshot(id);
    if (snap) {
      setSnapState(snap);
      // Build comparison
      const pseudoSnapCurrent = {
        regions: { ...currentState.regions },
        weights: { ...currentState.weights },
        summary: {
          mean: Object.values(currentState.regions).reduce((a, v) => a + v, 0) / Object.keys(currentState.regions).length,
        },
        id: 'live', name: 'Live', scenario: currentState.scenario
      };
      setComparison(compareSnapshots(pseudoSnapCurrent, snap));
    }
  };

  if (!open) {
    return (
      <section className="panel panel-pad split-brain-toggle">
        <div className="eyebrow">Comparison Mode</div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          Open Split Brain View
        </button>
        <p className="muted">Compare the live brain against any saved snapshot side by side.</p>
      </section>
    );
  }

  return (
    <section className="panel panel-pad split-brain-panel">
      <div className="split-brain-header">
        <div>
          <div className="eyebrow">Split Brain Comparison</div>
          <p className="muted">Live state (left) vs saved snapshot (right)</p>
        </div>
        <button className="btn-sm" onClick={() => setOpen(false)}>Close</button>
      </div>

      {/* Snapshot selector */}
      <div className="split-selector">
        <label className="share-label">Compare against:</label>
        <select
          className="snap-name-input"
          value={selectedSnapId}
          onChange={(e) => handleSelect(e.target.value)}
        >
          <option value="">Select a snapshot...</option>
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>{s.name} — {s.scenario}</option>
          ))}
        </select>
      </div>

      {/* Side-by-side 3D viewers */}
      <div className="split-viewers">
        <div className="split-viewer-pane">
          <div className="split-viewer-label">Live — {currentState.scenario}</div>
          <div className="split-canvas-wrap">
            <BrainScene
              regions={currentState.regions}
              weights={currentState.weights}
              selected={currentState.selected}
              quality={quality}
              onSelect={() => {}}
              onQualityChange={() => {}}
            />
          </div>
        </div>

        <div className="split-divider" />

        <div className="split-viewer-pane">
          <div className="split-viewer-label">
            {snapState ? `${snapState.name} — ${snapState.scenario}` : 'Select a snapshot'}
          </div>
          <div className="split-canvas-wrap">
            {snapState ? (
              <BrainScene
                regions={snapState.regions}
                weights={snapState.weights}
                selected={currentState.selected}
                quality={quality}
                onSelect={() => {}}
                onQualityChange={() => {}}
              />
            ) : (
              <div className="split-placeholder">
                <p className="muted">No snapshot selected</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delta table */}
      {comparison && (
        <div className="split-delta-table">
          <div className="eyebrow">Region Deltas (Live → Snapshot)</div>
          <div className="split-delta-grid">
            {Object.entries(comparison.regionDiffs).map(([region, diff]) => (
              <div key={region} className="split-delta-row">
                <span className="split-region" style={{ color: REGION_INFO[region]?.color }}>{region}</span>
                <span className="muted">{(diff.a * 100).toFixed(0)}%</span>
                <span>→</span>
                <span className="muted">{(diff.b * 100).toFixed(0)}%</span>
                <DeltaBadge value={diff.delta} />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
