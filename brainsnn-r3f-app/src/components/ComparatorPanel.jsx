import React, { useMemo, useState } from 'react';
import { compareRulesets } from '../utils/comparator';
import { DEFAULT_RULES, getActiveRules } from '../utils/cognitiveFirewall';

/**
 * Layer 74 — Firewall Comparator panel.
 * Run the same text through DEFAULT_RULES and the active ruleset
 * (defaults ∪ custom, or evolved). See the delta + evidence diff.
 */
export default function ComparatorPanel() {
  const [text, setText] = useState('URGENT: shocking scandal! Everyone knows they covered it up. 100% guaranteed disaster if you don\'t act now.');

  const report = useMemo(() => {
    if (text.trim().length < 5) return null;
    return compareRulesets(text, DEFAULT_RULES, getActiveRules());
  }, [text]);

  return (
    <section className="panel panel-pad comparator-panel">
      <div className="eyebrow">Layer 74 · firewall comparator</div>
      <h2>Defaults vs active ruleset</h2>
      <p className="muted">
        Runs the same text through the stock ruleset and whatever's currently
        active (defaults + your custom Layer 55 rules, or an evolved Layer 31
        set). Shows the pressure delta + evidence diff so you can see what
        your changes actually caught.
      </p>

      <textarea
        className="firewall-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        style={{ marginTop: 10 }}
      />

      {report && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <SideCard label="Defaults (A)" score={report.a} tone="#77dbe4" />
            <SideCard label="Active (B)" score={report.b} tone="#fdab43" />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              marginTop: 10,
            }}
          >
            <span>Pressure delta (B - A)</span>
            <strong style={{ color: report.delta > 0 ? '#5ee69a' : report.delta < 0 ? '#dd6974' : '#94a3b8', fontFamily: 'monospace' }}>
              {report.delta > 0 ? '+' : ''}{Math.round(report.delta * 100)} pts
            </strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
            <EvidenceList label={`Only A (${report.onlyA.length})`} items={report.onlyA} color="#77dbe4" />
            <EvidenceList label={`Shared (${report.shared.length})`} items={report.shared} color="#cbd5e1" />
            <EvidenceList label={`Only B (${report.onlyB.length})`} items={report.onlyB} color="#fdab43" />
          </div>
        </div>
      )}
    </section>
  );
}

function SideCard({ label, score, tone }) {
  const s = score.score;
  const p = Math.round(score.pressure * 100);
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        borderLeft: `3px solid ${tone}`,
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{label}</strong>
        <span style={{ color: tone, fontFamily: 'monospace', fontWeight: 700 }}>{p}%</span>
      </div>
      <div className="muted small-note" style={{ marginTop: 4 }}>
        emo {Math.round((s.emotionalActivation || 0) * 100)}%
        {' · '}cog {Math.round((s.cognitiveSuppression || 0) * 100)}%
        {' · '}man {Math.round((s.manipulationPressure || 0) * 100)}%
        {' · '}trust {Math.round((s.trustErosion || 0) * 100)}%
      </div>
    </div>
  );
}

function EvidenceList({ label, items, color }) {
  return (
    <div>
      <div className="eyebrow" style={{ color }}>{label}</div>
      {items.length === 0 ? (
        <p className="muted small-note" style={{ marginTop: 4 }}>—</p>
      ) : (
        <div style={{ marginTop: 4 }}>
          {items.slice(0, 14).map((e, i) => (
            <span
              key={i}
              className="firewall-chip"
              style={{ marginRight: 4, marginBottom: 4, borderColor: color, color: '#e6f1ff' }}
            >
              {e}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
