import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, MousePointer2, Pause, Play, RotateCcw, Share2, Sparkles } from 'lucide-react';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function shareExperiment({ lab, title, text, state, onNotice }) {
  const url = new URL(window.location.href);
  url.searchParams.set('lab', lab);
  url.searchParams.delete('run');
  url.searchParams.set('state', state);
  url.hash = 'playground';
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url: url.toString() });
    } else {
      await navigator.clipboard.writeText(url.toString());
      onNotice('Challenge link copied. The exact settings are inside it.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') onNotice('Sharing was blocked. Use Copy challenge instead.');
  }
}

function copyExperiment({ lab, state, onNotice }) {
  const url = new URL(window.location.href);
  url.searchParams.set('lab', lab);
  url.searchParams.delete('run');
  url.searchParams.set('state', state);
  url.hash = 'playground';
  navigator.clipboard?.writeText(url.toString())
    .then(() => onNotice('Challenge copied. Send it to someone who thinks they can do better.'))
    .catch(() => onNotice('Copy was blocked by the browser. Use Share challenge.'));
}

function parseState(lab, count) {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get('lab') !== lab) return null;
  const raw = params.get('state');
  if (!raw) return null;
  const values = raw.split(',').map(Number);
  if (values.length !== count || !values.every(Number.isFinite)) return null;
  return values;
}

function LabToolbar({ paused, onToggle, onReset, onShare, onCopy, notice }) {
  return (
    <div className="gg-arcade-toolbar">
      <div className="gg-arcade-toolbar-actions">
        <button type="button" onClick={onToggle}>{paused ? <Play size={15} /> : <Pause size={15} />}{paused ? 'Resume' : 'Pause'}</button>
        <button type="button" onClick={onReset}><RotateCcw size={15} /> Reset</button>
        <button type="button" onClick={onShare}><Share2 size={15} /> Share challenge</button>
        <button type="button" onClick={onCopy}><Copy size={15} /> Copy link</button>
      </div>
      <p>{notice}</p>
    </div>
  );
}

