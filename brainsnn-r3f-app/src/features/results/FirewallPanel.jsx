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
  const techniques = Array.isArray(fw.techniques) ? fw.techniques : [];

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

      <article className="firewall-techniques">
        <div className="firewall-techniques-head">
          <h3>Published persuasion techniques</h3>
          <span>{techniques.length ? `${techniques.length} detected` : 'none detected'}</span>
        </div>
        <p className="bsn-note">
          Named using the SemEval propaganda/persuasion taxonomies, so a detection can be
          checked against outside annotation rather than only against us.
        </p>
        {techniques.length ? (
          <ul className="firewall-technique-list">
            {techniques.map((technique) => (
              <li key={technique.id}>
                <div className="firewall-technique-head">
                  <strong>{technique.label}</strong>
                  <span>{technique.confidence}%</span>
                </div>
                <p className="firewall-technique-class">
                  {technique.published}
                  {technique.mapping === 'approximate' ? (
                    <span
                      className="firewall-technique-approx"
                      title={technique.mappingNote}
                    >
                      approximate match
                    </span>
                  ) : null}
                </p>
                <p>{technique.description}</p>
                {technique.matches?.length ? (
                  <p className="firewall-technique-matches">
                    {technique.matches.map((match) => (
                      <code key={match}>{match}</code>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="bsn-note">No taxonomy technique matched. That is a weaker claim than
            &ldquo;no manipulation&rdquo;: the detector matches cue phrases, so novel phrasings are missed.</p>
        )}
        {fw.techniqueLimits ? <p className="firewall-technique-limits">{fw.techniqueLimits}</p> : null}
      </article>
    </section>
  );
}
