import React, { useEffect, useRef, useState } from 'react';
import {
  isVoiceSupported, isEnabled, setEnabled, getVoices,
  speakNarrative, stop, pause, resume, isSpeaking
} from '../utils/voiceNarrator';
import { generateNarrative } from '../utils/narrative';

export default function VoiceControl({ state, trends, firewallResult }) {
  const [active, setActive] = useState(false);
  const [voiceName, setVoiceName] = useState('');
  const [rate, setRate] = useState(1.0);
  const [voices, setVoices] = useState([]);
  const lastSpokeTick = useRef(-1);

  useEffect(() => {
    const v = getVoices();
    setVoices(v);
    // Voices may load async
    const timer = setTimeout(() => setVoices(getVoices()), 500);
    return () => clearTimeout(timer);
  }, []);

  // Auto-narrate every N ticks when active
  useEffect(() => {
    if (!active || !isEnabled()) return;
    // Speak every 5 ticks to avoid overlapping
    if (state.tick - lastSpokeTick.current < 5) return;
    lastSpokeTick.current = state.tick;

    const sentences = generateNarrative({
      regions: state.regions,
      scenario: state.scenario,
      trends,
      firewallResult,
      tick: state.tick
    });
    speakNarrative(sentences, { rate });
  }, [state.tick, active, rate, trends, firewallResult]);

  const handleToggle = () => {
    const next = !active;
    setActive(next);
    setEnabled(next);
    if (!next) stop();
  };

  if (!isVoiceSupported()) {
    return (
      <section className="panel panel-pad voice-panel">
        <div className="eyebrow">Voice Narrator</div>
        <p className="muted">Web Speech API not available in this browser.</p>
      </section>
    );
  }

  return (
    <section className="panel panel-pad voice-panel">
      <div className="voice-header">
        <div>
          <div className="eyebrow">AI Voice Narrator</div>
          <p className="muted">
            {active ? 'Narrating brain activity aloud...' : 'Enable to hear real-time brain narration.'}
          </p>
        </div>
        <button className={`btn ${active ? 'danger' : 'primary'}`} onClick={handleToggle}>
          {active ? 'Stop' : 'Start'} Voice
        </button>
      </div>

      <div className="voice-controls">
        <div className="voice-control-row">
          <label className="share-label">Voice</label>
          <select
            className="snap-name-input"
            value={voiceName}
            onChange={(e) => setVoiceName(e.target.value)}
          >
            <option value="">Default</option>
            {voices.filter((v) => v.lang.startsWith('en')).map((v) => (
              <option key={v.name} value={v.name}>{v.name}</option>
            ))}
          </select>
        </div>

        <div className="voice-control-row">
          <label className="share-label">Speed: {rate.toFixed(1)}x</label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="voice-slider"
          />
        </div>
      </div>

      {active && (
        <div className="voice-status">
          <span className="voice-pulse" />
          <span className="muted">Narrating every 5 ticks</span>
        </div>
      )}
    </section>
  );
}
