import React, { useEffect, useRef, useState } from 'react';
import { TRIBE_SCENARIOS } from '../data/network';
import { checkServerHealth, fetchTribePrediction, fetchPrecomputedScenario } from '../utils/tribe';

export default function TribePanel({ mode, onApplyFrame, onSetMode }) {
  const [serverStatus, setServerStatus] = useState({ online: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeScenario, setActiveScenario] = useState(null);
  const [playbackFrames, setPlaybackFrames] = useState(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const fileRef = useRef();

  // Check server health on mount and periodically
  useEffect(() => {
    const check = () => checkServerHealth().then(setServerStatus);
    check();
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, []);

  // Playback loop for TRIBE v2 frames
  useEffect(() => {
    if (mode !== 'tribe' || !playbackFrames) return;

    const id = setInterval(() => {
      setPlaybackIndex((prev) => {
        const next = (prev + 1) % playbackFrames.length;
        const frame = playbackFrames[next];
        if (frame) onApplyFrame(frame);
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [mode, playbackFrames, onApplyFrame]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const modality = ['mp4', 'webm', 'mov', 'avi'].includes(ext) ? 'video'
        : ['wav', 'mp3', 'ogg', 'flac'].includes(ext) ? 'audio'
        : 'text';

      const result = await fetchTribePrediction(file, modality);
      setPlaybackFrames(result.frames);
      setPlaybackIndex(0);
      setActiveScenario(`Upload: ${file.name}`);
      onSetMode('tribe');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleScenario = async (key) => {
    const scenario = TRIBE_SCENARIOS[key];
    if (!scenario) return;

    setLoading(true);
    setError(null);
    try {
      const result = await fetchPrecomputedScenario(key);
      setPlaybackFrames(result.frames);
      setPlaybackIndex(0);
      setActiveScenario(scenario.label);
      onSetMode('tribe');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel panel-pad tribe-panel">
      <div className="eyebrow">TRIBE v2 — Meta Brain Foundation Model</div>
      <h2>Neural Prediction Engine</h2>
      <p className="muted">
        Upload video, audio, or text to predict brain region activation using Meta's TRIBE v2, trained on 500+ hours of fMRI from 700+ subjects.
      </p>

      <div className="eeg-status-row">
        <span className={`status-dot ${serverStatus.online ? 'online' : ''}`} />
        <span>
          {serverStatus.online
            ? `Server online${serverStatus.modelLoaded ? ' — model loaded' : ' — model not yet loaded'}`
            : 'Server offline — using pre-computed scenarios'}
        </span>
      </div>

      <div className="tribe-upload">
        <input ref={fileRef} type="file" accept="video/*,audio/*,.txt,.text" />
        <button
          className="btn"
          onClick={handleUpload}
          disabled={loading || !serverStatus.online}
        >
          {loading ? 'Processing...' : 'Predict'}
        </button>
      </div>

      <div className="subhead-row">
        <h3>Pre-computed Scenarios</h3>
        <span className="muted">Neuroscience-backed activation patterns</span>
      </div>

      <div className="tribe-scenarios">
        {Object.entries(TRIBE_SCENARIOS).map(([key, value]) => (
          <button
            key={key}
            className={`chip-btn ${activeScenario === value.label ? 'active' : ''}`}
            onClick={() => handleScenario(key)}
            disabled={loading}
          >
            {value.label}
          </button>
        ))}
      </div>

      {playbackFrames && mode === 'tribe' && (
        <div className="timeline-stats" style={{ marginTop: 14 }}>
          <span>Frame {playbackIndex + 1} / {playbackFrames.length}</span>
          <span>{activeScenario}</span>
        </div>
      )}

      {error && (
        <p className="muted" style={{ color: 'var(--danger)', marginTop: 10 }}>
          {error}
        </p>
      )}
    </section>
  );
}
