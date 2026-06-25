import React, { useEffect, useMemo, useRef } from 'react';
import { Activity, Clipboard, Eraser, ShieldCheck, Zap } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { ContentTypeSelector } from './ContentTypeSelector.jsx';
import { ExampleSelector } from './ExampleSelector.jsx';
import { isKeyboardScanShortcut } from './keyboard.js';
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

function PreScanSignals({ input }) {
  const signals = useMemo(() => getPreviewSignals(input), [input]);
  const hasInput = input.trim().length > 0;
  return (
    <aside className="pre-scan-panel" aria-label="Local pre-scan signal preview">
      <div>
        <span className="bsn-eyebrow">Live pre-scan</span>
        <strong>{hasInput ? 'Signals are forming' : 'Paste a draft to wake the engine'}</strong>
        <p>Local preview only. The full Brain Scan runs through the API and layer stack.</p>
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

export function ScanComposer({ scan, onRun }) {
  const textareaRef = useRef(null);
  const { state, setInput, setContentType, cancelScan } = scan;
  const scanning = state.status === 'scanning';
  const valid = state.validation.valid && !scanning;

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

  return (
    <section className="scan-composer" aria-labelledby="cortex-heading">
      <div className="scan-composer-copy">
        <p className="bsn-kicker">Decision Engine</p>
        <h1 id="cortex-heading">Know how it lands before you publish.</h1>
        <p>Scan a hook, ad, email, post or script. BrainSNN shows what captures attention, what damages trust and what to change next.</p>
      </div>

      <div className="scan-composer-grid">
        <div className="scan-input-stack">
          <ContentTypeSelector value={state.contentType} onChange={setContentType} />

          <label className="scan-input-label" htmlFor="brain-scan-input">
            Content to scan
            <textarea
              ref={textareaRef}
              id="brain-scan-input"
              className="scan-textarea"
              value={state.input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste a headline, post, ad, email or script..."
              disabled={scanning}
            />
          </label>
        </div>
        <PreScanSignals input={state.input} />
      </div>

      <div className="scan-composer-footer">
        <span className={state.validation.valid ? 'bsn-mono' : 'bsn-validation'}>
          {state.input.trim().length.toLocaleString()} / 12,000 characters
          {!state.validation.valid && state.input ? ` - ${state.validation.message}` : ''}
        </span>
        <div className="scan-actions">
          <Button variant="ghost" onClick={pasteFromClipboard}>
            <Clipboard size={16} aria-hidden="true" /> Paste
          </Button>
          <Button variant="secondary" onClick={() => setInput('')} disabled={!state.input || scanning}>
            <Eraser size={16} aria-hidden="true" /> Clear
          </Button>
          <Button variant="primary" onClick={onRun} disabled={!valid}>
            <Zap size={16} aria-hidden="true" /> Run Brain Scan
          </Button>
        </div>
      </div>

      {scanning ? <ScanProgress onCancel={cancelScan} /> : null}
      {state.status === 'error' ? <p role="alert" className="bsn-validation">{state.error}</p> : null}

      <ExampleSelector onSelect={setInput} />
      <p className="scan-privacy-note">Local history stays in this browser unless persistence is configured. Results are AI-estimated content-response signals, not literal brain measurement.</p>
    </section>
  );
}