function RangeControl({ label, value, min, max, step, onChange, suffix = '' }) {
  return (
    <label className="gg-arcade-range">
      <span><strong>{label}</strong><output>{round(value, step < 0.01 ? 3 : 2)}{suffix}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

const FIREFLY_PRESETS = [
  { id: 'festival', label: 'Festival sync', coupling: 1.65, noise: 0.08, population: 120, speed: 1 },
  { id: 'wild', label: 'Wild meadow', coupling: 0.32, noise: 0.52, population: 170, speed: 1.1 },
  { id: 'whisper', label: 'Slow whisper', coupling: 0.82, noise: 0.04, population: 85, speed: 0.62 },
  { id: 'storm', label: 'Electric storm', coupling: 2.5, noise: 0.2, population: 210, speed: 1.55 },
];

export function FireflySyncLab() {
  const shared = useMemo(() => parseState('fireflies', 4), []);
  const [params, setParams] = useState(() => shared ? {
    coupling: clamp(shared[0], 0, 3),
    noise: clamp(shared[1], 0, 1),
    population: Math.round(clamp(shared[2], 30, 240)),
    speed: clamp(shared[3], 0.3, 2),
  } : FIREFLY_PRESETS[0]);
  const [paused, setPaused] = useState(false);
  const [sync, setSync] = useState(0);
  const [notice, setNotice] = useState(shared ? 'Shared swarm loaded. Can you drive it into perfect sync?' : 'Raise coupling and watch a crowd discover one rhythm.');
  const canvasRef = useRef(null);
  const paramsRef = useRef(params);
  const pausedRef = useRef(paused);
  const swarmRef = useRef([]);
  const resetRef = useRef(0);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d', { alpha: false });
    let width = 0;
    let height = 0;
    let frameId = 0;
    let lastReset = -1;
    let lastTime = performance.now();
    let lastScore = 0;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(360, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function buildSwarm() {
      const count = paramsRef.current.population;
      swarmRef.current = Array.from({ length: count }, (_, index) => ({
        x: Math.random(),
        y: Math.random(),
        phase: Math.random() * Math.PI * 2,
        omega: 0.76 + Math.random() * 0.48,
        size: 1.5 + Math.random() * 2.7,
        drift: (index % 2 ? 1 : -1) * (0.00004 + Math.random() * 0.00014),
      }));
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    buildSwarm();

    function render(now) {
      if (lastReset !== resetRef.current || swarmRef.current.length !== paramsRef.current.population) {
        lastReset = resetRef.current;
        buildSwarm();
      }
      const dt = Math.min(0.04, (now - lastTime) / 1000);
      lastTime = now;
      const active = paramsRef.current;
      const swarm = swarmRef.current;
      let meanSin = 0;
      let meanCos = 0;
      for (const fly of swarm) {
        meanSin += Math.sin(fly.phase);
        meanCos += Math.cos(fly.phase);
      }
      meanSin /= Math.max(1, swarm.length);
      meanCos /= Math.max(1, swarm.length);
      const order = Math.hypot(meanSin, meanCos);
      const meanPhase = Math.atan2(meanSin, meanCos);

      if (!pausedRef.current) {
        for (const fly of swarm) {
          const couplingForce = active.coupling * order * Math.sin(meanPhase - fly.phase);
          const noiseForce = (Math.random() - 0.5) * active.noise * 2.4;
          fly.phase += (fly.omega + couplingForce + noiseForce) * dt * active.speed * 3.1;
          fly.x = (fly.x + fly.drift * active.speed + 1) % 1;
          fly.y = clamp(fly.y + Math.sin(now * 0.00025 + fly.x * 8) * 0.000035, 0.03, 0.97);
        }
      }

      context.fillStyle = '#02040a';
      context.fillRect(0, 0, width, height);
      const sky = context.createRadialGradient(width * 0.5, height * 0.55, 20, width * 0.5, height * 0.55, Math.max(width, height) * 0.7);
      sky.addColorStop(0, `rgba(91, 33, 182, ${0.04 + order * 0.1})`);
      sky.addColorStop(0.55, 'rgba(3, 17, 32, 0.25)');
      sky.addColorStop(1, 'rgba(1, 2, 6, 0)');
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);

      for (const fly of swarm) {
        const flash = Math.pow(Math.max(0, Math.cos(fly.phase)), 18);
        const x = fly.x * width;
        const y = fly.y * height;
        if (flash > 0.025) {
          const glow = context.createRadialGradient(x, y, 0, x, y, 18 + flash * 28);
          glow.addColorStop(0, `rgba(236, 253, 120, ${0.92 * flash})`);
          glow.addColorStop(0.2, `rgba(125, 249, 255, ${0.7 * flash})`);
          glow.addColorStop(1, 'rgba(125, 249, 255, 0)');
          context.fillStyle = glow;
          context.beginPath();
          context.arc(x, y, 18 + flash * 28, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = `rgba(224, 255, 170, ${0.15 + flash * 0.85})`;
        context.beginPath();
        context.arc(x, y, fly.size + flash * 2.2, 0, Math.PI * 2);
        context.fill();
      }

      if (now - lastScore > 220) {
        lastScore = now;
        setSync(Math.round(order * 100));
      }
      frameId = requestAnimationFrame(render);
    }

    frameId = requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frameId);
    };
  }, []);

  function patch(key, value) {
    setParams((current) => ({ ...current, [key]: value }));
    setNotice('The swarm changed. Find the smallest coupling that still creates one flash.');
  }

  function reset() {
    resetRef.current += 1;
    setNotice('New fireflies, same rules. Collective order has to emerge again.');
  }

  function nudge() {
    const target = Math.random() * Math.PI * 2;
    for (const fly of swarmRef.current) fly.phase = target + (Math.random() - 0.5) * 1.5;
    setNotice('The swarm received a pulse. Watch whether the shared rhythm survives.');
  }

  const state = [params.coupling, params.noise, params.population, params.speed].map((value) => round(value, 3)).join(',');

  return (
    <section className="gg-sim-lab" aria-labelledby="gg-firefly-title">
      <div className="gg-sim-heading">
        <div>
          <p className="gg-kicker"><Sparkles size={16} /> Live experiment 002</p>
          <h2 id="gg-firefly-title">Can a crowd agree without a leader?</h2>
          <p>Each firefly follows only its own clock and the faint rhythm of its neighbours. Synchrony emerges—or collapses—from those local rules.</p>
        </div>
        <div className="gg-sim-score"><span>Synchrony</span><strong>{sync}</strong><small>{sync > 88 ? 'One living pulse' : sync > 55 ? 'Locking together' : 'Independent clocks'}</small></div>
      </div>

      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas" aria-label="Firefly synchronization simulation" />
          <div className="gg-sim-canvas-label">dθᵢ/dt = ωᵢ + K r sin(ψ−θᵢ) + noise</div>
          <button type="button" className="gg-sim-float-action" onClick={nudge}><Sparkles size={15} /> Pulse the swarm</button>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-sim-presets">
            {FIREFLY_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => { setParams(preset); resetRef.current += 1; }}>{preset.label}</button>)}
          </div>
          <RangeControl label="Coupling" value={params.coupling} min={0} max={3} step={0.01} onChange={(value) => patch('coupling', value)} />
          <RangeControl label="Noise" value={params.noise} min={0} max={1} step={0.01} onChange={(value) => patch('noise', value)} />
          <RangeControl label="Population" value={params.population} min={30} max={240} step={1} onChange={(value) => patch('population', Math.round(value))} />
          <RangeControl label="Time" value={params.speed} min={0.3} max={2} step={0.05} suffix="×" onChange={(value) => patch('speed', value)} />
          <div className="gg-sim-mission"><strong>Challenge</strong><p>Reach 90 synchrony with the highest noise you can keep alive.</p></div>
        </aside>
      </div>
      <LabToolbar paused={paused} onToggle={() => setPaused((value) => !value)} onReset={reset}
        onShare={() => shareExperiment({ lab: 'fireflies', state, title: `My firefly sync score: ${sync}`, text: `I reached ${sync}% synchrony in GaugeGap. Can you keep the swarm together with more noise?`, onNotice: setNotice })}
        onCopy={() => copyExperiment({ lab: 'fireflies', state, onNotice: setNotice })} notice={notice} />
    </section>
  );
}

