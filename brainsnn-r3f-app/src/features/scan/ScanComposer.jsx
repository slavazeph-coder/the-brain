import React, { useEffect, useRef } from 'react';
import { Clipboard, Eraser, Zap } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { ContentTypeSelector } from './ContentTypeSelector.jsx';
import { ExampleSelector } from './ExampleSelector.jsx';
import { isKeyboardScanShortcut } from './keyboard.js';
import { ScanProgress } from './ScanProgress.jsx';

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
        <p>Scan a hook, ad, email, post or script. BrainSNN routes it through the 102-layer engine: Cognitive Firewall, Gemma/Gemini/OpenAI-ready analysis, Context Memory and TRIBE-informed brain projection.</p>
      </div>

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
