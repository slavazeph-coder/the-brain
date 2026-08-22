import React, { useEffect, useMemo, useRef } from 'react';
import { Activity, BrainCircuit, Clipboard, Eraser, Film, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { ContentTypeSelector } from './ContentTypeSelector.jsx';
import { ExampleSelector } from './ExampleSelector.jsx';
import { isKeyboardScanShortcut } from './keyboard.js';
import { MediaInputPanel } from './MediaInputPanel.jsx';
import { ScanProgress } from './ScanProgress.jsx';

function getPreviewSignals(input) {
  const text = input.trim();
  const words = text ? text.split(/\s+/).length : 0;
  const proofTerms = (text.match(/\b(proof|result|customer|because|data|case|tested|source|clear|trust)\b/gi) || []).length;
  const pressureTerms = (text.match(/\b(secret|limited|now|never|steal|last chance|regret|urgent|only)\b/gi) || []).length;
  const hook = Math.min(94, Math.round(28 + Math.min(words, 42) * 1.15 + pressureTerms * 5));
  const trust = Math.max(12, Math.min(96, Math.round(44 + proofTerms * 10 - pressureTerms * 7 + (words > 18 ? 8 : 0))));
  const risk = Math.max(8, Math.min(92, Math.round(14 + pressureTerms * 14 - proofTerms * 4)));
  return [
    { id: 'hook', label: 'Hook preview', value: text ? hook : 0, icon: Activity },
    { id: 'trust', label: 'Trust preview', value: text ? trust : 0, icon: ShieldCheck },
    { id: 'risk', label: 'Risk preview', value: text ? risk : 0, icon: Zap },
  ];
}

function PreScanSignals({ input, contentType, media }) {
  const signals = useMemo(() => getPreviewSignals(input), [input]);
  const hasInput = input.trim().length > 0;
  const hasMedia = Boolean(media?.signals?.length);
  const modeMessage = contentType === 'video' && hasMedia
    ? `${media.signals.length} visual samples ready to fuse${hasInput ? ' with your transcript' : ''}`
    : contentType === 'neural'
      ? (hasInput ? 'Decoded transcript ready for L19 replay' : 'Paste decoded text to wake the neural gateway')
      : (hasInput ? 'Signals are forming' : 'Paste a draft to wake the engine');

  return (
    <aside className="pre-scan-panel" aria-label="Local pre-scan signal preview">
      <div>
        <span className="bsn-eyebrow">Live pre-scan</span>
        <strong>{modeMessage}</strong>
        <p>{contentType === 'video' ? 'Video change signals stay local; the fused event packet runs through the BrainSNN stack.' : 'Local preview only. The full Brain Scan runs through the API and layer stack.'}</p>
      </div>
      <div className="pre-scan-bars">
        {signals.map((signal) => {
          const Icon = signal.icon;
          return (
            <div key={signal.id} className={`pre-scan-row ${signal.id}`}>
              <span><Icon size={15} aria-hidden="true" /> {signal.label}</span>
              <strong>{signal.value}</strong>
              <i style={{ width: `${signal.value}%` }} aria-hidden="true" />
            </div>
          );
        })}
      </div>
    </aside>
  );
}

const labels = {
  text: 'Content to scan',
  webpage: 'URL or page text',
  video: 'Transcript / operator notes (optional)',
  neural: 'Decoded neural transcript',
};

const placeholders = {
  text: 'Paste a headline, post, ad, email, or landing-page copy…',
  webpage: 'Paste the URL or page copy you want BrainSNN to inspect…',
  video: 'Optional: paste the transcript, describe the workflow, or note what should be detected in the video…',
  neural: 'Paste decoded text from an authorized neural decoder. BrainSNN analyzes this text, not raw brain signals…',
};

export function ScanComposer({ scan, onRun }) {
  const textareaRef = useRef(null);
  const { state, setInput, setContentType, setMedia, cancelScan } = scan;
  const scanning = state.status === 'scanning';
  const contentType = state.contentType === 'script' ? 'video' : state.contentType;
  const mediaReady = contentType === 'video' && Boolean(state.media?.signals?.length);
  const valid = (state.validation.valid || mediaReady) && !scanning;

  useEffect(() => {
    function handleKeyDown(event) {
      if (isKeyboardScanShortcut(event)) {
        event.preventDefault();
        if (valid) onRun();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onRun, valid]);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
      textareaRef.current?.focus();
    } catch {
      textareaRef.current?.focus();
    }
  }

  function clearAll() {
    setInput('');
    setMedia(null);
  }

  const RunIcon = contentType === 'video' ? Film : contentType === 'neural' ? BrainCircuit : Zap;
  const runLabel = contentType === 'video' ? 'Run Multimodal Scan' : contentType === 'neural' ? 'Run Neural Replay' : 'Run Brain Scan';

  return (
    <section className="scan-composer" aria-labelledby="cortex-heading">
      <div className="scan-composer-copy">
        <p className="bsn-kicker">Creative Decision Intelligence</p>
        <h1 id="cortex-heading">Paste what you’re about to publish — or show BrainSNN what happened.</h1>
        <p>Analyze text, a page, a screen recording, or decoded neural transcript. BrainSNN turns the input into attention, trust and risk signals, then surfaces concrete evidence, events and next actions.</p>
      </div>

      <div className="scan-composer-grid">
        <div className="scan-input-stack">
          <ContentTypeSelector value={contentType} onChange={setContentType} />

          {contentType === 'video' ? <MediaInputPanel media={state.media} onMedia={setMedia} disabled={scanning} /> : null}

          <label className="scan-input-label" htmlFor="brain-scan-input">
            {labels[contentType] || labels.text}
            <textarea
              ref={textareaRef}
              id="brain-scan-input"
              className="scan-textarea"
              value={state.input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={placeholders[contentType] || placeholders.text}
              disabled={scanning}
            />
          </label>
        </div>
        <PreScanSignals input={state.input} contentType={contentType} media={state.media} />
      </div>

      <div className="scan-composer-footer">
        <span className={state.validation.valid || !state.input.trim() || mediaReady ? 'bsn-mono' : 'bsn-validation'}>
          {state.input.trim().length.toLocaleString()} / 12,000 characters
          {!state.validation.valid && state.input && !mediaReady ? ` - ${state.validation.message}` : ''}
          {contentType === 'video' && !mediaReady ? ' · add a video to enable visual analysis' : ''}
        </span>
        <div className="scan-actions">
          <Button variant="ghost" onClick={pasteFromClipboard} disabled={scanning}>
            <Clipboard size={16} aria-hidden="true" /> Paste
          </Button>
          <Button variant="secondary" onClick={clearAll} disabled={(!state.input && !state.media) || scanning}>
            <Eraser size={16} aria-hidden="true" /> Clear
          </Button>
          <Button variant="primary" onClick={onRun} disabled={!valid}>
            <RunIcon size={16} aria-hidden="true" /> {runLabel}
          </Button>
        </div>
      </div>

      {scanning ? <ScanProgress onCancel={cancelScan} /> : null}
      {state.status === 'error' ? <p role="alert" className="bsn-validation">{state.error}</p> : null}

      {contentType === 'text' || contentType === 'webpage' ? <ExampleSelector onSelect={setInput} /> : null}
      <p className="scan-privacy-note">
        {contentType === 'video'
          ? 'Raw video stays in this browser in V0; only a compact visual-change/event packet plus any transcript you provide is analyzed. '
          : contentType === 'neural'
            ? 'Neural mode accepts decoded text only and is experimental research tooling; BrainSNN does not interpret raw brain signals. '
            : 'Local history stays in this browser unless persistence is configured. '}
        Results are AI-estimated signals, not literal brain measurement.
      </p>
    </section>
  );
}
