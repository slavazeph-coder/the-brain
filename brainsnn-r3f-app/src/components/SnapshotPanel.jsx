import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  listSnapshots, saveSnapshot, loadSnapshot, deleteSnapshot,
  compareSnapshots, exportSnapshotJSON, exportAllSnapshotsJSON,
  importSnapshotsJSON, generateReport
} from '../utils/snapshots';

function DeltaChip({ value }) {
  if (value === 0) return <span className="snap-delta neutral">0</span>;
  const cls = value > 0 ? 'up' : 'down';
  return (
    <span className={`snap-delta ${cls}`}>
      {value > 0 ? '+' : ''}{(value * 100).toFixed(1)}%
    </span>
  );
}

export default function SnapshotPanel({ state, onRestoreSnapshot }) {
  const [snapshots, setSnapshots] = useState([]);
  const [name, setName] = useState('');
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [message, setMessage] = useState('');
  const importRef = useRef(null);

  const refresh = useCallback(() => setSnapshots(listSnapshots()), []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSave = () => {
    saveSnapshot(state, name);
    setName('');
    setMessage('Snapshot saved');
    refresh();
    setTimeout(() => setMessage(''), 2000);
  };

  const handleRestore = (id) => {
    const snap = loadSnapshot(id);
    if (snap && onRestoreSnapshot) onRestoreSnapshot(snap);
  };

  const handleDelete = (id) => {
    deleteSnapshot(id);
    if (compareA === id) setCompareA(null);
    if (compareB === id) setCompareB(null);
    setComparison(null);
    refresh();
  };

  const handleCompare = () => {
    if (!compareA || !compareB) return;
    const a = loadSnapshot(compareA);
    const b = loadSnapshot(compareB);
    setComparison(compareSnapshots(a, b));
  };

  const handleExport = (id) => {
    const json = exportSnapshotJSON(id);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-snapshot-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAll = () => {
    const json = exportAllSnapshotsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brainsnn-snapshots-all.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = importSnapshotsJSON(text);
      setMessage(`Imported ${count} snapshot(s)`);
      refresh();
    } catch (err) {
      setMessage(`Import failed: ${err.message}`);
    }
    setTimeout(() => setMessage(''), 3000);
    if (importRef.current) importRef.current.value = '';
  };

  const handleReport = (id) => {
    const snap = loadSnapshot(id);
    if (!snap) return;
    const md = generateReport(snap);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-report-${id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="panel panel-pad snapshot-panel">
      <div className="eyebrow">Session Intelligence</div>
      <h2>Brain State Snapshots</h2>
      <p className="muted">
        Capture, compare, and share brain states. Snapshots persist in your browser.
      </p>

      {/* Save */}
      <div className="snap-save-row">
        <input
          className="snap-name-input"
          type="text"
          placeholder="Snapshot name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn primary" onClick={handleSave}>
          Save snapshot
        </button>
      </div>

      {message && <p className="snap-message">{message}</p>}

      {/* Import / Export all */}
      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={() => importRef.current?.click()}>
          Import
        </button>
        <input ref={importRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
        {snapshots.length > 0 && (
          <button className="btn" onClick={handleExportAll}>
            Export all
          </button>
        )}
      </div>

      {/* Snapshot list */}
      {snapshots.length > 0 && (
        <div className="snap-list">
          {snapshots.map((s) => (
            <div key={s.id} className="snap-item">
              <div className="snap-item-head">
                <strong>{s.name}</strong>
                <span className="muted snap-time">{new Date(s.timestamp).toLocaleString()}</span>
              </div>
              <div className="snap-item-meta">
                <span className="snap-chip">{s.scenario}</span>
                <span className="snap-chip">Mean {(s.summary.mean * 100).toFixed(1)}%</span>
                <span className="snap-chip">Lead {s.summary.leadRegion}</span>
              </div>
              <div className="snap-item-actions">
                <button className="btn-sm" onClick={() => handleRestore(s.id)}>Restore</button>
                <button className="btn-sm" onClick={() => handleExport(s.id)}>Export</button>
                <button className="btn-sm" onClick={() => handleReport(s.id)}>Report</button>
                <button className="btn-sm" onClick={() => setCompareA(s.id)}>A</button>
                <button className="btn-sm" onClick={() => setCompareB(s.id)}>B</button>
                <button className="btn-sm danger" onClick={() => handleDelete(s.id)}>×</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {snapshots.length === 0 && (
        <p className="muted" style={{ marginTop: 12 }}>No snapshots yet. Save one to get started.</p>
      )}

      {/* Compare */}
      {compareA && compareB && (
        <div className="snap-compare-trigger">
          <button className="btn primary" onClick={handleCompare}>
            Compare A vs B
          </button>
          <span className="muted">
            A: {snapshots.find((s) => s.id === compareA)?.name?.slice(0, 25)}
            {' vs '}
            B: {snapshots.find((s) => s.id === compareB)?.name?.slice(0, 25)}
          </span>
        </div>
      )}

      {/* Comparison results */}
      {comparison && (
        <div className="snap-comparison">
          <div className="eyebrow">Comparison</div>
          <div className="snap-compare-head">
            <span><strong>A:</strong> {comparison.snapA.name}</span>
            <span><strong>B:</strong> {comparison.snapB.name}</span>
          </div>

          <div className="snap-compare-overall">
            Overall delta: <DeltaChip value={comparison.overallDelta} />
          </div>

          <div className="snap-compare-grid">
            {Object.entries(comparison.regionDiffs).map(([region, diff]) => (
              <div key={region} className="snap-compare-row">
                <span className="snap-region-label">{region}</span>
                <div className="snap-compare-bars">
                  <div className="snap-bar-a" style={{ width: `${diff.a * 100}%` }} />
                  <div className="snap-bar-b" style={{ width: `${diff.b * 100}%` }} />
                </div>
                <DeltaChip value={diff.delta} />
              </div>
            ))}
          </div>

          <div className="snap-most-changed">
            <span className="eyebrow">Most changed</span>
            <div className="firewall-chips">
              {comparison.mostChanged.map((c) => (
                <span key={c.region} className="firewall-chip">
                  {c.region}: {c.delta > 0 ? '+' : ''}{(c.delta * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
