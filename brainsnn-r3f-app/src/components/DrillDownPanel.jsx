import React, { useEffect, useState } from 'react';
import { REGION_INFO, POSITIONS } from '../data/network';
import {
  getDrillDown, subscribeDrillDown, toggleRegion, setDrillDown, REGION_DETAILS,
} from '../utils/drilldown';

/**
 * Layer 75 — Region Drill-Down panel.
 */
export default function DrillDownPanel({ regions }) {
  const [drill, setDrill] = useState(getDrillDown());

  useEffect(() => subscribeDrillDown(setDrill), []);

  const keys = Object.keys(POSITIONS);
  const focused = drill.region;

  return (
    <section className="panel panel-pad drilldown-panel">
      <div className="eyebrow">Layer 75 · region drill-down</div>
      <h2>Punch in on one region</h2>
      <p className="muted">
        Click a region to zoom the 3D camera in, densify its fragment
        cluster, and pull up per-region metadata. Click again (or hit Exit)
        to restore the global view.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {keys.map((k) => {
          const info = REGION_INFO[k];
          const selected = focused === k;
          return (
            <button
              key={k}
              onClick={() => toggleRegion(k)}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                border: `1px solid ${info.color}`,
                background: selected ? `${info.color}33` : 'transparent',
                color: selected ? '#ffffff' : info.color,
                cursor: 'pointer',
                fontWeight: 700,
                fontFamily: 'monospace',
                fontSize: 13,
              }}
              title={info.name}
            >
              {k}
            </button>
          );
        })}
        {drill.active && (
          <button
            className="btn"
            onClick={() => setDrillDown({ active: false, region: null })}
            style={{ marginLeft: 'auto' }}
          >
            ✕ Exit drill-down
          </button>
        )}
      </div>

      {focused && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 10,
              borderLeft: `3px solid ${REGION_INFO[focused].color}`,
              background: `${REGION_INFO[focused].color}14`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong style={{ fontSize: 18 }}>{REGION_INFO[focused].name}</strong>
              <span style={{ color: REGION_INFO[focused].color, fontFamily: 'monospace' }}>
                firing {Math.round((regions?.[focused] ?? 0) * 100)}%
              </span>
            </div>
            <p className="muted" style={{ margin: '6px 0 0', lineHeight: 1.45 }}>
              {REGION_DETAILS[focused]?.role || REGION_INFO[focused].role}
            </p>
            {REGION_DETAILS[focused] && (
              <ul className="muted" style={{ marginTop: 8, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
                <li>Oscillation bias: <strong>{REGION_DETAILS[focused].oscillationBias}</strong></li>
                <li>Firewall tie: <em>{REGION_DETAILS[focused].firewallTie}</em></li>
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
