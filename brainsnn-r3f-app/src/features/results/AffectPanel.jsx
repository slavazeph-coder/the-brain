import React from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Meter } from '../../components/ui/Meter.jsx';

const AFFECT_COLOR = {
  outrage: 'red', anger: 'red', fear: 'red', sadness: 'purple',
  anticipation: 'yellow', curiosity: 'cyan', joy: 'green', trust: 'green', calm: 'green',
};

function toXY(x, y) {
  return { cx: 50 + (Number(x) || 0) * 44, cy: 50 - (Number(y) || 0) * 44 };
}

// Russell valence×arousal circumplex: horizontal = valence, vertical = arousal.
function Circumplex({ taxonomy, point }) {
  return (
    <svg className="affect-circumplex" viewBox="0 0 100 100" role="img" aria-label="Affect plotted on Russell's valence-arousal circumplex">
      <circle cx="50" cy="50" r="46" className="affect-ring" />
      <line x1="4" y1="50" x2="96" y2="50" className="affect-axis" />
      <line x1="50" y1="4" x2="50" y2="96" className="affect-axis" />
      {taxonomy.map((affect) => {
        const { cx, cy } = toXY(affect.x, affect.y);
        const r = 1.6 + (Number(affect.score) || 0) / 100 * 4;
        return <circle key={affect.id} cx={cx.toFixed(2)} cy={cy.toFixed(2)} r={r.toFixed(2)} className="affect-dot" opacity={(0.22 + (Number(affect.score) || 0) / 150).toFixed(2)} />;
      })}
      {point ? (() => { const { cx, cy } = toXY(point.x, point.y); return <circle cx={cx.toFixed(2)} cy={cy.toFixed(2)} r="3.6" className="affect-point" />; })() : null}
      <text x="97" y="47" className="affect-axis-label" textAnchor="end">valence +</text>
      <text x="52" y="9" className="affect-axis-label">arousal +</text>
    </svg>
  );
}

export function AffectPanel({ result }) {
  const affect = result?.affectProfile;
  if (!affect || !Array.isArray(affect.taxonomy)) return null;
  const top = affect.taxonomy.slice(0, 4);

  return (
    <section className="affect-panel" aria-labelledby="affect-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Layer 29 · affective decoder</p>
          <h2 id="affect-heading">Which feeling it installs</h2>
        </div>
        <Badge tone="purple">{affect.dominantEmotion || affect.dominantAffect}</Badge>
      </div>

      <div className="affect-layout">
        <div className="affect-viz">
          <Circumplex taxonomy={affect.taxonomy} point={affect.circumplex} />
          <p className="bsn-note">Dominant affect: {affect.dominantAffect} · valence {affect.valence} · arousal {affect.arousal}.</p>
        </div>
        <div className="affect-bars">
          {top.map((item) => (
            <Meter key={item.id} label={item.label} value={item.score} color={AFFECT_COLOR[item.id] || 'cyan'} explanation={`v ${item.x} · a ${item.y}`} />
          ))}
        </div>
      </div>
    </section>
  );
}
