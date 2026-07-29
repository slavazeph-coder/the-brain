import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Cpu, Play } from 'lucide-react';
import { DeepLabHeading } from './DeepLabChrome.jsx';
import { BRUNEL_DEFAULTS } from '../../lib/snn/lifNetwork.js';
import { track } from '../../lib/analytics.js';

// Brunel's phase diagram is explored through two numbers: the relative strength
// of inhibition and how hard the network is driven from outside.
const PRESETS = [
  { id: 'balanced', label: 'Balanced', g: 5, eta: 2, note: 'Inhibition-dominated; irregular firing with a population rhythm.' },
  { id: 'excitatory', label: 'Excitation runs away', g: 2.5, eta: 2, note: 'g < 4 leaves excitation unchecked: fast, clock-like firing.' },
  { id: 'strong-inhibition', label: 'Strong inhibition', g: 8, eta: 2, note: 'Heavier inhibition: lower rate, much more irregular.' },
  { id: 'subthreshold', label: 'Below threshold', g: 5, eta: 0.7, note: 'External drive under nu_thr — the network cannot sustain firing.' },
];

const REGIME_LABELS = {
  AI: 'Asynchronous irregular',
  SI: 'Synchronous irregular',
  SR: 'Synchronous regular',
  AR: 'Asynchronous regular',
  silent: 'Silent',
};

