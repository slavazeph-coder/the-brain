import React, { useState } from 'react';
import { composeReply, COMPOSER_TONES, COMPOSER_EXAMPLE } from '../utils/replyComposer';

export default function ComposerPanel() {
  const [text, setText] = useState('');
  const [tone, setTone] = useState('direct');
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  function run() {
    setResult(composeReply(text, { tone }));
  }

  async function copyDraft() {
    if (!result?.draft) return;
    try {
      await navigator.clipboard.writeText(result.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy draft:', result.draft);
    }
  }

  return (
    <section className="panel panel-pad composer-panel">
      <div className="eyebrow">Layer 89 · refutation composer</div>
      <h2>Scaffolded reply draft</h2>
      <p className="muted">
        Paste the manipulative message you received. The composer stitches a
        full reply from the refutations for every detected template
        (Layers 39 + 41) — a scaffolded draft you can edit, not a finished
        message.
      </p>

      <div className="control-actions" style={{ marginTop: 8 }}>
        <button className="btn-sm" onClick={() => setText(COMPOSER_EXAMPLE)}>Load example</button>
        <button className="btn-sm" onClick={() => setText('')} disabled={!text}>Clear</button>
      </div>

      <textarea
        className="firewall-input"
        placeholder="Paste a manipulative message you received..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        style={{ marginTop: 8 }}
      />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <label className="muted small-note">Tone:</label>
        <select className="share-input" value={tone} onChange={(e) => setTone(e.target.value)} style={{ maxWidth: 120 }}>
          {COMPOSER_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn primary" onClick={run} disabled={text.trim().length < 10}>Compose draft</button>
      </div>

      {result?.ok && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              borderLeft: '3px solid #5ee69a',
              background: 'rgba(94,230,154,0.06)',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.55,
            }}
          >
            {result.draft}
          </div>
          <p className="muted small-note" style={{ marginTop: 6 }}>
            Templates pulled: {result.usedTemplates.length ? result.usedTemplates.join(', ') : 'generic boundary statement (no specific templates fired)'}
          </p>
          <div className="control-actions" style={{ marginTop: 6 }}>
            <button className="btn" onClick={copyDraft}>
              {copied ? 'Copied ✓' : 'Copy draft'}
            </button>
          </div>
        </div>
      )}

      {result?.error && <p className="muted" style={{ color: '#dd6974' }}>{result.error}</p>}
    </section>
  );
}
