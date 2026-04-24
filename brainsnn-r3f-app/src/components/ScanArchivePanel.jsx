import React, { useEffect, useState } from 'react';
import {
  listArchive, searchArchive, removeFromArchive, clearArchive,
  exportArchiveJson, exportArchiveCsv,
} from '../utils/scanArchive';

/**
 * Layer 84 — Scan Archive panel.
 */
export default function ScanArchivePanel() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState(() => listArchive());

  useEffect(() => { setItems(query ? searchArchive(query) : listArchive()); }, [query]);

  function refresh() { setItems(query ? searchArchive(query) : listArchive()); }

  function remove(id) {
    removeFromArchive(id);
    refresh();
  }

  function wipe() {
    if (!window.confirm('Clear the whole archive?')) return;
    clearArchive();
    refresh();
  }

  function downloadJson() {
    const blob = new Blob([exportArchiveJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-archive-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadCsv() {
    const blob = new Blob([exportArchiveCsv()], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-archive-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="panel panel-pad scan-archive-panel">
      <div className="eyebrow">Layer 84 · scan archive</div>
      <h2>Starred scans</h2>
      <p className="muted">
        Keep long-term. Starred scans hold the full 400-char excerpt
        plus pressure + templates + language + entity. Search by any
        of those, export as JSON or CSV, or clear the lot.
      </p>

      <p className="muted small-note" style={{ marginTop: 6 }}>
        <strong>{items.length}</strong> entries {query ? `matching "${query}"` : 'total'}
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <input
          className="share-input"
          placeholder="Search archive…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
        />
        <button className="btn" onClick={downloadJson} disabled={items.length === 0}>Export JSON</button>
        <button className="btn" onClick={downloadCsv} disabled={items.length === 0}>Export CSV</button>
        <button className="btn" onClick={wipe} disabled={items.length === 0} style={{ color: '#dd6974' }}>Wipe</button>
      </div>

      <div style={{ marginTop: 12 }}>
        {items.length === 0 ? (
          <p className="muted small-note">
            No starred scans yet. Click the Star button in the Firewall result
            after any scan to save it here.
          </p>
        ) : items.map((e) => {
          const tone = e.pressure >= 0.55 ? '#dd6974' : e.pressure >= 0.25 ? '#fdab43' : '#6daa45';
          return (
            <div
              key={e.id}
              style={{
                padding: '8px 12px',
                borderLeft: `3px solid ${tone}`,
                background: 'rgba(255,255,255,0.03)',
                borderRadius: 6,
                marginTop: 6,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontFamily: 'monospace' }}>{e.id}</strong>
                  {e.entity && <span className="muted small-note" style={{ marginLeft: 6 }}>@{e.entity}</span>}
                  <span className="muted small-note" style={{ marginLeft: 8 }}>
                    {new Date(e.ts).toISOString().slice(0, 10)} · {e.language}
                  </span>
                </div>
                <span style={{ color: tone, fontFamily: 'monospace' }}>
                  {Math.round(e.pressure * 100)}%
                </span>
              </div>
              <p className="muted" style={{ margin: '4px 0', fontStyle: 'italic', fontSize: 13 }}>
                "{e.excerpt}"
              </p>
              {(e.templates.length > 0 || e.tags.length > 0) && (
                <div className="muted small-note" style={{ marginTop: 4 }}>
                  {e.templates.length > 0 && <>templates: {e.templates.join(', ')}</>}
                  {e.tags.length > 0 && <> · tags: {e.tags.join(', ')}</>}
                </div>
              )}
              <button className="ghost small" onClick={() => remove(e.id)} style={{ marginTop: 4, color: '#dd6974' }}>
                Remove
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