const WAVE_PRESETS = [
  { id: 'constructive', label: 'Perfect harmony', wavelength: 34, spacing: 120, phase: 0, speed: 1 },
  { id: 'cancel', label: 'Total cancellation', wavelength: 34, spacing: 120, phase: Math.PI, speed: 1 },
  { id: 'tight', label: 'Fine ripples', wavelength: 18, spacing: 88, phase: 0.7, speed: 1.25 },
  { id: 'ocean', label: 'Deep ocean', wavelength: 52, spacing: 160, phase: 1.4, speed: 0.62 },
];

export function WaveInterferenceLab() {
  const shared = useMemo(() => parseState('waves', 4), []);
  const [params, setParams] = useState(() => shared ? {
    wavelength: clamp(shared[0], 12, 64),
    spacing: clamp(shared[1], 30, 190),
    phase: clamp(shared[2], 0, Math.PI * 2),
    speed: clamp(shared[3], 0.2, 2),
  } : WAVE_PRESETS[0]);
  const [paused, setPaused] = useState(false);
  const [detector, setDetector] = useState({ x: 0.5, y: 0.5, intensity: 0 });
  const detectorRef = useRef({ x: 0.5, y: 0.5, intensity: 0 });
  const [notice, setNotice] = useState(shared ? 'Shared wave field loaded. Move the detector and remix it.' : 'Move through the field and find where two waves disappear.');
  const canvasRef = useRef(null);
  const paramsRef = useRef(params);
  const pausedRef = useRef(paused);
  const timeRef = useRef(0);
  const resetRef = useRef(0);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d', { alpha: false });
    const width = 180;
    const height = 112;
    canvas.width = width;
    canvas.height = height;
    const image = context.createImageData(width, height);
    let frameId = 0;
    let last = performance.now();
    let lastReset = -1;

    function intensityAt(nx, ny, active) {
      const px = nx * width;
      const py = ny * height;
      const s1x = width * 0.5 - active.spacing * 0.22;
      const s2x = width * 0.5 + active.spacing * 0.22;
      const sy = height * 0.5;
      const r1 = Math.hypot(px - s1x, py - sy);
      const r2 = Math.hypot(px - s2x, py - sy);
      const k = (Math.PI * 2) / active.wavelength;
      return (Math.sin(k * r1 - timeRef.current) + Math.sin(k * r2 - timeRef.current + active.phase)) * 0.5;
    }

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        timeRef.current = 0;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const active = paramsRef.current;
      if (!pausedRef.current) timeRef.current += dt * active.speed * 4.2;

      const data = image.data;
      let offset = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = intensityAt(x / width, y / height, active);
          const power = Math.abs(value);
          const positive = value > 0;
          data[offset] = positive ? 40 + power * 100 : 16 + power * 210;
          data[offset + 1] = positive ? 110 + power * 145 : 20 + power * 45;
          data[offset + 2] = positive ? 150 + power * 105 : 100 + power * 155;
          data[offset + 3] = 255;
          offset += 4;
        }
      }
      context.putImageData(image, 0, 0);

      const activeDetector = detectorRef.current;
      const dx = activeDetector.x * width;
      const dy = activeDetector.y * height;
      context.strokeStyle = '#ffffff';
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(dx, dy, 4.5, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(dx - 7, dy);
      context.lineTo(dx + 7, dy);
      context.moveTo(dx, dy - 7);
      context.lineTo(dx, dy + 7);
      context.stroke();

      frameId = requestAnimationFrame(render);
    }

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, []);

  function moveDetector(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    const active = paramsRef.current;
    const width = 180;
    const height = 112;
    const px = x * width;
    const py = y * height;
    const s1x = width * 0.5 - active.spacing * 0.22;
    const s2x = width * 0.5 + active.spacing * 0.22;
    const sy = height * 0.5;
    const k = (Math.PI * 2) / active.wavelength;
    const value = (Math.sin(k * Math.hypot(px - s1x, py - sy) - timeRef.current)
      + Math.sin(k * Math.hypot(px - s2x, py - sy) - timeRef.current + active.phase)) * 0.5;
    const nextDetector = { x, y, intensity: value };
    detectorRef.current = nextDetector;
    setDetector(nextDetector);
  }

  function patch(key, value) {
    setParams((current) => ({ ...current, [key]: value }));
    setNotice('The interference map changed instantly. Hunt for a silent node.');
  }

  const visibility = Math.round(Math.abs(detector.intensity) * 100);
  const state = [params.wavelength, params.spacing, params.phase, params.speed].map((value) => round(value, 3)).join(',');

  return (
    <section className="gg-sim-lab" aria-labelledby="gg-wave-title">
      <div className="gg-sim-heading">
        <div>
          <p className="gg-kicker"><Sparkles size={16} /> Live experiment 003</p>
          <h2 id="gg-wave-title">Make two waves erase each other.</h2>
          <p>Two sources fill the same space. Their peaks can amplify into brilliance—or meet a trough and vanish.</p>
        </div>
        <div className="gg-sim-score"><span>Detector energy</span><strong>{visibility}</strong><small>{visibility < 8 ? 'Near-perfect silence' : visibility > 85 ? 'Maximum reinforcement' : 'Mixed interference'}</small></div>
      </div>

      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap gg-wave-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-wave-canvas" onPointerMove={moveDetector} onPointerDown={moveDetector} aria-label="Two-source wave interference field" />
          <div className="gg-sim-canvas-label">I = sin(kr₁−ωt) + sin(kr₂−ωt+φ)</div>
          <div className="gg-wave-hint"><MousePointer2 size={15} /> Move the detector through the field</div>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-sim-presets">
            {WAVE_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => { setParams(preset); resetRef.current += 1; }}>{preset.label}</button>)}
          </div>
          <RangeControl label="Wavelength" value={params.wavelength} min={12} max={64} step={1} onChange={(value) => patch('wavelength', value)} />
          <RangeControl label="Source gap" value={params.spacing} min={30} max={190} step={1} onChange={(value) => patch('spacing', value)} />
          <RangeControl label="Phase shift" value={params.phase} min={0} max={Math.PI * 2} step={0.02} onChange={(value) => patch('phase', value)} />
          <RangeControl label="Time" value={params.speed} min={0.2} max={2} step={0.05} suffix="×" onChange={(value) => patch('speed', value)} />
          <div className="gg-sim-mission"><strong>Challenge</strong><p>Place the detector below 5 energy, then change wavelength without losing the silent point.</p></div>
        </aside>
      </div>
      <LabToolbar paused={paused} onToggle={() => setPaused((value) => !value)} onReset={() => { resetRef.current += 1; setNotice('Time reset. The geometry stays the same.'); }}
        onShare={() => shareExperiment({ lab: 'waves', state, title: `I found a ${visibility}% wave node`, text: 'I built a two-source interference field in GaugeGap. Can you find a quieter point?', onNotice: setNotice })}
        onCopy={() => copyExperiment({ lab: 'waves', state, onNotice: setNotice })} notice={notice} />
    </section>
  );
}

