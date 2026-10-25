import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, FileJson, Pause, Play, RotateCcw, Share2, Sparkles, Video } from 'lucide-react';
import { buildAttractorEvidence, downloadJson } from './evidence.js';

const PRESETS = [
  { id: 'classic', label: 'Classic butterfly', sigma: 10, rho: 28, beta: 2.667, speed: 1 },
  { id: 'storm', label: 'Electric storm', sigma: 14, rho: 36, beta: 2.2, speed: 1.35 },
  { id: 'edge', label: 'Edge of chaos', sigma: 10, rho: 24.74, beta: 2.667, speed: 0.82 },
  { id: 'soft', label: 'Soft orbit', sigma: 7.2, rho: 21.5, beta: 3.1, speed: 0.7 },
];

const DEFAULT_PRESET = PRESETS[0];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parseSharedRun() {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('run');
  if (!raw) return null;
  const [sigma, rho, beta, speed] = raw.split(',').map(Number);
  if (![sigma, rho, beta, speed].every(Number.isFinite)) return null;
  return {
    sigma: clamp(sigma, 4, 22),
    rho: clamp(rho, 10, 50),
    beta: clamp(beta, 1, 5),
    speed: clamp(speed, 0.35, 2),
  };
}

function scoreRun(params) {
  const onset = clamp((params.rho - 20) / 18, 0, 1);
  const turbulence = clamp((Math.abs(params.sigma - 10) / 11) + (Math.abs(params.beta - 2.667) / 3.3), 0, 1);
  const balance = clamp(1 - Math.abs(params.rho - 28) / 25, 0, 1);
  const chaos = Math.round((onset * 0.76 + turbulence * 0.24) * 100);
  const beauty = Math.round((balance * 0.58 + (1 - turbulence) * 0.42) * 100);
  const discovery = Math.round(clamp(chaos * 0.46 + beauty * 0.34 + params.speed * 10, 0, 100));
  return { chaos, beauty, discovery };
}

function formatValue(key, value) {
  if (key === 'speed') return `${round(value, 2)}×`;
  return round(value, key === 'beta' ? 3 : 2);
}

