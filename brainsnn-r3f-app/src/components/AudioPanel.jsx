import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isSpeechSupported, createSpeechSession } from '../utils/speech';
import { scoreContent } from '../utils/cognitiveFirewall';

/**
 * Layer 59 — Audio Firewall panel.
 *
 * Live Web Speech transcribe + rolling Cognitive Firewall score.
 */
const LANGS = [
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'es-ES', label: 'Spanish' },
  { id: 'fr-FR', label: 'French' },
  { id: 'de-DE', label: 'German' },
  { id: 'it-IT', label: 'Italian' },
  { id: 'pt-BR', label: 'Portuguese (BR)' },
];

export default function AudioPanel() {
  const supported = isSpeechSupported();
  const [lang, setLang] = useState('en-US');
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [finals, setFinals] = useState('');
  const [err, setErr] = useState('');
  const sessionRef = useRef(null);

  const combined = (finals + ' ' + interim).trim();
  const score = useMemo(
    () => (combined.length >= 5 ? scoreContent(combined) : null),
    [combined],
  );
  const pressure = score
    ? (score.emotionalActivation + score.cognitiveSuppression + score.manipulationPressure) / 3
    : 0;

  useEffect(() => {
    return () => { sessionRef.current?.stop(); };
  }, []);

  function start() {
    setErr('');
    setFinals('');
    setInterim('');
    const s = createSpeechSession({ lang });
    sessionRef.current = s;
    s.start((ev) => {
      if (ev.error) { setErr(ev.error); setListening(false); return; }
      if (ev.state === 'listening') setListening(true);
      if (ev.state === 'stopped') setListening(false);
      if (typeof ev.interim === 'string') setInterim(ev.interim);
      if (typeof ev.final === 'string') setFinals(ev.final);
    });
  }

  function stop() {
    sessionRef.current?.stop();
    setListening(false);
  }

  function sendToFirewall() {
    if (!combined) return;
    window.location.href = `${window.location.origin}/?scan=${encodeURIComponent(combined.slice(0, 4000))}`;
  }

  if (!supported) {
    return (
      <section className="panel panel-pad audio-panel">
        <div className="eyebrow">Layer 59 · audio firewall</div>
        <h2>Live audio scan</h2>
        <p className="muted">
          Your browser doesn't expose the Web Speech API. Try Chrome, Edge,
          or a recent Safari. Firefox doesn't ship it yet.
        </p>
      </section>
    );
  }

  const pct = Math.round(pressure * 100);
  const tone = pct >= 65 ? '#dd6974' : pct >= 35 ? '#fdab43' : '#6daa45';

  return (
    <section className="panel panel-pad audio-panel">
      <div className="eyebrow">Layer 59 · audio firewall</div>
      <h2>Live audio scan</h2>
      <p className="muted">
        Speak, or point a mic at any audio source (talk radio, podcast, TV).
        Web Speech transcribes in-browser; the Firewall scores the rolling
        transcript. Useful for catching manipulation as it happens.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
        <select
          className="share-input"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          disabled={listening}
          style={{ maxWidth: 200 }}
        >
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        {!listening ? (
          <button className="btn primary" onClick={start}>● Listen</button>
        ) : (
          <button className="btn" onClick={stop}>■ Stop</button>
        )}
        {combined && (
          <>
            <button className="btn" onClick={sendToFirewall}>Scan in Firewall →</button>
            <button className="btn" onClick={() => { setFinals(''); setInterim(''); }}>Clear</button>
          </>
        )}
      </div>

      {err && <p className="muted" style={{ color: '#dd6974', marginTop: 8 }}>Error: {err}</p>}

      {(finals || interim) && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 8,
              background: `${tone}14`,
              borderLeft: `3px solid ${tone}`,
              lineHeight: 1.5,
            }}
          >
            <span>{finals} </span>
            <span style={{ opacity: 0.55 }}>{interim}</span>
          </div>
          {score && (
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
              <span>
                <strong>{combined.split(/\s+/).filter(Boolean).length}</strong> words ·{' '}
                rolling pressure <strong style={{ color: tone }}>{pct}%</strong>
              </span>
              <span className="muted small-note">
                {score.templates?.length > 0
                  ? `templates: ${score.templates.map((t) => t.label).join(', ')}`
                  : 'no templates'}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
