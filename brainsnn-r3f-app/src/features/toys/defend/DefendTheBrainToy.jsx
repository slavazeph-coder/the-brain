// Defend the Brain, promoted from Lab 014 in the arcade to a first-class toy.
// The game itself is untouched — this page gives it a route, a share card and
// the toy chrome. The arcade still hosts the same component. A shared card links
// back to the same level and mode via the arcade's own challenge encoding.
import React, { Suspense, useCallback, useState } from 'react';
import { ShieldHalf } from 'lucide-react';
import { track } from '../../../lib/analytics.js';
import { BRAIN_CLAIM_BOUNDARY } from '../../brain3d/brainMetrics.js';
import { getToy } from '../toyConfig.js';
import { SponsorSlot, ToyPage } from '../ToyChrome.jsx';
import { ToyShareBar } from '../ToyShareBar.jsx';
import { DEFEND_BOUNDARY, DEFEND_SCORE_NOTE, defendChallengeParams, defendTitle } from './defendShare.js';

const BrainGameLab = React.lazy(() => import('../../gaugegap/BrainGameLab.jsx').then((module) => ({ default: module.BrainGameLab })));

const TOY = getToy('defend');

export function DefendTheBrainToy() {
  const [run, setRun] = useState(null);
  const onRunComplete = useCallback((report) => {
    setRun(report);
    track('toy_defend_finished', { toy: TOY.id, status: report.status, defense: report.scores.defense, mode: report.mode });
  }, []);

  return (
    <ToyPage toy={TOY} title="Defend the Brain | BrainSNN">
      <section className="toy-hero" aria-labelledby="defend-title">
        <p className="bh-kicker"><ShieldHalf size={15} aria-hidden="true" /> TOY {TOY.number} · FROM THE ARCADE</p>
        <h1 id="defend-title">Can you keep the brain <span>from getting hijacked?</span></h1>
        <p className="toy-lead">
          Persuasion packets from real text attack a live seven-region brain model. Cut a pathway, silence the threat
          loop, boost judgment — on a budget. Paste your own writing and it becomes the level.
        </p>
      </section>

      <div className="gg-site toy-defend-embed" data-testid="defend-embed">
        <div className="gg-arcade-stage" data-experiment="braingame">
          <Suspense fallback={<div className="toy-loading" role="status">Loading the brain…</div>}>
            <BrainGameLab onRunComplete={onRunComplete} />
          </Suspense>
        </div>
      </div>

      <section className="toy-panel defend-card" aria-live="polite" data-testid="defend-card">
        {run ? (
          <>
            <p className="bh-kicker">YOUR LAST RUN</p>
            <h2>{defendTitle(run)}</h2>
            <p className="fool-score"><strong>{run.scores.defense}</strong><span>defense</span></p>
            <ul className="fool-stats">
              <li><strong>{run.hijack}</strong> hijack</li>
              <li><strong>{run.control}</strong> control</li>
              <li><strong>{run.blocked}/{run.resolved || 0}</strong> packets stopped</li>
            </ul>
            <ToyShareBar
              toyId={TOY.id}
              params={defendChallengeParams(run)}
              result={`${defendTitle(run)} — defense ${run.scores.defense} on ${run.levelTitle}.`}
              card={{
                headline: defendTitle(run),
                score: run.scores.defense,
                scoreLabel: 'defense',
                lines: [`Level: ${run.levelTitle}`, `Hijack ${run.hijack} · control ${run.control}`],
                boundary: `${DEFEND_SCORE_NOTE} ${DEFEND_BOUNDARY}`,
              }}
            />
          </>
        ) : (
          <p className="fool-muted">Finish a mission or challenge run and your score card appears here, ready to share.</p>
        )}
        <p className="fool-muted">{DEFEND_SCORE_NOTE} {DEFEND_BOUNDARY} {BRAIN_CLAIM_BOUNDARY}</p>
        <SponsorSlot toyId={TOY.id} />
      </section>
    </ToyPage>
  );
}
