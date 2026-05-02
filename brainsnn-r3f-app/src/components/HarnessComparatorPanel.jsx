import React, { useEffect, useMemo, useState } from 'react';
import {
  listSnapshots, saveSnapshot, deleteSnapshot, clearSnapshots,
  compareReports, renderDiffText,
} from '../utils/harnessComparator';
import { runDiagnostic } from '../utils/harnessFailureModes';

/**
 * Layer 104 — Harness Comparator panel.
 *
 * "Did my last rule change actually help?" Snapshot the current
 * report (Layer 102), make a change, snapshot again, then diff.
 */
export default function HarnessComparatorPanel() {
  const [snaps, setSnaps] = useState(() => listSnapshots());
  const [aId, setA] = useState('');
  const [bId, setB] = useState('');
  const [label, setLabel] = useState('');

  function refresh() { setSnaps(listSnapshots()); }

  function snap() {
    const report = runDiagnostic();
    saveSnapshot({ label: label || `snap-${snaps.length + 1}`, report });
    setLabel('');
    refresh();
  }
  function del(id) { deleteSnapshot(id); refresh(); }

  const a = useMemo(() => snaps.find((s) => s.id === aId), [snaps, aId]);
  const b = useMemo(() => snaps.find((s) => s.id === bId), [snaps, bId]);
  const diff = useMemo(() => (a && b ? compareReports(a.report, b.report) : null), [a, b]);
  const text = useMemo(() => (diff ? renderDiffText(diff) : ''), [diff]);

  function copy() {
    if (!text) return;
    try { navigator.clipboard.writeText(text); } catch { /* noop */ }
  }

  const tone = (
    !diff ? '#7a8fe7'
      : diff.tier?.shift === 'improved' ? '#5ee69a'
        : diff.tier?.shift === 'regressed' ? '#dd6974'
          : '#fdab43'
  );

  useEffect(() => { refresh(); }, []);

  return (
    <section className="panel panel-pad harness-comparator-panel">
      <div className="eyebrow">Layer 104 · harness comparator</div>
      <h2>Before / after the change</h2>
      <p className="muted">
        Snapshot the live harness report (Layer 102), apply a rule
        change, snapshot again, then diff. Surfaces which findings
        appeared, resolved, or changed severity — and which ops got
        slower or noisier.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, marginTop: 10 }}>
        <input
          className="share-input"
          placeholder="Snapshot label (e.g. before-evolve)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={40}
        />
        <button className="btn-sm" onClick={snap}>Snapshot now</button>
        <button className="ghost small" onClick={() => { clearSnapshots(); refresh(); }} style={{ color: '#dd6974' }}>
          Clear all
        </button>
      </div>

      {snaps.length === 0 ? (
        <p className="muted small-note" style={{ marginTop: 10 }}>No snapshots yet.</p>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <SnapPicker label="A (baseline)" value={aId} onChange={setA} snaps={snaps} />
            <SnapPicker label="B (current)" value={bId} onChange={setB} snaps={snaps} />
          </div>
          <div style={{ marginTop: 8 }}>
            {snaps.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: '4px 10px',
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 6,
                  marginTop: 2,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontFamily: 'monospace',
                  fontSize: 12,
                }}
              >
                <span>
                  <strong>{s.label}</strong>
                  <span className="muted small-note" style={{ marginLeft: 8 }}>
                    {s.report.tier} · {s.report.totals.spans} spans · {s.report.findings.length} findings
                  </span>
                </span>
                <span>
                  <span className="muted small-note">{new Date(s.ts).toLocaleString()}</span>
                  <button className="ghost small" onClick={() => del(s.id)} style={{ marginLeft: 6, color: '#dd6974' }}>
                    Delete
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {diff && diff.ok && (
        <div
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 8,
            background: `${tone}14`,
            borderLeft: `3px solid ${tone}`,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong style={{ color: tone }}>
              {diff.tier.from} → {diff.tier.to} · {diff.tier.shift.toUpperCase()}
            </strong>
            <button className="ghost small" onClick={copy}>Copy diff</button>
          </div>
          <div className="muted small-note" style={{ marginTop: 4 }}>
            spans Δ{diff.totals.spans.delta} · errors Δ{diff.totals.errors.delta}
          </div>
          {diff.findings.added.length > 0 && (
            <DiffList title="New findings" items={diff.findings.added.map((f) => `+ ${f.label} ×${f.count}`)} color="#dd6974" />
          )}
          {diff.findings.removed.length > 0 && (
            <DiffList title="Resolved" items={diff.findings.removed.map((f) => `- ${f.label} ×${f.count}`)} color="#5ee69a" />
          )}
          {diff.findings.shifted.length > 0 && (
            <DiffList
              title="Severity / count shifts"
              items={diff.findings.shifted.map((f) => `~ ${f.label} · ${f.severity.from}→${f.severity.to} · ×${f.count.from}→×${f.count.to}`)}
              color="#fdab43"
            />
          )}
        </div>
      )}
    </section>
  );
}

function SnapPicker({ label, value, onChange, snaps }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="muted small-note">{label}</span>
      <select className="share-input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— choose —</option>
        {snaps.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label} · {s.report.tier}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffList({ title, items, color }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div className="eyebrow" style={{ color }}>{title}</div>
      <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontFamily: 'monospace', fontSize: 12 }}>
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