export function SpikingNetworkLab() {
  const [g, setG] = useState(5);
  const [eta, setEta] = useState(2);
  const [neurons, setNeurons] = useState(1600);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const workerRef = useRef(null);
  const requestRef = useRef(0);
  const canvasRef = useRef(null);

  useEffect(() => {
    let worker;
    try {
      worker = new Worker(new URL('../../lib/snn/lifWorker.js', import.meta.url), { type: 'module' });
    } catch {
      setError('Web Workers are unavailable here, so the network cannot run.');
      return undefined;
    }
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.id !== requestRef.current) return; // a newer run superseded this
      setBusy(false);
      if (data.ok) {
        setResult(data);
        setError('');
      } else {
        setError(data.error || 'The simulation failed.');
      }
    };
    return () => worker.terminate();
  }, []);

  const run = useCallback(() => {
    const worker = workerRef.current;
    if (!worker) return;
    requestRef.current += 1;
    setBusy(true);
    track('gaugegap_snn_run', { g, eta, neurons });
    worker.postMessage({
      id: requestRef.current,
      seed: `snn-${g}-${eta}-${neurons}`,
      rasterNeurons: 80,
      config: { N: neurons, epsilon: 0.25, g, eta, durationMs: 500 },
    });
  }, [g, eta, neurons]);

  // Run once on mount so the lab is never an empty canvas.
  useEffect(() => {
    const timer = window.setTimeout(run, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Raster + population rate.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    function draw() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(320, rect.width);
      const height = Math.max(280, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      context.fillStyle = '#04040c';
      context.fillRect(0, 0, width, height);
      if (!result) {
        context.fillStyle = '#7c8294';
        context.font = '12px ui-monospace, monospace';
        context.fillText('Running the network…', 16, 24);
        return;
      }

      const rasterHeight = height * 0.68;
      const duration = result.durationMs || 500;

      // Spike raster: one row per sampled neuron, one dot per spike.
      context.fillStyle = '#7df9ff';
      for (const [neuron, timeMs] of result.raster) {
        const x = (timeMs / duration) * width;
        const y = (neuron / Math.max(1, result.rasterCount)) * rasterHeight;
        context.fillRect(x, y, 1.4, 1.6);
      }

      // Population rate underneath.
      const trace = result.rateTrace || [];
      if (trace.length > 1) {
        const maxRate = Math.max(1, ...trace);
        context.strokeStyle = '#ff5edb';
        context.lineWidth = 1.4;
        context.beginPath();
        for (let i = 0; i < trace.length; i += 1) {
          const x = (i / (trace.length - 1)) * width;
          const y = height - 8 - (trace[i] / maxRate) * (height - rasterHeight - 26);
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        context.fillStyle = '#7c8294';
        context.font = '10px ui-monospace, monospace';
        context.fillText(`population rate — peak ${Math.round(maxRate)} Hz/neuron`, 10, rasterHeight + 16);
      }

      context.strokeStyle = 'rgba(255,255,255,0.12)';
      context.beginPath();
      context.moveTo(0, rasterHeight + 4);
      context.lineTo(width, rasterHeight + 4);
      context.stroke();
    }

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [result]);

  const summary = result?.summary;
  const preset = useMemo(
    () => PRESETS.find((entry) => entry.g === g && entry.eta === eta),
    [g, eta],
  );

  return (
    <div className="gg-sim-lab gg-deep-lab" data-testid="spiking-network-lab">
      <DeepLabHeading
        kicker="Live experiment 015"
        title="A real spiking network, not a metaphor."
        description="Leaky integrate-and-fire neurons with Dale's law, transmission delays and Poisson drive. Move inhibition and external drive to walk across Brunel's phase diagram."
        scoreLabel="Firing rate"
        score={summary ? `${summary.rateHz}` : '—'}
        scoreNote={summary ? `${REGIME_LABELS[result.regime] || result.regime} · CV ${summary.cvIsi}` : 'Running…'}
      />

      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-snn-canvas" aria-label="Spike raster and population firing rate" />
          <div className="gg-sim-canvas-label">
            {busy ? 'Simulating…' : `${summary?.neurons ?? 0} neurons · ${summary?.synapses?.toLocaleString?.() ?? 0} synapses · ${summary?.seconds ?? 0}s`}
          </div>
          {summary ? (
            <div className="gg-brain-game-hud" data-testid="snn-hud">
              <span>Rate <strong>{summary.rateHz} Hz</strong></span>
              <span>CV of ISI <strong>{summary.cvIsi}</strong></span>
              <span>Fano <strong>{summary.fano}</strong></span>
              <span>Peak <strong>{summary.peakHz} Hz</strong></span>
            </div>
          ) : null}
        </div>

        <aside className="gg-sim-controls">
          <div className="gg-deep-mission">
            <Activity size={16} />
            <span>Mission</span>
            <strong>Find the setting where firing becomes irregular (CV near 1) without the whole population locking into one rhythm.</strong>
          </div>

          <div className="gg-deep-presets">
            {PRESETS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={preset?.id === entry.id ? 'active' : ''}
                onClick={() => { setG(entry.g); setEta(entry.eta); }}
              >
                {entry.label}
              </button>
            ))}
          </div>

          <label className="gg-arcade-range">
            <span>Inhibition strength g <output>{g}</output></span>
            <input type="range" min="1" max="10" step="0.5" value={g} onChange={(event) => setG(Number(event.target.value))} />
          </label>
          <label className="gg-arcade-range">
            <span>External drive η <output>{eta}</output></span>
            <input type="range" min="0.5" max="4" step="0.1" value={eta} onChange={(event) => setEta(Number(event.target.value))} />
          </label>
          <label className="gg-arcade-range">
            <span>Neurons <output>{neurons}</output></span>
            <input type="range" min="400" max="2400" step="200" value={neurons} onChange={(event) => setNeurons(Number(event.target.value))} />
          </label>

          <button type="button" className="gg-content-run" onClick={run} disabled={busy}>
            <Play size={16} /> {busy ? 'Simulating…' : 'Run network'}
          </button>

          {error ? <p className="gg-content-error" role="alert">{error}</p> : null}
          <p className="gg-content-status" role="status">
            {preset ? preset.note : `g = ${g}, η = ${eta}. Below η = 1 the mean external input cannot reach threshold.`}
          </p>

          <div className="gg-model-card">
            <span>Model underneath</span>
            <strong>Brunel (2000) LIF network</strong>
            <p>
              Sparse random connectivity, 80/20 excitatory/inhibitory, 1.5 ms delays, exact exponential leak.
              Runs in a Web Worker. Regime behaviour is checked against the published analysis in
              brunelValidation.test.js.
            </p>
          </div>
        </aside>
      </div>

      <div className="gg-deep-actions">
        <span>
          <Cpu size={14} /> Gamma-band power here is measured from the population rate, not asserted by a formula.
          {summary ? ` Current peak: ${summary.peakHz} Hz.` : ''}
        </span>
      </div>
    </div>
  );
}
