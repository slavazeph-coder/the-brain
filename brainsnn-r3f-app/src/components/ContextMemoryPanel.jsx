import React, { useEffect, useState } from 'react';
import {
  listContextEntities, summarizeEntity, clearEntity, clearAllContext,
} from '../utils/contextMemory';

/**
 * Layer 63 — Context Memory panel.
 * Shows the per-entity rollup — persistent history per tagged source.
 */
export default function ContextMemoryPanel() {
  const [entities, setEntities] = useState(() => listContextEntities());
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    setSummary(selected ? summarizeEntity(selected) : null);
  }, [selected, entities]);

  function refresh() { setEntities(listContextEntities()); }

  function remove(entity) {
    clearEntity(entity);
    if (selected === entity) setSelected(null);
    refresh();
  }

  function wipe() {
    if (!window.confirm('Wipe all context-memory entries?')) return;
    clearAllContext();
    setSelected(null);
    refresh();
  }

  return (
    <section className="panel panel-pad context-memory-panel">
      <div className="eyebrow">Layer 63 · context memory</div>
      <h2>Per-entity tracking</h2>
      <p className="muted">
        Tag a scan with an optional entity name (a boss, a handle, a brand)
        and BrainSNN keeps a long-term pressure + template history for that
        source. Add an entity in the Firewall panel's <em>"tag this scan"</em>
        field — entries will appear here automatically.
      </p>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={refresh}>Refresh</button>
        <button className="btn" onClick={wipe} style={{ color: '#dd6974' }}>Wipe all</button>
      </div>

      {entities.length === 0 ? (
        <p className="muted small-note" style={{ marginTop: 12 }}>
          No entities tagged yet. Scan content in the Firewall panel with an
          entity name to populate this list.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 12, marginTop: 12 }}>
          <div>
            <div className="eyebrow">Entities ({entities.length})</div>
            {entities.map((e) => {
              const tone = e.meanPressure >= 0.55 ? '#dd6974' : e.meanPressure >= 0.25 ? '#fdab43' : '#6daa45';
              return (
                <div
                  key={e.entity}
                  onClick={() => setSelected(e.entity)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    borderLeft: `3px solid ${selected === e.entity ? '#5ad4ff' : tone}`,
                    background: selected === e.entity ? 'rgba(90,212,255,0.08)' : 'rgba(255,255,255,0.03)',
                    marginTop: 6,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>{e.entity}</strong>
                    <span style={{ color: tone, fontFamily: 'monospace' }}>
                      {Math.round(e.meanPressure * 100)}%
                    </span>
                  </div>
                  <div className="muted small-note">
                    {e.count} scan{e.count === 1 ? '' : 's'} · last{' '}
                    {new Date(e.lastTs).toISOString().slice(0, 10)}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            {summary ? (
              <div>
                <div className="eyebrow">
                  {summary.entity} · {summary.count} scan{summary.count === 1 ? '' : 's'}
                </div>
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)',
                    marginTop: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      Mean pressure <strong>{Math.round(summary.meanPressure * 100)}%</strong>
                    </span>
                    <span>
                      Peak <strong>{Math.round(summary.peak.pressure * 100)}%</strong>
                    </span>
                  </div>
                  {summary.topTemplates.length > 0 && (
                    <div className="muted small-note" style={{ marginTop: 4 }}>
                      top templates: {summary.topTemplates.map((t) => `${t.id} × ${t.n}`).join(', ')}
                    </div>
                  )}
                </div>

                <Timeline points={summary.timeline} />

                <div style={{ marginTop: 10 }}>
                  <button className="ghost small" onClick={() => remove(summary.entity)} style={{ color: '#dd6974' }}>
                    Remove entity
                  </button>
                </div>
              </div>
            ) : (
              <p className="muted small-note">Select an entity to see its timeline.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Timeline({ points }) {
  if (!points?.length) return null;
  const W = 360;
  const H = 50;
  const xs = points.map((_, i) => (i / Math.max(1, points.length - 1)) * W);
  const ys = points.map((p) => H - (p.pressure || 0) * H);
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ marginTop: 10 }}>
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
      <path d={d} stroke="#5ad4ff" strokeWidth={1.6} fill="none" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xs[i]}
          cy={ys[i]}
          r={p.pressure > 0.55 ? 3 : 1.8}
          fill={p.pressure > 0.55 ? '#dd6974' : '#5ad4ff'}
        />
      ))}
    </svg>
  );
}
