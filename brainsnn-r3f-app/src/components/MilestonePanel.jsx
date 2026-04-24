import React from 'react';
import { LAYER_CATALOG, LAYER_GROUPS } from '../utils/layerCatalog';
import { getImmunityState } from '../utils/immunityScore';
import { getStreak } from '../utils/dailyChallenge';
import { recentReceipts } from '../utils/receipt';

/**
 * Layer 100 — Milestone Dashboard
 *
 * Synthesis page for the big round number. Breaks all 100 layers by
 * group, shows your personal engagement stats, and frames the arc.
 */
export default function MilestonePanel() {
  const total = LAYER_CATALOG.length;
  const byGroup = {};
  for (const l of LAYER_CATALOG) byGroup[l.group] = (byGroup[l.group] || 0) + 1;

  const imm = getImmunityState();
  const streak = getStreak();
  const receipts = recentReceipts();
  const scanCount = (imm.events || []).filter((e) => e.type === 'firewall_scan').length;

  return (
    <section
      className="panel panel-pad milestone-panel"
      style={{
        background: 'linear-gradient(135deg, rgba(90,212,255,0.08) 0%, rgba(168,111,223,0.06) 100%)',
        borderLeft: '3px solid #5ad4ff',
      }}
    >
      <div className="eyebrow" style={{ letterSpacing: 6 }}>Layer 100 · milestone</div>
      <h2 style={{ fontSize: 28, marginBottom: 6 }}>
        <span style={{ fontSize: 48, fontWeight: 800, color: '#5ad4ff' }}>{total}</span>
        <span className="muted" style={{ marginLeft: 10 }}>cognitive layers shipped</span>
      </h2>
      <p className="muted" style={{ maxWidth: 720 }}>
        BrainSNN started as a 3D brain viewer. It grew into a Cognitive
        Firewall, then a multimodal analysis suite, then a progression
        system, then a multi-device share surface, then an extensible API.
        Every layer is still one scroll away.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 16 }}>
        {Object.entries(LAYER_GROUPS).map(([id, g]) => (
          <div
            key={id}
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              borderLeft: `3px solid ${g.color}`,
              background: 'rgba(0,0,0,0.18)',
            }}
          >
            <div className="muted small-note">{g.label}</div>
            <strong style={{ fontSize: 28, color: g.color }}>{byGroup[id] || 0}</strong>
            <div className="muted small-note" style={{ marginTop: 2 }}>layers in this group</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Your engagement</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <Stat label="Immunity score" value={`${imm.score || 0}/100`} />
          <Stat label="Daily streak" value={`${streak.streak || 0} d`} />
          <Stat label="Total scans" value={scanCount} />
          <Stat label="Receipts stored" value={receipts.length} />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>How to explore</div>
        <ul className="muted" style={{ lineHeight: 1.65, paddingLeft: 20, margin: 0, fontSize: 14 }}>
          <li>⌘K to fuzzy-search any layer by name or number</li>
          <li>Shift-? for the 2-letter hotkey cheat sheet</li>
          <li>Open the Role Tour (Layer 94) for a guided 6-step path</li>
          <li>Browse the Layer Explorer (Layer 72) for a searchable index</li>
        </ul>
      </div>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
      <div className="muted small-note">{label}</div>
      <strong style={{ fontSize: 24, color: '#f1ece5' }}>{value}</strong>
    </div>
  );
}
