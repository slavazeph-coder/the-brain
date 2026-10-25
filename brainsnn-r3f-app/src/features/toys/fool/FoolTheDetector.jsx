import React, { useMemo, useRef, useState } from 'react';
import { ArrowRight, EyeOff, RotateCcw, ScanSearch, ShieldAlert, ShieldCheck } from 'lucide-react';
import { track } from '../../../lib/analytics.js';
import { getToy } from '../toyConfig.js';
import { SponsorSlot, ToyPage } from '../ToyChrome.jsx';
import { ToyShareBar } from '../ToyShareBar.jsx';
import {
  DETECTOR_LIMITS,
  FOOL_BOUNDARY,
  FOOL_HONESTY,
  FOOL_MAX_CHARS,
  FOOL_ROUNDS,
  judgeRound,
  summarizeGame,
  validateLine,
} from './foolDetector.js';

const TOY = getToy('fool');

const OUTCOME = {
  slipped: { label: 'Slipped past', icon: EyeOff, className: 'is-slipped' },
  partial: { label: 'Half-seen', icon: ShieldAlert, className: 'is-partial' },
  caught: { label: 'Caught', icon: ShieldCheck, className: 'is-caught' },
};

function RoundResult({ result }) {
  const outcome = OUTCOME[result.outcome];
  const Icon = outcome.icon;
  return (
    <div className={`fool-result ${outcome.className}`} role="status" data-testid="fool-result">
      <div className="fool-result-head">
        <span><Icon size={18} aria-hidden="true" /> {outcome.label}</span>
        <strong>+{result.points}</strong>
      </div>
      {result.caught.length ? <p>It named: <b>{result.caught.join(', ')}</b>.</p> : null}
      {result.slippedTargets.length ? <p>It missed: <b>{result.slippedTargets.join(', ')}</b>.</p> : null}
      {result.flagged.length ? (
        <ul className="fool-flags">
          {result.flagged.map((flag) => (
            <li key={flag.id}><span>{flag.label}</span>{flag.matches.map((match) => <code key={match}>{match}</code>)}</li>
          ))}
        </ul>
      ) : <p className="fool-muted">Nothing flagged at all. That is the detector finding no cue it knows — not proof the line is clean.</p>}
    </div>
  );
}

export function FoolTheDetector() {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [pending, setPending] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const round = FOOL_ROUNDS[index];
  const summary = useMemo(() => summarizeGame(results), [results]);
  const finished = results.length === FOOL_ROUNDS.length && !pending;

  function submit(event) {
    event.preventDefault();
    const problem = validateLine(text);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    const result = judgeRound(round, text);
    setPending(result);
  }

  function next() {
    const nextResults = [...results, pending];
    setResults(nextResults);
    setPending(null);
    setText('');
    if (index + 1 < FOOL_ROUNDS.length) {
      setIndex(index + 1);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      const final = summarizeGame(nextResults);
      track('toy_fool_finished', { toy: TOY.id, score: final.score, rank: final.rank });
    }
  }

  function restart() {
    setIndex(0);
    setText('');
    setResults([]);
    setPending(null);
    setError('');
  }

  return (
    <ToyPage toy={TOY} title="Fool the Detector | BrainSNN">
      <section className="toy-hero" aria-labelledby="fool-title">
        <p className="bh-kicker"><ScanSearch size={15} aria-hidden="true" /> TOY {TOY.number} · FIVE ROUNDS</p>
        <h1 id="fool-title">Can you fool our <span>AI detector?</span></h1>
        <p className="toy-lead">
          Write a line that uses the trick — without the detector naming it. It is the same detector the analyzer runs,
          and its blind spots are published. {FOOL_HONESTY}
        </p>
      </section>

      <section className="toy-panel fool-panel" aria-live="polite" data-testid="fool-panel">
        <ol className="fool-steps" aria-label="Rounds">
          {FOOL_ROUNDS.map((entry, position) => {
            const done = results[position];
            const state = done ? done.outcome : position === index && !finished ? 'current' : 'todo';
            return <li key={entry.id} className={`is-${state}`}><span>{position + 1}</span></li>;
          })}
        </ol>

        {!finished ? (
          <>
            <div className="fool-round-head">
              <p className="bh-kicker">ROUND {index + 1} OF {FOOL_ROUNDS.length}</p>
              <h2>{round.title}</h2>
              <p>{round.brief}</p>
              <p className="fool-caught-example"><span>The obvious version, which it catches:</span> “{round.caught}”</p>
            </div>
            {pending ? (
              <>
                <blockquote className="fool-line">{text}</blockquote>
                <RoundResult result={pending} />
                <button type="button" className="bh-button bh-primary" onClick={next} data-testid="fool-next">
                  {index + 1 < FOOL_ROUNDS.length ? 'Next round' : 'See your rank'} <ArrowRight size={16} aria-hidden="true" />
                </button>
              </>
            ) : (
              <form onSubmit={submit} className="fool-form">
                <label htmlFor="fool-line">Your line</label>
                <textarea
                  id="fool-line"
                  ref={inputRef}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={FOOL_MAX_CHARS}
                  rows={3}
                  placeholder="Say it the long way round…"
                  data-testid="fool-input"
                />
                <div className="fool-form-row">
                  <span className="fool-muted">{text.length}/{FOOL_MAX_CHARS}</span>
                  <button type="submit" className="bh-button bh-primary" data-testid="fool-submit">
                    Try it past the detector <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
                {error ? <p className="toy-error" role="alert">{error}</p> : null}
              </form>
            )}
          </>
        ) : (
          <div className="fool-final" data-testid="fool-final">
            <p className="bh-kicker">YOUR RANK</p>
            <h2>{summary.rank}</h2>
            <p className="fool-score"><strong>{summary.score}</strong><span>/100 evasion</span></p>
            <p>{summary.rankLine}</p>
            <ul className="fool-stats">
              <li><strong>{summary.slipped}</strong> slipped past</li>
              <li><strong>{summary.partial}</strong> half-seen</li>
              <li><strong>{summary.caught}</strong> caught</li>
            </ul>
            <ToyShareBar
              toyId={TOY.id}
              result={`${summary.rank} — ${summary.score}/100. ${summary.slipped} of 5 tricks slipped past.`}
              card={{
                headline: summary.rank,
                score: summary.score,
                scoreLabel: '/100 evasion',
                lines: [`${summary.slipped} of 5 tricks slipped past`, `${summary.caught} caught on sight`],
                boundary: FOOL_BOUNDARY,
                accent: 'violet',
              }}
            />
            <button type="button" className="bh-button bh-secondary" onClick={restart}><RotateCcw size={16} aria-hidden="true" /> Play again</button>
          </div>
        )}
        <SponsorSlot toyId={TOY.id} />
      </section>

      <section className="toy-limits" aria-labelledby="fool-limits-title">
        <h2 id="fool-limits-title">What the detector cannot see</h2>
        <p>{DETECTOR_LIMITS}</p>
        <p className="fool-muted">{FOOL_BOUNDARY} <a href="/evidence">Read the published evaluation</a>.</p>
      </section>
    </ToyPage>
  );
}
