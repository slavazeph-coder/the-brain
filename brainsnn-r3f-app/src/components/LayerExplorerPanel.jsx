import React, { useMemo, useState } from 'react';
import { searchLayers, LAYER_GROUPS, LAYER_CATALOG } from '../utils/layerCatalog';

/**
 * Layer 72 — Layer Explorer panel.
 * Searchable index of every shipped cognitive layer.
 */
export default function LayerExplorerPanel() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');

  const filtered = useMemo(() => {
    let out = searchLayers(q);
    if (group !== 'all') out = out.filter((l) => l.group === group);
    return out;
  }, [q, group]);

  const counts = useMemo(() => {
    const c = {};
    for (const l of LAYER_CATALOG) c[l.group] = (c[l.group] || 0) + 1;
    return c;
  }, []);

  return (
    <section className="panel panel-pad layer-explorer-panel">
      <div className="eyebrow">Layer 72 · layer explorer</div>
      <h2>{LAYER_CATALOG.length} cognitive layers, indexed</h2>
      <p className="muted">
        Search by name, keyword, group, or layer number. BrainSNN has
        grown past what fits on one screen — this is the map.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input
          className="share-input"
          placeholder={`Search ${LAYER_CATALOG.length} layers…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <select className="share-input" value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="all">All groups ({LAYER_CATALOG.length})</option>
          {Object.entries(LAYER_GROUPS).map(([id, g]) => (
            <option key={id} value={id}>{g.label} ({counts[id] || 0})</option>
          ))}
        </select>
      </div>

      <p className="muted small-note" style={{ marginTop: 6 }}>
        Showing <strong>{filtered.length}</strong> of {LAYER_CATALOG.length}
      </p>

      <div style={{ marginTop: 10 }}>
        {filtered.map((l) => {
          const g = LAYER_GROUPS[l.group] || { label: l.group, color: '#888' };
          return (
            <div
              key={l.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 150px',
                gap: 12,
                padding: '8px 10px',
                borderLeft: `3px solid ${g.color}`,
                background: 'rgba(255,255,255,0.025)',
                borderRadius: 6,
                marginTop: 4,
              }}
            >
              <span className="muted" style={{ fontFamily: 'monospace', alignSelf: 'center' }}>L{l.id}</span>
              <div>
                <strong>{l.name}</strong>
                <p className="muted" style={{ margin: '2px 0 0', fontSize: 12, lineHeight: 1.35 }}>{l.blurb}</p>
              </div>
              <span className="muted small-note" style={{ alignSelf: 'center', color: g.color }}>{g.label}</span>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="muted small-note" style={{ marginTop: 10 }}>No matches.</p>
        )}
      </div>
    </section>
  );
}
