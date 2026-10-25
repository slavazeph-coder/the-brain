import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Repeat, Swords, WandSparkles } from 'lucide-react';
import { track } from '../../../lib/analytics.js';
import { useReducedMotion } from '../../../hooks/useReducedMotion.js';
import { getToy } from '../toyConfig.js';
import { SponsorSlot, ToyPage } from '../ToyChrome.jsx';
import { ToyShareBar } from '../ToyShareBar.jsx';
import { DUEL_BOUNDARY, DUEL_MAX_CHARS, DUEL_SAMPLES, duel, validateDrafts } from './draftDuel.js';

const TOY = getToy('duel');
const ROUND_MS = 900;

function ClashRow({ round, revealed }) {
  const total = round.barA + round.barB || 1;
  // Where the two bars meet. Starts at the middle and is shoved to the final
  // point when the round is revealed — the clash.
  const split = revealed ? Math.max(12, Math.min(88, (round.barA / total) * 100)) : 50;
  const verdict = round.winner === 'draw' ? 'Draw' : `${round.winner} takes it`;
  return (
    <li className={`duel-row ${revealed ? 'is-revealed' : ''} winner-${round.winner}`} data-testid={`duel-row-${round.id}`}>
      <div className="duel-row-head">
        <strong>{round.label}</strong>
        <span>{round.blurb}</span>
        <em>{revealed ? verdict : '…'}</em>
      </div>
      <div className="duel-track" aria-label={`${round.label}: Draft A ${round.rawA}, Draft B ${round.rawB}`}>
        <span className="duel-bar duel-bar-a" style={{ width: `${split}%` }}><b>{revealed ? round.rawA : ''}</b></span>
        <span className="duel-bar duel-bar-b" style={{ width: `${100 - split}%` }}><b>{revealed ? round.rawB : ''}</b></span>
        <i className="duel-spark" style={{ left: `${split}%` }} aria-hidden="true" />
      </div>
    </li>
  );
}

