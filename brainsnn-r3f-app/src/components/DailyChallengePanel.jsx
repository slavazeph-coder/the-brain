import React, { useEffect, useMemo, useState } from 'react';
import {
  pickTodaysChallenge, challengeAccuracy, countCorrect,
  recordChallenge, getStreak, challengeDate,
} from '../utils/dailyChallenge';
import {
  buildDailyPayload, dailyUrl, dailyLevelFor, sanitizeHandle, decodeDaily,
} from '../utils/dailyCard';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';

const HANDLE_KEY = 'brainsnn_handle_v1';
const COMPLETED_KEY_PREFIX = 'brainsnn_daily_done_';

function readHandle() {
  try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; }
}
function writeHandle(h) {
  try { localStorage.setItem(HANDLE_KEY, h); } catch { /* quota */ }
}
function readCompleted(date) {
  try { return JSON.parse(localStorage.getItem(COMPLETED_KEY_PREFIX + date) || 'null'); } catch { return null; }
}
function writeCompleted(date, value) {
  try { localStorage.setItem(COMPLETED_KEY_PREFIX + date, JSON.stringify(value)); } catch { /* quota */ }
}

/**
 * Layer 38 — Daily Firewall Challenge.
 * Rotates every UTC day; same 3 items for everyone; streak tracked locally.
 */
