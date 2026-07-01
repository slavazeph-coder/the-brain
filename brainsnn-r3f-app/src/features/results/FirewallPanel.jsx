import React from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Meter } from '../../components/ui/Meter.jsx';

const GRADE_TONE = { A: 'success', B: 'success', C: 'warning', D: 'warning', E: 'danger', F: 'danger' };
const CATEGORY_COLOR = { urgency: 'yellow', outrage: 'red', fear: 'red', certainty: 'purple', trust: 'green' };

function pressureClass(pressure) {
  if (pressure >= 60) return 'fw-seg-hot';
  if (pressure >= 30) return 'fw-seg-warm';
  return 'fw-seg-cool';
}

export function FirewallPanel({ result }) {
  const fw = result?.firewallSignals;
  if (!fw || !Array.isArray(fw.categories)) return null;
  const heatmap = Array.isArray(fw.heatmap) ? fw.heatmap : [];
  const tactics = Array.isArray(fw.tactics) ? fw.tactics : [];

  return (
    <section className="firewall-panel" aria-labelledby="firewall-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Layer 4 · cognitive firewall</p>
          <h2 id="firewall-heading">Manipulation pressure</h2>
        </div>
        <Badge tone={GRADE_TONE[fw.grade] || 'cyan'}>Grade {fw.grade} · {fw.tier}</Badge>
      </div>

      <div className="firewall-gauges">
        <Meter label="Manipulation pressure" value={Math.round((fw.manipulationPressure || 0) * 100)} color="red" explanation="Combined emotional + cognitive + trust pressure." />
        {fw.categories.map((cat) => (
          <Meter key={cat.id} label={cat.label} value={cat.score} color={CATEGORY_COLOR[cat.id] || 'cyan'} explanation={cat.matches?.length ? cat.matches.slice(0, 3).join(', ') : 'No matches.'} />
        ))}
      </div>

      <div className="firewall-grid">
        <article>
          <h3>Where the pressure is</h3>
          {heatmap.length ? (
            <div className="firewall-heatmap">
              {heatmap.map((seg) => (
                <span key={seg.id} className={`firewall-seg ${pressureClass(seg.pressure)}`} title={`${seg.top} · pressure ${seg.pressure}`}>
                  {seg.text}
                </span>
              ))}
            </div>
          ) : <p className="bsn-note">No sentence-level pressure detected.</p>}
        </article>
        <article>
          <h3>Tactics detected</h3>
          <ul className="firewall-tactics">
            {tactics.map((tactic) => (
              <li key={tactic.id}>
                <div className="firewall-tactic-head">
                  <strong>{tactic.label}</strong>
                  <span>{tactic.confidence}%</span>
                </div>
                <p>{tactic.risk}</p>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