const REACTION_PRESETS = [
  { id: 'coral', label: 'Electric coral', feed: 0.0545, kill: 0.062, speed: 4, brush: 6 },
  { id: 'mitosis', label: 'Cell division', feed: 0.0367, kill: 0.0649, speed: 5, brush: 5 },
  { id: 'maze', label: 'Living maze', feed: 0.029, kill: 0.057, speed: 5, brush: 7 },
  { id: 'worms', label: 'Neon worms', feed: 0.078, kill: 0.061, speed: 4, brush: 4 },
];

export function ReactionDiffusionLab() {
  const shared = useMemo(() => parseState('reaction', 4), []);
  const [params, setParams] = useState(() => shared ? {
    feed: clamp(shared[0], 0.01, 0.09),
    kill: clamp(shared[1], 0.045, 0.075),
    speed: Math.round(clamp(shared[2], 1, 8)),
    brush: Math.round(clamp(shared[3], 2, 12)),
  } : REACTION_PRESETS[0]);
  const [paused, setPaused] = useState(false);
  const [complexity, setComplexity] = useState(0);
  const [notice, setNotice] = useState(shared ? 'Shared chemistry loaded. Draw into it and force a new species.' : 'Drag across the field. A tiny chemical seed becomes a living pattern.');
  const canvasRef = useRef(null);
  const paramsRef = useRef(params);
  const pausedRef = useRef(paused);
  const fieldRef = useRef(null);
  const resetRef = useRef(0);
  const drawingRef = useRef(false);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d', { alpha: false });
    const width = 144;
    const height = 92;
    canvas.width = width;
    canvas.height = height;
    let frameId = 0;
    let lastReset = -1;
    let lastScore = 0;
    const image = context.createImageData(width, height);

    function initialize() {
      const size = width * height;
      const a = new Float32Array(size);
      const b = new Float32Array(size);
      const nextA = new Float32Array(size);
      const nextB = new Float32Array(size);
      a.fill(1);
      for (let seed = 0; seed < 8; seed += 1) {
        const cx = Math.floor(width * (0.2 + Math.random() * 0.6));
        const cy = Math.floor(height * (0.2 + Math.random() * 0.6));
        for (let oy = -4; oy <= 4; oy += 1) {
          for (let ox = -4; ox <= 4; ox += 1) {
            const x = (cx + ox + width) % width;
            const y = (cy + oy + height) % height;
            b[x + y * width] = 0.82 + Math.random() * 0.18;
          }
        }
      }
      fieldRef.current = { a, b, nextA, nextB };
    }

    function laplacian(field, x, y) {
      const left = (x - 1 + width) % width;
      const right = (x + 1) % width;
      const up = (y - 1 + height) % height;
      const down = (y + 1) % height;
      return field[left + y * width] * 0.2
        + field[right + y * width] * 0.2
        + field[x + up * width] * 0.2
        + field[x + down * width] * 0.2
        + field[left + up * width] * 0.05
        + field[right + up * width] * 0.05
        + field[left + down * width] * 0.05
        + field[right + down * width] * 0.05
        - field[x + y * width];
    }

    function step() {
      const field = fieldRef.current;
      if (!field) return;
      const active = paramsRef.current;
      const da = 1;
      const db = 0.5;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = x + y * width;
          const av = field.a[index];
          const bv = field.b[index];
          const reaction = av * bv * bv;
          field.nextA[index] = clamp(av + (da * laplacian(field.a, x, y) - reaction + active.feed * (1 - av)), 0, 1);
          field.nextB[index] = clamp(bv + (db * laplacian(field.b, x, y) + reaction - (active.kill + active.feed) * bv), 0, 1);
        }
      }
      [field.a, field.nextA] = [field.nextA, field.a];
      [field.b, field.nextB] = [field.nextB, field.b];
    }

    initialize();

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        initialize();
      }
      if (!pausedRef.current) {
        for (let pass = 0; pass < paramsRef.current.speed; pass += 1) step();
      }
      const field = fieldRef.current;
      const data = image.data;
      let activeCells = 0;
      for (let index = 0; index < field.b.length; index += 1) {
        const value = clamp(field.a[index] - field.b[index], 0, 1);
        const chemical = field.b[index];
        if (chemical > 0.18 && chemical < 0.82) activeCells += 1;
        const offset = index * 4;
        data[offset] = 10 + (1 - value) * 210;
        data[offset + 1] = 18 + chemical * 235;
        data[offset + 2] = 42 + value * 195;
        data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      if (now - lastScore > 260) {
        lastScore = now;
        setComplexity(Math.round((activeCells / field.b.length) * 180));
      }
      frameId = requestAnimationFrame(render);
    }

    frameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frameId);
  }, []);

  function paint(event) {
    if (!drawingRef.current && event.type === 'pointermove') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 144;
    const height = 92;
    const cx = Math.floor(clamp((event.clientX - rect.left) / rect.width, 0, 0.999) * width);
    const cy = Math.floor(clamp((event.clientY - rect.top) / rect.height, 0, 0.999) * height);
    const radius = paramsRef.current.brush;
    const field = fieldRef.current;
    if (!field) return;
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        if (ox * ox + oy * oy > radius * radius) continue;
        const x = (cx + ox + width) % width;
        const y = (cy + oy + height) % height;
        field.b[x + y * width] = 1;
        field.a[x + y * width] = 0.15;
      }
    }
  }

  function patch(key, value) {
    setParams((current) => ({ ...current, [key]: value }));
    setNotice(key === 'brush' ? 'Brush resized. Draw a new chemical seed.' : 'Reaction rules changed. The old pattern must adapt or die.');
  }

  const state = [params.feed, params.kill, params.speed, params.brush].map((value) => round(value, 4)).join(',');

  return (
    <section className="gg-sim-lab" aria-labelledby="gg-reaction-title">
      <div className="gg-sim-heading">
        <div>
          <p className="gg-kicker"><Sparkles size={16} /> Live experiment 004</p>
          <h2 id="gg-reaction-title">Draw a creature from two chemicals.</h2>
          <p>No image is stored here. Spots, worms, cells and coral continuously build themselves from reaction and diffusion.</p>
        </div>
        <div className="gg-sim-score"><span>Pattern complexity</span><strong>{complexity}</strong><small>{complexity > 70 ? 'Dense living texture' : complexity > 35 ? 'Structures emerging' : 'Chemistry settling'}</small></div>
      </div>

      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap gg-reaction-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-pixel-canvas"
            onPointerDown={(event) => { drawingRef.current = true; event.currentTarget.setPointerCapture?.(event.pointerId); paint(event); }}
            onPointerMove={paint}
            onPointerUp={(event) => { drawingRef.current = false; event.currentTarget.releasePointerCapture?.(event.pointerId); }}
            onPointerCancel={() => { drawingRef.current = false; }}
            aria-label="Interactive Gray-Scott reaction diffusion simulation" />
          <div className="gg-sim-canvas-label">∂A/∂t = Dₐ∇²A − AB² + f(1−A)</div>
          <div className="gg-wave-hint"><MousePointer2 size={15} /> Draw directly into the chemistry</div>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-sim-presets">
            {REACTION_PRESETS.map((preset) => <button key={preset.id} type="button" onClick={() => { setParams(preset); resetRef.current += 1; }}>{preset.label}</button>)}
          </div>
          <RangeControl label="Feed rate" value={params.feed} min={0.01} max={0.09} step={0.0005} onChange={(value) => patch('feed', value)} />
          <RangeControl label="Kill rate" value={params.kill} min={0.045} max={0.075} step={0.0005} onChange={(value) => patch('kill', value)} />
          <RangeControl label="Simulation speed" value={params.speed} min={1} max={8} step={1} onChange={(value) => patch('speed', Math.round(value))} />
          <RangeControl label="Brush size" value={params.brush} min={2} max={12} step={1} onChange={(value) => patch('brush', Math.round(value))} />
          <div className="gg-sim-mission"><strong>Challenge</strong><p>Create a stable pattern above 65 complexity without using a preset.</p></div>
        </aside>
      </div>
      <LabToolbar paused={paused} onToggle={() => setPaused((value) => !value)} onReset={() => { resetRef.current += 1; setNotice('Fresh chemistry seeded. The pattern starts from nothing again.'); }}
        onShare={() => shareExperiment({ lab: 'reaction', state, title: `My living chemistry scored ${complexity}`, text: 'I grew a reaction-diffusion pattern in GaugeGap. Can you make a stranger species?', onNotice: setNotice })}
        onCopy={() => copyExperiment({ lab: 'reaction', state, onNotice: setNotice })} notice={notice} />
    </section>
  );
}
