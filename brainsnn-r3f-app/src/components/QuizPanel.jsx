import React, { useEffect, useMemo, useState } from 'react';
import {
  QUIZ_ITEMS, quizAccuracy, quizBreakdown, gradeGuess
} from '../utils/quizCorpus';
import {
  buildQuizPayload, quizUrl, quizLevelFor, sanitizeHandle
} from '../utils/quizCard';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';

const HANDLE_KEY = 'brainsnn_handle_v1';

function readHandle() {
  try { return localStorage.getItem(HANDLE_KEY) || ''; } catch { return ''; }
}
function writeHandle(h) {
  try { localStorage.setItem(HANDLE_KEY, h); } catch { /* quota */ }
}

/**
 * Spot-the-Manipulation quiz — 10 items, slider 0–100 per item, grade
 * against the Cognitive Firewall's truth scores, end with a shareable
 * accuracy card (/q/<hash>).
 */
export default function QuizPanel({ onApplyResult }) {
  const [started, setStarted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [guesses, setGuesses] = useState({});
  const [handle, setHandle] = useState(readHandle());
  const [startedAt, setStartedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const [finished, setFinished] = useState(false);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => { writeHandle(handle); }, [handle]);

  const item = QUIZ_ITEMS[idx];
  const total = QUIZ_ITEMS.length;
  const answered = Object.keys(guesses).length;
  const accuracy = useMemo(() => quizAccuracy(guesses), [guesses]);
  const breakdown = useMemo(() => quizBreakdown(guesses), [guesses]);
  const correct = breakdown.filter((b) => b.correct).length;
  const seconds = finished ? Math.max(1, Math.round((finished - startedAt) / 1000)) : 0;
  const level = quizLevelFor(accuracy);

  function begin() {
    setStarted(true);
    setStartedAt(Date.now());
    setFinished(false);
    setRecorded(false);
    setIdx(0);
    setGuesses({});
  }

  function answer(value) {
    const nextGuesses = { ...guesses, [item.id]: value };
    setGuesses(nextGuesses);
    if (idx < total - 1) {
      setIdx(idx + 1);
    } else {
      setFinished(Date.now());
    }
  }

  // Bump Immunity once per completed quiz
  useEffect(() => {
    if (finished && !recorded) {
      setRecorded(true);
      try {
        recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
          pressure: 1 - accuracy / 100,
          confidence: 'quiz',
        });
      } catch { /* swallow */ }
    }
  }, [finished, recorded, accuracy]);

  async function handleShare() {
    const payload = buildQuizPayload({
      handle: sanitizeHandle(handle || 'anon'),
      accuracy,
      correct,
      total,
      seconds,
    });
    const url = quizUrl(window.location.origin, payload);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy your quiz result URL:', url);
    }
  }

  function handleTweet() {
    const payload = buildQuizPayload({
      handle: sanitizeHandle(handle || 'anon'),
      accuracy,
      correct,
      total,
      seconds,
    });
    const url = quizUrl(window.location.origin, payload);
    const tweet = `I spotted ${correct}/${total} manipulation attempts — ${accuracy}% accuracy · ${level.label}. Where's your brain? ${url}`;
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweet)}`,
      '_blank',
      'noopener'
    );
  }

  function applyToBrain() {
    if (onApplyResult) onApplyResult({ accuracy, correct, total });
  }

  // ---------- intro ----------
  if (!started) {
    return (
      <section className="panel panel-pad quiz-panel">
        <div className="eyebrow">Viral challenge · 60 seconds</div>
        <h2>Spot the Manipulation</h2>
        <p className="muted">
          10 short messages. For each, slide toward "low pressure" (calm) or
          "high pressure" (manipulative). The Cognitive Firewall already knows
          the answers — how close can you get?
        </p>
        <div className="control-actions" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={begin}>Start quiz</button>
        </div>
      </section>
    );
  }

  // ---------- result ----------
  if (finished) {
    return (
      <section className="panel panel-pad quiz-panel">
        <div className="eyebrow">Quiz complete · {seconds}s</div>
        <h2>Spot Accuracy: <span style={{ color: level.color }}>{accuracy}%</span></h2>
        <p className="muted">
          You were within 20 points of the Firewall on <strong>{correct}</strong> of {total} items
          — verdict: <strong style={{ color: level.color }}>{level.label}</strong>.
        </p>

        <div className="quiz-handle" style={{ marginTop: 12 }}>
          <label className="share-label" htmlFor="quiz-handle-input">Handle (shown on share card)</label>
          <input
            id="quiz-handle-input"
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
            {copied ? 'Link copied ✓' : 'Share card'}
          </button>
          <button className="btn" onClick={handleTweet}>Tweet result</button>
          {onApplyResult && (
            <button className="btn" onClick={applyToBrain}>Apply to brain</button>
          )}
          <button className="btn" onClick={begin}>Try again</button>
        </div>

        <div className="quiz-breakdown" style={{ marginTop: 16 }}>
          <div className="eyebrow">Per-item breakdown</div>
          {breakdown.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
              }}
            >
              <span>{row.label}</span>
              <span style={{ fontFamily: 'monospace', color: row.correct ? level.color : '#94a3b8' }}>
                truth {row.truth} · you {row.guess ?? '–'}{' '}
                {row.correct ? '✓' : ''}
              </span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  // ---------- active question ----------
  const currentGuess = guesses[item.id];

  return (
    <section className="panel panel-pad quiz-panel">
      <div className="eyebrow">
        Question {idx + 1} of {total} · {answered} answered
      </div>
      <h2 style={{ marginBottom: 4 }}>Spot the Manipulation</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Rate how manipulative this message feels — 0 = calm, 100 = hostile pressure.
      </p>

      <blockquote
        style={{
          margin: '12px 0',
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

      <div className="quiz-slider" style={{ marginTop: 16 }}>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={currentGuess ?? 50}
          onChange={(e) => setGuesses({ ...guesses, [item.id]: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 12,
            color: '#94a3b8',
            marginTop: 4,
          }}
        >
          <span>0 — calm</span>
          <strong style={{ color: '#f1ece5' }}>{currentGuess ?? 50}</strong>
          <span>100 — manipulative</span>
        </div>
      </div>

      <div className="control-actions" style={{ marginTop: 14 }}>
        <button
          className="btn primary"
          onClick={() => answer(currentGuess ?? 50)}
        >
          {idx < total - 1 ? 'Lock in · next' : 'Lock in · see result'}
        </button>
        <button
          className="btn"
          onClick={() => answer(100)}
          title="Mark as obviously manipulative"
        >
          Obviously 100%
        </button>
        <button
          className="btn"
          onClick={() => answer(0)}
          title="Mark as obviously benign"
        >
          Obviously 0%
        </button>
      </div>
    </section>
  );
}