export default function DailyChallengePanel({ initialHash = null }) {
  const today = challengeDate();
  const items = useMemo(() => pickTodaysChallenge(), []);
  const alreadyDone = useMemo(() => readCompleted(today), [today]);

  const [idx, setIdx] = useState(alreadyDone ? items.length : 0);
  const [guesses, setGuesses] = useState(alreadyDone?.guesses || {});
  const [handle, setHandle] = useState(readHandle());
  const [finished, setFinished] = useState(!!alreadyDone);
  const [streak, setStreak] = useState(getStreak());
  const [copied, setCopied] = useState(false);
  const [recorded, setRecorded] = useState(!!alreadyDone);

  const incoming = useMemo(() => initialHash ? decodeDaily(initialHash) : null, [initialHash]);

  const accuracy = useMemo(() => challengeAccuracy(items, guesses), [items, guesses]);
  const correct = useMemo(() => countCorrect(items, guesses), [items, guesses]);
  const level = dailyLevelFor(accuracy);

  useEffect(() => { writeHandle(handle); }, [handle]);

  // Record immunity + streak once per day
  useEffect(() => {
    if (!finished || recorded) return;
    setRecorded(true);
    writeCompleted(today, { guesses, accuracy, correct });
    const next = recordChallenge({ accuracy, correct });
    setStreak(next);
    try {
      recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
        pressure: 1 - accuracy / 100,
        confidence: 'daily',
      });
    } catch { /* swallow */ }
  }, [finished, recorded, guesses, accuracy, correct, today]);

  const item = items[idx];
  const currentGuess = item ? guesses[item.id] : undefined;

  function answer(value) {
    if (!item) return;
    const next = { ...guesses, [item.id]: value };
    setGuesses(next);
    if (idx < items.length - 1) {
      setIdx(idx + 1);
    } else {
      setFinished(true);
    }
  }

  async function handleShare() {
    const payload = buildDailyPayload({
      handle: sanitizeHandle(handle || 'anon'),
      date: today,
      accuracy,
      correct,
      streak: streak.streak,
    });
    const url = dailyUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy your daily card URL:', url);
    }
  }

  function handleTweet() {
    const payload = buildDailyPayload({
      handle: sanitizeHandle(handle || 'anon'),
      date: today,
      accuracy,
      correct,
      streak: streak.streak,
    });
    const url = dailyUrl(window.location.origin, payload);
    const tweet = `Daily Firewall Challenge · ${today}: ${correct}/${items.length} correct, ${accuracy}% — ${level.label}. ${streak.streak}-day streak. Beat it: ${url}`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`, '_blank', 'noopener');
  }

  // ---------- render ----------

  return (
    <section className="panel panel-pad daily-challenge-panel">
      <div className="eyebrow">Layer 38 · daily · {today}</div>
      <h2>Daily Firewall Challenge</h2>
      <p className="muted">
        Three items. The same three for everyone in the world today. Come
        back tomorrow for three more — streak keeps going as long as you
        play each UTC day.
      </p>

      {incoming && (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 14px',
            borderLeft: '3px solid #5ad4ff',
            background: 'rgba(90,212,255,0.05)',
            borderRadius: 6,
          }}
        >
          <strong>{incoming.handle}</strong> got{' '}
          <strong style={{ color: dailyLevelFor(incoming.accuracy).color }}>
            {incoming.correct}/3 · {incoming.accuracy}%
          </strong>{' '}
          on {incoming.date}. {incoming.streak}-day streak. <span className="muted">Beat it below.</span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.04)',
          marginBottom: 12,
        }}
      >
        <span className="muted">
          Streak · <strong>{streak.streak}</strong> day{streak.streak === 1 ? '' : 's'}
        </span>
        <span className="muted">
          Last played · <strong>{streak.lastDate || 'never'}</strong>
        </span>
      </div>

      {!finished && item && (
        <div className="daily-active">
          <div className="eyebrow">
            Item {idx + 1} of {items.length}
          </div>
          <blockquote
            style={{
              margin: '10px 0 12px',
              padding: '14px 18px',
              borderLeft: '3px solid #5ad4ff',
              background: 'rgba(90,212,255,0.04)',
              borderRadius: 6,
              fontStyle: 'italic',
              lineHeight: 1.4,
            }}
          >
            "{item.text}"
          </blockquote>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={currentGuess ?? 50}
            onChange={(e) => setGuesses({ ...guesses, [item.id]: Number(e.target.value) })}
            style={{ width: '100%' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            <span>0 — calm</span>
            <strong style={{ color: '#f1ece5' }}>{currentGuess ?? 50}</strong>
            <span>100 — manipulative</span>
          </div>
          <div className="control-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => answer(currentGuess ?? 50)}>
              {idx < items.length - 1 ? 'Lock in · next' : 'Lock in · see result'}
            </button>
            <button className="btn" onClick={() => answer(100)}>Obviously 100%</button>
            <button className="btn" onClick={() => answer(0)}>Obviously 0%</button>
          </div>
        </div>
      )}

      {finished && (
        <div className="daily-result">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 14px',
              borderRadius: 8,
              background: `${level.color}14`,
              borderLeft: `3px solid ${level.color}`,
              marginBottom: 12,
            }}
          >
            <span>
              <strong>{correct}/{items.length}</strong> correct · <strong>{accuracy}%</strong>
            </span>
            <strong style={{ color: level.color }}>{level.label}</strong>
          </div>

          <div className="eyebrow">Answer key</div>
          {items.map((it) => {
            const g = guesses[it.id];
            const ok = typeof g === 'number' && Math.abs(it.truth - g) <= 20;
            return (
              <div
                key={it.id}
                style={{
                  padding: '10px 12px',
                  borderLeft: `3px solid ${ok ? '#5ee69a' : '#dd6974'}`,
                  background: 'rgba(255,255,255,0.03)',
                  borderRadius: 6,
                  marginTop: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <strong>{it.label}</strong>
                  <span style={{ color: ok ? '#5ee69a' : '#dd6974', fontFamily: 'monospace' }}>
                    truth {it.truth} · you {g ?? '–'} {ok ? '✓' : '✗'}
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 0', fontStyle: 'italic' }}>"{it.text}"</p>
              </div>
            );
          })}

          <div style={{ marginTop: 12 }}>
            <label className="share-label" htmlFor="daily-handle-input">Handle</label>
            <input
              id="daily-handle-input"
              className="share-input"
              placeholder="anon"
              value={handle}
              onChange={(e) => setHandle(sanitizeHandle(e.target.value))}
              maxLength={24}
              style={{ marginTop: 6 }}
            />
          </div>

          <div className="control-actions" style={{ marginTop: 12 }}>
            <button className="btn" onClick={handleShare}>
              {copied ? 'Link copied ✓' : 'Share today\'s card'}
            </button>
            <button className="btn" onClick={handleTweet}>Tweet result</button>
          </div>
          <p className="muted small-note" style={{ marginTop: 10 }}>
            Next challenge drops at 00:00 UTC.
          </p>
        </div>
      )}
    </section>
  );
}