export function AttractorPlayground() {
  const shared = useMemo(() => parseSharedRun(), []);
  const [params, setParams] = useState(shared || DEFAULT_PRESET);
  const [paused, setPaused] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState(shared ? 'Shared run loaded — remix it.' : 'Drag any control. The field responds instantly.');
  const [frameStats, setFrameStats] = useState({ x: 0.1, y: 0, z: 0, steps: 0 });
  const canvasRef = useRef(null);
  const paramsRef = useRef(params);
  const pausedRef = useRef(paused);
  const stateRef = useRef({ x: 0.1, y: 0, z: 0, steps: 0 });
  const resetSignalRef = useRef(0);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const scores = useMemo(() => scoreRun(params), [params]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return undefined;

    let width = 0;
    let height = 0;
    let frameId = 0;
    let lastReset = resetSignalRef.current;
    let lastStatsAt = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(320, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.fillStyle = '#030309';
      context.fillRect(0, 0, width, height);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function resetField() {
      stateRef.current = {
        x: 0.08 + Math.random() * 0.12,
        y: Math.random() * 0.08,
        z: Math.random() * 0.05,
        steps: 0,
      };
      context.fillStyle = '#030309';
      context.fillRect(0, 0, width, height);
    }

    function integrate(dt) {
      const current = stateRef.current;
      const active = paramsRef.current;
      const dx = active.sigma * (current.y - current.x);
      const dy = current.x * (active.rho - current.z) - current.y;
      const dz = current.x * current.y - active.beta * current.z;
      current.x += dx * dt;
      current.y += dy * dt;
      current.z += dz * dt;
      current.steps += 1;
      return current;
    }

    function project(point) {
      const scale = Math.min(width, height) / 58;
      const rotation = point.steps * 0.00012;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const rx = point.x * cos - point.y * sin;
      const ry = point.x * sin + point.y * cos;
      return {
        x: width * 0.5 + rx * scale,
        y: height * 0.53 + (point.z - 25) * scale * 0.72 + ry * scale * 0.08,
      };
    }

    function render(now) {
      if (lastReset !== resetSignalRef.current) {
        lastReset = resetSignalRef.current;
        resetField();
      }

      if (!pausedRef.current) {
        context.fillStyle = 'rgba(3, 3, 9, 0.065)';
        context.fillRect(0, 0, width, height);

        const active = paramsRef.current;
        const passes = Math.max(4, Math.floor(12 * active.speed));
        const dt = 0.0048 * active.speed;
        let before = project(stateRef.current);

        context.lineWidth = 1.15;
        context.lineCap = 'round';
        for (let index = 0; index < passes; index += 1) {
          const nextState = integrate(dt);
          if (![nextState.x, nextState.y, nextState.z].every(Number.isFinite) || Math.abs(nextState.x) > 120) {
            resetField();
            before = project(stateRef.current);
            continue;
          }
          const after = project(nextState);
          const hue = 178 + clamp((nextState.z / 52) * 118, 0, 118);
          const alpha = 0.38 + clamp(Math.abs(nextState.x) / 42, 0, 0.46);
          context.strokeStyle = `hsla(${hue}, 92%, 67%, ${alpha})`;
          context.beginPath();
          context.moveTo(before.x, before.y);
          context.lineTo(after.x, after.y);
          context.stroke();
          before = after;
        }
      }

      if (now - lastStatsAt > 220) {
        lastStatsAt = now;
        setFrameStats({ ...stateRef.current });
      }
      frameId = window.requestAnimationFrame(render);
    }

    frameId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  function updateParam(key, value) {
    setParams((current) => ({ ...current, [key]: Number(value) }));
    setNotice('Live run changed. Share it when the shape feels yours.');
  }

  function loadPreset(preset) {
    setParams(preset);
    resetSignalRef.current += 1;
    setPaused(false);
    setNotice(`${preset.label} loaded. Now break it.`);
  }

  function resetRun() {
    resetSignalRef.current += 1;
    setNotice('Same rules, new initial condition. Watch the future diverge.');
  }

  function getShareUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('run', [params.sigma, params.rho, params.beta, params.speed].map((value) => round(value, 3)).join(','));
    url.hash = 'playground';
    return url.toString();
  }

  async function shareRun() {
    const url = getShareUrl();
    const shareData = {
      title: `My GaugeGap chaos score: ${scores.discovery}`,
      text: `I found a ${scores.chaos}% chaos run in GaugeGap Foundry. Can you beat my discovery score?`,
      url,
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(url);
        setNotice('Challenge link copied. Send it to someone who thinks they can beat you.');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') setNotice('Sharing was blocked. Use Copy challenge link instead.');
    }
  }

  async function copyRun() {
    try {
      await navigator.clipboard.writeText(getShareUrl());
      setNotice('Challenge link copied. Your exact parameters are inside it.');
    } catch {
      setNotice('Copy was blocked by the browser. Use the Share button.');
    }
  }

  function downloadPoster() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `gaugegap-run-${scores.discovery}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setNotice('Poster saved. Post it with your score and challenge link.');
    }, 'image/png');
  }

  async function recordClip() {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.captureStream || !window.MediaRecorder || recording) {
      setNotice('Clip recording is not supported in this browser. Save a poster instead.');
      return;
    }
    const stream = canvas.captureStream(30);
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `gaugegap-chaos-${scores.discovery}.webm`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setNotice('Six-second clip saved. Add a hook and post the experiment.');
    };
    setRecording(true);
    setPaused(false);
    setNotice('Recording six seconds of your run…');
    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, 6000);
  }

  const controls = [
    { key: 'sigma', label: 'Stretch', min: 4, max: 22, step: 0.1 },
    { key: 'rho', label: 'Chaos', min: 10, max: 50, step: 0.1 },
    { key: 'beta', label: 'Damping', min: 1, max: 5, step: 0.01 },
    { key: 'speed', label: 'Time', min: 0.35, max: 2, step: 0.05 },
  ];

  async function exportEvidence() {
    const pack = await buildAttractorEvidence({ params, scores, shareUrl: getShareUrl(), controls });
    downloadJson(`gaugegap-evidence-attractor-${String(pack.content_hash).slice(0, 8)}.json`, pack);
    setNotice('Evidence pack saved: exact parameters, solver settings and a content hash travel with your run.');
  }

  return (
    <section id="playground" className="gg-playground" aria-labelledby="gg-playground-title">
      <div className="gg-playground-head">
        <div>
          <p className="gg-kicker"><Sparkles size={16} aria-hidden="true" /> Live experiment 001</p>
          <h2 id="gg-playground-title">Find the most beautiful edge of chaos.</h2>
          <p>Every line is generated live from the Lorenz system. Change one rule and the future splits.</p>
        </div>
        <div className="gg-live-badge"><span /> Running in your browser</div>
      </div>

      <div className="gg-lab-frame">
        <div className="gg-canvas-panel">
          <canvas ref={canvasRef} className="gg-attractor-canvas" aria-label="Live Lorenz attractor simulation" />
          <div className="gg-canvas-overlay">
            <div className="gg-equation">dx = σ(y−x) · dy = x(ρ−z)−y · dz = xy−βz</div>
            <button type="button" className="gg-icon-button" onClick={() => setPaused((value) => !value)} aria-label={paused ? 'Resume simulation' : 'Pause simulation'}>
              {paused ? <Play size={18} /> : <Pause size={18} />}
            </button>
          </div>
          <div className="gg-scoreboard" aria-label="Live run scores">
            <div><span>Chaos</span><strong>{scores.chaos}</strong></div>
            <div><span>Beauty</span><strong>{scores.beauty}</strong></div>
            <div className="gg-discovery-score"><span>Discovery</span><strong>{scores.discovery}</strong></div>
          </div>
        </div>

        <aside className="gg-control-panel">
          <div className="gg-control-intro">
            <span>Challenge</span>
            <strong>Can you score 90+ without destroying the butterfly?</strong>
          </div>

          <div className="gg-presets" aria-label="Simulation presets">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className={Math.abs(params.rho - preset.rho) < 0.01 && Math.abs(params.sigma - preset.sigma) < 0.01 ? 'active' : ''}
                onClick={() => loadPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="gg-sliders">
            {controls.map((control) => (
              <label key={control.key}>
                <span>{control.label}<strong>{formatValue(control.key, params[control.key])}</strong></span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  value={params[control.key]}
                  onChange={(event) => updateParam(control.key, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="gg-run-data">
            <div><span>x</span><strong>{round(frameStats.x, 2)}</strong></div>
            <div><span>y</span><strong>{round(frameStats.y, 2)}</strong></div>
            <div><span>z</span><strong>{round(frameStats.z, 2)}</strong></div>
            <div><span>steps</span><strong>{frameStats.steps.toLocaleString()}</strong></div>
          </div>

          <button type="button" className="gg-reset-button" onClick={resetRun}>
            <RotateCcw size={16} /> Change only the initial condition
          </button>

          <div className="gg-publish-actions">
            <button type="button" onClick={shareRun}><Share2 size={17} /> Share challenge</button>
            <button type="button" onClick={copyRun}><Copy size={17} /> Copy link</button>
            <button type="button" onClick={downloadPoster}><Download size={17} /> Save poster</button>
            <button type="button" onClick={recordClip} disabled={recording}><Video size={17} /> {recording ? 'Recording…' : 'Record clip'}</button>
            <button type="button" onClick={exportEvidence}><FileJson size={17} /> Export evidence</button>
          </div>

          <p className="gg-notice" role="status">{notice}</p>
        </aside>
      </div>
    </section>
  );
}
