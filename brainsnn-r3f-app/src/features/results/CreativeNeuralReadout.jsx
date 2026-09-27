import React, { useMemo, useRef, useState } from 'react';
import { Activity, Download, GitCompare, MessageSquareText, Play, Sparkles, Target } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { deriveExecutiveVerdict } from '../../lib/scoreMapping.js';
import {
  answerFromModelAnalysis,
  answerScanQuestionLocally,
  buildScanQuestionPrompt,
} from '../../lib/scanInterpreter.js';
import { BrainSignalView } from './BrainSignalView.jsx';

const DEFAULT_QUESTIONS = [
  'Where does attention drop?',
  'What is the weakest 5 seconds?',
  'Why did this score what it did?',
  'Which claim needs proof?',
  'What should I move earlier?',
  'Where is the strongest window?',
];

function formatTime(seconds = 0, precision = 1) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(precision).padStart(precision ? 4 : 2, '0')}`;
}

function formatWindow(window) {
  if (!window) return '—';
  return `${formatTime(window.start)}–${formatTime(window.end)}`;
}

function nearestPoint(points = [], time = 0) {
  if (!points.length) return null;
  return points.reduce((best, point) => (
    Math.abs((point.timestamp || 0) - time) < Math.abs((best.timestamp || 0) - time) ? point : best
  ), points[0]);
}

function Track({ track, duration, currentTime, onSeek }) {
  const width = 100;
  const height = 28;
  const values = track?.values || [];
  const polyline = values.map((point) => {
    const x = duration ? ((point.timestamp || 0) / duration) * width : 0;
    const y = height - ((Number(point.value) || 0) / 100) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const cursor = duration ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  function handleClick(event) {
    if (!duration || !onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    onSeek(duration * ratio);
  }

  return (
    <button className="creative-track" type="button" onClick={handleClick} aria-label={`${track.label} timeline`}>
      <span className="creative-track-label">
        <strong>{track.label}</strong>
        <small>{track.provenance}</small>
      </span>
      <span className="creative-track-plot" aria-hidden="true">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
          <polyline points={polyline} fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        <i style={{ left: `${cursor}%` }} />
      </span>
    </button>
  );
}

function ContextRail({ label, value, note }) {
  const safe = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className="creative-context-rail">
      <div><span>{label}</span><strong>{Math.round(safe)}</strong></div>
      <div className="creative-context-meter"><i style={{ width: `${safe}%` }} /></div>
      <small>{note}</small>
    </div>
  );
}

export function CreativeNeuralReadout({ result, media, onCompare, onExport }) {
  const videoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [question, setQuestion] = useState(DEFAULT_QUESTIONS[0]);
  const [answer, setAnswer] = useState('');
  const [answerSource, setAnswerSource] = useState('');
  const [answerEvidence, setAnswerEvidence] = useState([]);
  const [askBusy, setAskBusy] = useState(false);
  const multimodal = result?.multimodal || {};
  const temporal = multimodal.temporalReadout || {};
  const windows = temporal.windows || {};
  const duration = Number(multimodal.duration) || Number(media?.duration) || 0;
  const verdict = useMemo(() => deriveExecutiveVerdict(result), [result]);
  const current = useMemo(() => nearestPoint(temporal.points || [], currentTime), [currentTime, temporal.points]);
  const proofScore = Math.min(100, (multimodal.proofPoints?.length || 0) * 24 + (multimodal.missingEvidence?.length ? 0 : 20));
  const trustScore = Number(result?.metrics?.trust ?? 50);
  const pressureScore = Math.round((Number(result?.firewallSignals?.manipulationPressure) || 0) * 100);

  function seek(time) {
    const safe = Math.min(duration || 0, Math.max(0, Number(time) || 0));
    setCurrentTime(safe);
    if (videoRef.current && Number.isFinite(videoRef.current.duration)) videoRef.current.currentTime = safe;
  }

  async function ask(nextQuestion = question) {
    const resolvedQuestion = String(nextQuestion || '').trim();
    if (!resolvedQuestion || askBusy) return;
    setQuestion(resolvedQuestion);

    const local = answerScanQuestionLocally(resolvedQuestion, result);
    setAnswer(local.answer);
    setAnswerEvidence(local.evidence || []);
    setAnswerSource('deterministic scan interpreter');
    setAskBusy(true);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: buildScanQuestionPrompt(resolvedQuestion, result),
          type: 'text',
        }),
      });
      if (!response.ok) return;
      const analysis = await response.json();
      const modelAnswer = answerFromModelAnalysis(analysis);
      if (modelAnswer) {
        setAnswer(modelAnswer);
        setAnswerEvidence(local.evidence || []);
        setAnswerSource('model-assisted · grounded scan facts');
      }
    } catch {
      // The deterministic answer is already visible; model assistance is optional.
    } finally {
      setAskBusy(false);
    }
  }

  return (
    <section className="creative-readout" aria-labelledby="creative-readout-heading">
      <header className="creative-readout-header">
        <div>
          <div className="creative-readout-kicker">
            <span>BRAINSNN // CREATIVE NEURAL READOUT</span>
            <Badge tone="cyan">PREDICTED / MODELLED</Badge>
          </div>
          <h2 id="creative-readout-heading">One playhead. Every current V0.1 signal.</h2>
          <p>High-density presentation over the truthful browser-local multimodal engine. Not a measured brain scan.</p>
        </div>
        <div className="creative-readout-actions">
          <Button variant="secondary" onClick={() => onCompare?.(result)}><GitCompare size={15} aria-hidden="true" /> Version B</Button>
          <Button variant="ghost" onClick={() => onExport?.(result)}><Download size={15} aria-hidden="true" /> Export scan</Button>
        </div>
      </header>

      <div className="creative-readout-meta" aria-label="Scan metadata">
        <span><small>MODE</small><strong>PREDICTED</strong></span>
        <span><small>INPUT</small><strong>VIDEO + TEXT</strong></span>
        <span><small>MODEL</small><strong>CPU BASELINE V0.1</strong></span>
        <span><small>SPACE</small><strong>REFERENCE</strong></span>
        <span><small>DURATION</small><strong>{duration ? formatTime(duration) : '—'}</strong></span>
      </div>

      <div className="creative-readout-grid">
        <section className="creative-readout-panel creative-video-panel" aria-labelledby="creative-video-heading">
          <div className="creative-panel-title"><Play size={15} aria-hidden="true" /><span id="creative-video-heading">CREATIVE</span><strong>{formatTime(currentTime)}</strong></div>
          {media?.previewUrl ? (
            <video
              ref={videoRef}
              src={media.previewUrl}
              controls
              playsInline
              preload="metadata"
              onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
              onSeeked={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
            />
          ) : (
            <div className="creative-video-placeholder">
              <Activity size={28} aria-hidden="true" />
              <strong>Local video preview unavailable</strong>
              <p>BrainSNN did not upload the raw file. Re-select the original video to restore synchronized playback.</p>
            </div>
          )}
          <div className="creative-current-signals">
            <span><small>RESPONSE CHANGE</small><strong>{current?.responseChange ?? '—'}</strong></span>
            <span><small>ATTENTION PROXY</small><strong>{current?.attentionProxy ?? '—'}</strong></span>
            <span><small>LOAD PROXY</small><strong>{current?.loadProxy ?? '—'}</strong></span>
          </div>
        </section>

        <section className="creative-readout-panel creative-readout-brain" aria-label="Reference brain visualization">
          <div className="creative-panel-title"><Activity size={15} aria-hidden="true" /><span>REFERENCE BRAIN</span><strong>SCAN LEVEL</strong></div>
          <BrainSignalView result={result} />
          <p className="creative-reference-note">The current 3D projection is scan-level. V0.1 does not yet produce time-resolved neural parcels.</p>
        </section>

        <section className="creative-readout-panel creative-decision-panel" aria-labelledby="creative-decision-heading">
          <div className="creative-panel-title"><Target size={15} aria-hidden="true" /><span id="creative-decision-heading">DECISION</span><strong>V0.1</strong></div>
          <div className="creative-decision-score"><strong>{verdict.score}</strong><span>Decision score</span></div>
          <div className="creative-decision-item"><small>PRIMARY RISK</small><strong>{verdict.primaryRisk}</strong></div>
          <div className="creative-decision-item"><small>BEST NEXT MOVE</small><p>{verdict.bestNextMove}</p></div>
          <div className="creative-decision-item accent"><small>EXACT EDIT</small><p>{multimodal.recommendedEdit?.instruction || 'Add time-aligned evidence before asking BrainSNN for an exact timed edit.'}</p></div>
        </section>
      </div>

      <section className="creative-timeline-shell" aria-labelledby="creative-timeline-heading">
        <div className="creative-timeline-heading">
          <div><span className="bsn-eyebrow">Synchronized temporal layer</span><h3 id="creative-timeline-heading">Response timeline</h3></div>
          <div className="creative-timeline-current"><span>PLAYHEAD</span><strong>{formatTime(currentTime)}</strong></div>
        </div>
        <div className="creative-track-stack">
          {(temporal.tracks || []).map((track) => (
            <Track key={track.id} track={track} duration={duration} currentTime={currentTime} onSeek={seek} />
          ))}
        </div>
        <div className="creative-event-row" aria-label="Timestamped visual events">
          {(multimodal.events || []).filter((event) => event.level !== 'low').map((event, index) => (
            <button key={`${event.timestamp}-${index}`} type="button" onClick={() => seek(event.timestamp)}>
              <span>{formatTime(event.timestamp)}</span><strong>{event.label}</strong><small>{Math.round((event.intensity || 0) * 100)}% visual change</small>
            </button>
          ))}
        </div>
      </section>

      <div className="creative-lower-grid">
        <section className="creative-readout-panel creative-context-panel" aria-labelledby="creative-context-heading">
          <div className="creative-panel-title"><Sparkles size={15} aria-hidden="true" /><span id="creative-context-heading">SCAN-LEVEL CONTEXT</span><strong>NOT TIME-LOCALIZED</strong></div>
          <ContextRail label="Trust" value={trustScore} note="Existing BrainSNN scan metric." />
          <ContextRail label="Proof" value={proofScore} note="Derived from transcript/notes proof points, not video localization." />
          <ContextRail label="Pressure" value={pressureScore} note="Cognitive Firewall scan-level pressure estimate." />
          <p className="creative-context-disclaimer">These rails are intentionally separated from the temporal tracks because V0.1 does not have timestamped transcript/audio alignment yet.</p>
        </section>

        <section className="creative-readout-panel creative-moments-panel" aria-labelledby="creative-moments-heading">
          <div className="creative-panel-title"><Target size={15} aria-hidden="true" /><span id="creative-moments-heading">MOMENTS</span><strong>5-SECOND WINDOWS</strong></div>
          <button type="button" onClick={() => seek(windows.strongest?.start || 0)}>
            <small>STRONGEST RESPONSE-CHANGE WINDOW</small>
            <strong>{formatWindow(windows.strongest)}</strong>
            <span>{windows.strongest ? `${windows.strongest.responseChange}/100 average change · ${windows.strongest.sampleCount} samples` : 'No temporal window.'}</span>
          </button>
          <button type="button" onClick={() => seek(windows.weakest?.start || 0)}>
            <small>WEAKEST ATTENTION-PROXY WINDOW</small>
            <strong>{formatWindow(windows.weakest)}</strong>
            <span>{windows.weakest ? `${windows.weakest.attentionProxy}/100 average attention proxy · ${windows.weakest.sampleCount} samples` : 'No temporal window.'}</span>
          </button>
          {windows.largestDrop?.attentionDrop > 0 ? (
            <button type="button" onClick={() => seek(windows.largestDrop.start || 0)}>
              <small>LARGEST WITHIN-WINDOW DROP</small>
              <strong>{formatWindow(windows.largestDrop)}</strong>
              <span>{windows.largestDrop.attentionDrop}-point attention-proxy decline across the window</span>
            </button>
          ) : null}
          <div className="creative-recommendation-card">
            <small>WHAT BRAINSNN WOULD CHANGE</small>
            <strong>{multimodal.recommendedEdit?.headline || 'Add stronger evidence'}</strong>
            <p>{multimodal.recommendedEdit?.instruction || verdict.bestNextMove}</p>
            <span>{multimodal.recommendedEdit?.timingNote || 'Exact placement requires time-aligned transcript/audio.'}</span>
          </div>
        </section>
      </div>

      <section className="creative-ask-panel" aria-labelledby="creative-ask-heading">
        <div className="creative-ask-title"><MessageSquareText size={18} aria-hidden="true" /><div><span className="bsn-eyebrow">Grounded in this scan JSON</span><h3 id="creative-ask-heading">Ask BrainSNN</h3></div></div>
        <div className="creative-question-chips">
          {DEFAULT_QUESTIONS.map((item) => <button key={item} type="button" onClick={() => ask(item)} disabled={askBusy}>{item}</button>)}
        </div>
        <form onSubmit={(event) => { event.preventDefault(); ask(question); }}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Ask BrainSNN about this scan" />
          <Button variant="primary" type="submit" disabled={askBusy}>{askBusy ? 'Checking…' : 'Ask'}</Button>
        </form>
        {answer ? (
          <div className="creative-answer" role="status">
            <strong>BrainSNN</strong>
            <p>{answer}</p>
            <small>{answerSource}{answerEvidence.length ? ` · evidence: ${answerEvidence.join(', ')}` : ''}</small>
          </div>
        ) : null}
        <p className="creative-ask-footnote">The deterministic interpreter answers immediately from structured scan facts. When the configured BrainSNN model is available it may refine that answer using the same bounded facts; local fallback remains authoritative when model assistance is unavailable. No hidden object recognition, audio transcription, purchase intent or measured neural data is added.</p>
      </section>
    </section>
  );
}
