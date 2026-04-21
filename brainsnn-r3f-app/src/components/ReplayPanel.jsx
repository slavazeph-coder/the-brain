import React, { useEffect, useState } from 'react';
import {
  isRecording, startRecording, stopRecording, resetRecording,
  currentSteps, exportReplay, parseReplay, formatStep, pushStep,
} from '../utils/replay';

/**
 * Layer 65 — Firewall Replay panel.
 */
export default function ReplayPanel() {
  const [recording, setRecording] = useState(isRecording());
  const [steps, setSteps] = useState(currentSteps());
  const [importText, setImportText] = useState('');
  const [imported, setImported] = useState(null);
  const [err, setErr] = useState('');
  const [title, setTitle] = useState('My session');

  // Refresh steps periodically while recording so the panel reflects
  // what's happening in other panels.
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setSteps(currentSteps()), 800);
    return () => clearInterval(id);
  }, [recording]);

  function start() { startRecording(); setRecording(true); setSteps(currentSteps()); }
  function stop() { stopRecording(); setRecording(false); setSteps(currentSteps()); }
  function reset() {
    if (!window.confirm('Discard the current recording?')) return;
    resetRecording(); setRecording(false); setSteps([]);
  }
  function addNote(text) {
    if (!recording) return;
    pushStep({ kind: 'note', text: (text || '').slice(0, 200) });
    setSteps(currentSteps());
  }

  async function copyExport() {
    const json = exportReplay({ title });
    try {
      await navigator.clipboard.writeText(json);
      setErr('');
    } catch {
      window.prompt('Copy this replay:', json.slice(0, 400) + '…');
    }
  }
  function download() {
    const json = exportReplay({ title });
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brainsnn-replay-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function doImport() {
    setErr('');
    try {
      const parsed = parseReplay(importText);
      setImported(parsed);
    } catch (e) { setErr(e.message || 'import failed'); }
  }

  return (
    <section className="panel panel-pad replay-panel">
      <div className="eyebrow">Layer 65 · replay</div>
      <h2>Record + replay scan sessions</h2>
      <p className="muted">
        While recording, every scan / apply / share / template click gets
        logged. Export the session as JSON for bug reports, demos, or
        rule-dev walkthroughs. Import another session to read it step-by-step.
      </p>

      <div className="control-actions" style={{ marginTop: 10 }}>
        {!recording ? (
          <button className="btn primary" onClick={start}>● Start recording</button>
        ) : (
          <button className="btn" onClick={stop}>■ Stop</button>
        )}
        <button className="btn" onClick={reset} disabled={!steps.length && !recording} style={{ color: '#dd6974' }}>
          Reset
        </button>
        <button className="btn" onClick={() => addNote(window.prompt('Note:') || '')} disabled={!recording}>
          + Note
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="share-label">Session title</label>
        <input
          className="share-input"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 100))}
          style={{ marginTop: 4 }}
        />
      </div>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn" onClick={download} disabled={!steps.length}>Download JSON</button>
        <button className="btn" onClick={copyExport} disabled={!steps.length}>Copy to clipboard</button>
      </div>

      {steps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Current steps ({steps.length})</div>
          <pre
            style={{
              marginTop: 6,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.24)',
              fontSize: 12,
              lineHeight: 1.45,
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {steps.map((s, i) => formatStep({ ...s })).join('\n')}
          </pre>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <div className="eyebrow">Import replay</div>
        <textarea
          className="firewall-input"
          placeholder='{"brainsnn":"brainsnn-replay-v1", ...}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          style={{ marginTop: 6 }}
        />
        <div className="control-actions" style={{ marginTop: 6 }}>
          <button className="btn" onClick={doImport} disabled={!importText.trim()}>Parse</button>
        </div>
        {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}
      </div>

      {imported && (
        <div style={{ marginTop: 10 }}>
          <div className="eyebrow">Imported: {imported.title}</div>
          <p className="muted small-note">{imported.steps.length} steps · exported {imported.exportedAt}</p>
          <pre
            style={{
              marginTop: 6,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(0,0,0,0.24)',
              fontSize: 12,
              lineHeight: 1.45,
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {imported.steps.map((s) => formatStep(s)).join('\n')}
          </pre>
        </div>
      )}
    </section>
  );
}