export function DraftDuel() {
  const reducedMotion = useReducedMotion();
  const [drafts, setDrafts] = useState({ a: '', b: '' });
  const [result, setResult] = useState(null);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState('');
  const timerRef = useRef(null);
  const arenaRef = useRef(null);

  useEffect(() => () => window.clearInterval(timerRef.current), []);

  const done = result && revealed >= result.rounds.length;

  useEffect(() => {
    if (done) track('toy_duel_finished', { toy: TOY.id, winner: result.winner, a: result.winsA, b: result.winsB });
  }, [done, result]);

  function fight(event) {
    event?.preventDefault();
    const problem = validateDrafts(drafts.a, drafts.b);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const next = duel(drafts.a, drafts.b);
    window.clearInterval(timerRef.current);
    setResult(next);
    if (reducedMotion) {
      setRevealed(next.rounds.length);
    } else {
      setRevealed(0);
      let shown = 0;
      timerRef.current = window.setInterval(() => {
        shown += 1;
        setRevealed(shown);
        if (shown >= next.rounds.length) window.clearInterval(timerRef.current);
      }, ROUND_MS);
    }
    window.requestAnimationFrame(() => arenaRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }

  function change(side, value) {
    setDrafts((previous) => ({ ...previous, [side]: value }));
    setResult(null);
    setRevealed(0);
  }

  function loadSample() {
    setDrafts({ a: DUEL_SAMPLES.a, b: DUEL_SAMPLES.b });
    setResult(null);
    setRevealed(0);
    setError('');
  }

  function swap() {
    setDrafts((previous) => ({ a: previous.b, b: previous.a }));
    setResult(null);
    setRevealed(0);
  }

  const winnerName = result?.winner === 'draw' ? 'Nobody' : `Draft ${result?.winner}`;

  return (
    <ToyPage toy={TOY} title="Draft Duel | BrainSNN">
      <section className="toy-hero" aria-labelledby="duel-title">
        <p className="bh-kicker"><Swords size={15} aria-hidden="true" /> TOY {TOY.number} · FIVE ROUNDS</p>
        <h1 id="duel-title">Make two drafts <span>fight.</span></h1>
        <p className="toy-lead">Paste two versions of anything — an email, a post, a pitch. They trade blows on trust, calm, clean play, warmth and spark, scored by the same deterministic engine the analyzer uses. Everything stays in your browser.</p>
      </section>

      <form className="toy-panel duel-form" onSubmit={fight} data-testid="duel-form">
        <div className="duel-inputs">
          <label className="duel-input duel-input-a" htmlFor="duel-a">
            <span>Draft A</span>
            <textarea id="duel-a" value={drafts.a} onChange={(event) => change('a', event.target.value)} maxLength={DUEL_MAX_CHARS} rows={6} placeholder="The version you have…" data-testid="duel-a" />
          </label>
          <span className="duel-vs" aria-hidden="true">VS</span>
          <label className="duel-input duel-input-b" htmlFor="duel-b">
            <span>Draft B</span>
            <textarea id="duel-b" value={drafts.b} onChange={(event) => change('b', event.target.value)} maxLength={DUEL_MAX_CHARS} rows={6} placeholder="The version you are considering…" data-testid="duel-b" />
          </label>
        </div>
        <div className="duel-actions">
          <button type="submit" className="bh-button bh-primary" data-testid="duel-fight"><Swords size={16} aria-hidden="true" /> Fight</button>
          <button type="button" className="bh-button bh-secondary" onClick={loadSample}><WandSparkles size={16} aria-hidden="true" /> Load a sample fight</button>
          <button type="button" className="bh-button bh-secondary" onClick={swap}><Repeat size={16} aria-hidden="true" /> Swap sides</button>
        </div>
        {error ? <p className="toy-error" role="alert">{error}</p> : null}
      </form>

      {result ? (
        <section className="toy-panel duel-arena" ref={arenaRef} aria-labelledby="duel-arena-title" data-testid="duel-arena">
          <div className="duel-score" aria-live="polite">
            <span className="duel-score-a">A <strong>{result.rounds.slice(0, revealed).filter((round) => round.winner === 'A').length}</strong></span>
            <h2 id="duel-arena-title">{done ? result.headline : `Round ${Math.min(revealed + 1, result.rounds.length)}…`}</h2>
            <span className="duel-score-b"><strong>{result.rounds.slice(0, revealed).filter((round) => round.winner === 'B').length}</strong> B</span>
          </div>
          <ol className="duel-rows">
            {result.rounds.map((round, position) => <ClashRow key={round.id} round={round} revealed={position < revealed} />)}
          </ol>
          {done ? (
            <div className="duel-verdict" data-testid="duel-verdict">
              <p>
                <strong>{winnerName}</strong>
                {result.winner === 'draw' ? ' — the drafts cancel out.' : ` won on ${result.wonOn.join(', ')}.`}
                {result.draws ? ` ${result.draws} round${result.draws === 1 ? '' : 's'} drawn.` : ''}
              </p>
              {result.techniquesA.length || result.techniquesB.length ? (
                <p className="fool-muted">Techniques detected — A: {result.techniquesA.join(', ') || 'none'} · B: {result.techniquesB.join(', ') || 'none'}.</p>
              ) : null}
              <ToyShareBar
                toyId={TOY.id}
                result={result.headline}
                card={{
                  headline: result.winner === 'draw' ? 'Dead heat' : `Draft ${result.winner} wins`,
                  score: `${result.winsA}–${result.winsB}`,
                  scoreLabel: 'rounds',
                  lines: result.winner === 'draw'
                    ? [`${result.draws} rounds drawn`]
                    : [`Won on ${result.wonOn.join(', ')}`],
                  boundary: DUEL_BOUNDARY,
                }}
              />
              <p className="fool-muted">{DUEL_BOUNDARY} <a href="/engine">Open the full comparison record <ArrowRight size={13} aria-hidden="true" /></a></p>
            </div>
          ) : null}
          <SponsorSlot toyId={TOY.id} />
        </section>
      ) : null}
    </ToyPage>
  );
}
