import React, { useState } from 'react';
import { ArrowRight, ClipboardPaste, Eraser, Play, Share2, Sparkles, WandSparkles } from 'lucide-react';
import { Brain3D } from '../brain3d/Brain3D.jsx';
import { BrainVisualizer } from '../results/BrainVisualizer.jsx';
import { ShareDialog } from '../export/ShareDialog.jsx';
import { createRewrite } from '../improve/rewrite.js';
import { isKeyboardScanShortcut } from '../scan/keyboard.js';
import { getHeadlineScores } from '../../lib/headlineScores.js';
import { getClassicPreset } from '../../lib/classicPresets.js';
import { compareResults, deriveExecutiveVerdict } from '../../lib/scoreMapping.js';
import { MAX_SCAN_CHARS } from '../../lib/validation.js';
import { track } from '../../lib/analytics.js';
import { DeepLabHeading } from './DeepLabChrome.jsx';
import { useContentScan, scanContentLocally } from './useContentScan.js';

const GENRES = [
  { id: 'ad', label: 'Ad', presetId: 'luxury-scarcity-ad', placeholder: 'Paste ad copy — the promise, the pressure, the ask…' },
  { id: 'tweet', label: 'Tweet', presetId: 'outrage-bait-post', placeholder: 'Paste a post or hook — the first line does the damage…' },
  { id: 'landing', label: 'Landing page', presetId: 'guru-urgency-pitch', placeholder: 'Paste a hero section or pitch — headline to call-to-action…' },
  { id: 'email', label: 'Email', presetId: 'account-phishing-email', placeholder: 'Paste an email — subject line and body both count…' },
];

const REWRITE_ACTIONS = [
  { goal: 'trust', label: 'Build trust' },
  { goal: 'urgency', label: 'Add real urgency' },
  { goal: 'reduce-risk', label: 'Reduce manipulation' },
];

const PLACEHOLDER_TILES = ['Attention', 'Trust', 'Emotional Charge', 'Manipulation Risk'].map((label) => ({ id: `pending-${label}`, label }));

function ScoreTiles({ scores, previousScores }) {
  const previousById = previousScores ? Object.fromEntries(previousScores.map((score) => [score.id, score.value])) : {};
  return (
    <div className="gg-content-scores" role="group" aria-label="Headline content scores">
      {(scores || PLACEHOLDER_TILES).map((score) => {
        const pending = score.value == null;
        const before = previousById[score.id];
        const delta = !pending && before != null ? Math.round(score.value - before) : 0;
        const improved = score.direction === 'lower-good' ? delta < 0 : delta > 0;
        return (
          <article key={score.id} className={`gg-content-score ${pending ? 'pending' : `tone-${score.color || 'cyan'}`}`}>
            <span>{score.label}</span>
            <strong>{pending ? '—' : score.value}</strong>
            {!pending && delta !== 0 ? (
              <em className={improved ? 'up' : 'down'} aria-label={`Changed ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} since the previous run`}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
              </em>
            ) : null}
            <small>{pending ? 'Run a simulation' : score.detail || score.explanation}</small>
          </article>
        );
      })}
    </div>
  );
}

