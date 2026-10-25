import React from 'react';
import { BrainCircuit, GitCompareArrows, Radar, Sparkles } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(1).padStart(4, '0')}`;
}

function formatRange(item) {
  if (!item) return '—';
  return `${formatTime(item.start)}–${formatTime(item.end)}`;
}

function percent(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function agreementTone(score = 0) {
  if (score >= 0.7) return 'cyan';
  if (score < 0.45) return 'warning';
  return 'neutral';
}

export function BeliefReportPanel({ report }) {
  if (!report?.windows?.length) return null;
  const summary = report.summary || {};
  const notable = report.windows
    .filter((item) => item.surprise >= 0.42 || item.agreement?.label === 'review' || item.stateChanged)
    .sort((a, b) => {
      const aScore = (a.surprise || 0) + (1 - (a.agreement?.score ?? 0.5)) + (a.stateChanged ? 0.15 : 0);
      const bScore = (b.surprise || 0) + (1 - (b.agreement?.score ?? 0.5)) + (b.stateChanged ? 0.15 : 0);
      return bScore - aScore;
    })
    .slice(0, 6);

  return (
    <section className="belief-report-panel" aria-labelledby="belief-report-heading">
      <header className="belief-report-head">
        <div className="belief-report-title">
          <BrainCircuit size={19} aria-hidden="true" />
          <div>
            <span className="bsn-eyebrow">Pattern intelligence</span>
            <h3 id="belief-report-heading">Belief Report V0.1</h3>
          </div>
        </div>
        <div className="belief-report-badges">
          <Badge tone="cyan">S-DBN READY</Badge>
          <Badge tone="neutral">PROXY · NO TRAINED WEIGHTS</Badge>
        </div>
      </header>

      <p className="belief-report-intro">
        BrainSNN groups each time window into a latent pattern state, measures how unusual that window is relative to this scan, and checks whether that pattern agrees with the deterministic evidence. The current V0.1 state assignment is a deterministic proxy designed to be replaced by trained S-DBN weights later.
      </p>

      <div className="belief-report-stats" aria-label="Belief report summary">
        <article><small>DOMINANT STATE</small><strong>{summary.dominantState == null ? '—' : `S${String(summary.dominantState).padStart(2, '0')}`}</strong><span>{summary.uniqueStates || 0} unique states</span></article>
        <article><small>STATE CHANGES</small><strong>{summary.stateTransitions ?? 0}</strong><span>pattern transitions</span></article>
        <article><small>MEAN SURPRISE</small><strong>{percent(summary.meanSurprise)}</strong><span>within-scan novelty proxy</span></article>
        <article><small>MODEL AGREEMENT</small><strong>{percent(summary.agreementScore)}</strong><span>rules vs pattern layer</span></article>
      </div>

      <div className="belief-report-callouts">
        <article>
          <Radar size={16} aria-hidden="true" />
          <div><small>HIGHEST PATTERN SURPRISE</small><strong>{formatRange(summary.highestSurprise)}</strong><span>{summary.highestSurprise ? `${percent(summary.highestSurprise.value)} · state S${String(summary.highestSurprise.stateId).padStart(2, '0')}` : 'No window available'}</span></div>
        </article>
        <article>
          <Sparkles size={16} aria-hidden="true" />
          <div><small>LARGEST STATE TRANSITION</small><strong>{formatRange(summary.highestTransition)}</strong><span>{summary.highestTransition ? percent(summary.highestTransition.value) : 'No transition available'}</span></div>
        </article>
        <article className={summary.highestDisagreement?.agreementScore < 0.45 ? 'review' : ''}>
          <GitCompareArrows size={16} aria-hidden="true" />
          <div><small>CROSS-MODEL DISAGREEMENT</small><strong>{formatRange(summary.highestDisagreement)}</strong><span>{summary.highestDisagreement ? `${percent(summary.highestDisagreement.agreementScore)} agreement · ${summary.highestDisagreement.label}` : 'No disagreement window'}</span></div>
        </article>
      </div>

      {notable.length ? (
        <div className="belief-window-table" role="table" aria-label="Notable learned-pattern windows">
          <div className="belief-window-row belief-window-head" role="row">
            <span role="columnheader">Time</span><span role="columnheader">State</span><span role="columnheader">Surprise</span><span role="columnheader">Agreement</span><span role="columnheader">Why review</span>
          </div>
          {notable.map((item, index) => (
            <div className="belief-window-row" role="row" key={`${item.start}-${item.stateId}-${index}`}>
              <span role="cell">{formatRange(item)}</span>
              <span role="cell"><b>S{String(item.stateId).padStart(2, '0')}</b>{item.stateChanged ? <small>state change</small> : <small>stable state</small>}</span>
              <span role="cell"><b>{percent(item.surprise)}</b><small>pattern surprise</small></span>
              <span role="cell"><Badge tone={agreementTone(item.agreement?.score)}>{percent(item.agreement?.score)} · {item.agreement?.label || 'mixed'}</Badge></span>
              <span role="cell">{item.agreement?.label === 'review'
                ? 'The learned-pattern proxy and deterministic BrainSNN signals do not tell the same story here. Review manually instead of averaging them into one score.'
                : item.surprise >= 0.42
                  ? 'This window differs materially from the scan baseline. Inspect what changed in the visual, audio or semantic mix.'
                  : 'A latent state transition makes this a useful boundary for creative review.'}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="belief-report-calm">No high-surprise or disagreement window crossed the V0.1 review threshold.</p>
      )}

      <footer>
        <strong>Claim boundary</strong>
        <p>{report.disclaimer}</p>
      </footer>
    </section>
  );
}