export function ContentReactionLab({ onOpenScanner }) {
  const { input, setInput, status, result, previousResult, error, setError, runSimulation, applyContent } = useContentScan();
  const [genreId, setGenreId] = useState('ad');
  const [shareOpen, setShareOpen] = useState(false);
  const [rewrite, setRewrite] = useState(null);

  const genre = GENRES.find((entry) => entry.id === genreId) || GENRES[0];
  const scores = result ? getHeadlineScores(result) : null;
  const previousScores = previousResult ? getHeadlineScores(previousResult) : null;
  const verdict = result ? deriveExecutiveVerdict(result) : null;
  const running = status === 'running';

  function handleRun(content) {
    setRewrite(null);
    runSimulation(content);
  }

  function loadSample() {
    const preset = getClassicPreset(genre.presetId);
    if (!preset) return;
    setRewrite(null);
    applyContent(preset.content);
    track('gaugegap_content_sample_loaded', { genre: genre.id });
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInput(text.slice(0, MAX_SCAN_CHARS));
        setError('');
      }
    } catch {
      setError('Clipboard access was blocked — paste into the box instead.');
    }
  }

  function makeRewrite({ goal, label }) {
    if (!result) return;
    const text = createRewrite(input, goal);
    const rewrittenResult = scanContentLocally(text);
    setRewrite({ goal, label, text, deltas: compareResults(result, rewrittenResult) });
    track('gaugegap_content_rewrite_created', { goal });
  }

  return (
    <div className="gg-content-lab" data-testid="content-reaction-lab">
      <DeepLabHeading
        kicker="Live experiment 013"
        title="Watch content hit a brain before it hits people."
        description="Paste an ad, tweet, landing page or email. A live neural simulation reacts instantly, scores the reaction, and rewrites the message on request — all in your browser."
        scoreLabel="Impact score"
        score={verdict ? verdict.score : '—'}
        scoreNote={verdict ? verdict.headline : 'Awaiting first simulation'}
      />

      <div className="gg-content-frame">
        <div className="gg-content-input">
          <div className="gg-content-genres" role="tablist" aria-label="Content type">
            {GENRES.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={entry.id === genreId} className={entry.id === genreId ? 'active' : ''} onClick={() => setGenreId(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
          <textarea
            id="gg-content-input"
            value={input}
            maxLength={MAX_SCAN_CHARS}
            placeholder={genre.placeholder}
            aria-label="Content to simulate"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (isKeyboardScanShortcut(event)) {
                event.preventDefault();
                handleRun();
              }
            }}
          />
          <div className="gg-content-input-meta">
            <span>{input.length.toLocaleString()} / {MAX_SCAN_CHARS.toLocaleString()}</span>
            <div>
              <button type="button" onClick={pasteFromClipboard}><ClipboardPaste size={15} /> Paste</button>
              <button type="button" onClick={() => { setInput(''); setRewrite(null); setError(''); }}><Eraser size={15} /> Clear</button>
              <button type="button" onClick={loadSample}><Sparkles size={15} /> Try a {genre.label.toLowerCase()} sample</button>
            </div>
          </div>
          <button type="button" className="gg-content-run" onClick={() => handleRun()} disabled={running}>
            <Play size={17} /> {running ? 'Simulating…' : 'Run simulation'}
          </button>
          {error ? <p className="gg-content-error" role="alert">{error}</p> : null}
          <p className="gg-content-status" role="status">
            {running ? 'Signal entering the lattice — watch the regions light up.' : result ? 'Simulation complete. Rewrite it, share it, or change one line and run again.' : 'Nothing leaves your browser: the scan runs locally.'}
          </p>
        </div>

        <div className="gg-content-brain" aria-label="Live brain reaction">
          <Brain3D
            mode={result ? 'result' : 'demo'}
            result={result}
            presetName="baseline"
            fallback={<BrainVisualizer result={result || {}} />}
            ariaLabel="Live 3D brain simulation reacting to the pasted content."
          />
        </div>
      </div>

      <ScoreTiles scores={scores} previousScores={previousScores} />

      {result ? (
        <div className="gg-content-actions">
          {REWRITE_ACTIONS.map((action) => (
            <button key={action.goal} type="button" className={rewrite?.goal === action.goal ? 'active' : ''} onClick={() => makeRewrite(action)}>
              <WandSparkles size={15} /> {action.label}
            </button>
          ))}
          <button type="button" onClick={() => setShareOpen(true)}><Share2 size={15} /> Share score card</button>
          <button type="button" className="gg-content-open-app" onClick={() => onOpenScanner?.(input)}>
            Open full analysis <ArrowRight size={15} />
          </button>
        </div>
      ) : null}

      {rewrite ? (
        <div className="gg-content-rewrite" data-testid="content-rewrite">
          <div className="gg-content-rewrite-head">
            <strong>{rewrite.label}</strong>
            <button type="button" onClick={() => { applyContent(rewrite.text); setRewrite(null); }}>Use this version</button>
          </div>
          <blockquote>{rewrite.text}</blockquote>
          <div className="gg-content-deltas" aria-label="Score changes for this rewrite">
            {rewrite.deltas.map((delta) => (
              <span key={delta.id} className={`delta-${delta.status}`}>
                {delta.label} {delta.before} → {delta.after}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} result={result} />
    </div>
  );
}
