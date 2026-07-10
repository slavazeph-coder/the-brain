import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CircleDot, MousePointer2, Orbit, Target } from 'lucide-react';
import {
  clamp,
  copyChallenge,
  DeepLabActions,
  DeepLabHeading,
  round,
  shareChallenge,
} from './DeepLabChrome.jsx';

const ORBIT_PRESETS = {
  solar: {
    label: 'Tiny solar system',
    gravity: 0.75,
    bodies: [
      { x: 0.5, y: 0.5, vx: 0, vy: 0, mass: 640, radius: 13, hue: 48 },
      { x: 0.5, y: 0.29, vx: 1.5, vy: 0, mass: 5, radius: 4.5, hue: 188 },
      { x: 0.5, y: 0.76, vx: -1.28, vy: 0, mass: 9, radius: 5.5, hue: 310 },
      { x: 0.23, y: 0.5, vx: 0, vy: -1.34, mass: 3.5, radius: 4, hue: 130 },
    ],
  },
  binary: {
    label: 'Binary dance',
    gravity: 0.63,
    bodies: [
      { x: 0.39, y: 0.5, vx: 0, vy: -0.56, mass: 330, radius: 11, hue: 42 },
      { x: 0.61, y: 0.5, vx: 0, vy: 0.56, mass: 330, radius: 11, hue: 205 },
      { x: 0.5, y: 0.18, vx: 1.02, vy: 0, mass: 4, radius: 4, hue: 300 },
    ],
  },
  slingshot: {
    label: 'Slingshot test',
    gravity: 0.92,
    bodies: [
      { x: 0.53, y: 0.52, vx: 0, vy: 0, mass: 780, radius: 14, hue: 36 },
      { x: 0.13, y: 0.67, vx: 1.42, vy: -0.32, mass: 7, radius: 5, hue: 195 },
      { x: 0.76, y: 0.32, vx: -0.42, vy: 0.65, mass: 22, radius: 6.5, hue: 325 },
    ],
  },
};

function parseGravityState() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') !== 'gravity') return null;
  const [preset, gravityValue] = (query.get('state') || '').split(',');
  const gravity = Number(gravityValue);
  if (!ORBIT_PRESETS[preset] || !Number.isFinite(gravity)) return null;
  return { preset, gravity: clamp(gravity, 0.2, 1.4) };
}

export function GravityForgeLab() {
  const shared = useMemo(() => parseGravityState(), []);
  const initialPreset = shared?.preset || 'solar';
  const [preset, setPreset] = useState(initialPreset);
  const [gravity, setGravity] = useState(shared?.gravity || ORBIT_PRESETS[initialPreset].gravity);
  const [paused, setPaused] = useState(false);
  const [bodyCount, setBodyCount] = useState(ORBIT_PRESETS[initialPreset].bodies.length);
  const [survival, setSurvival] = useState(0);
  const [notice, setNotice] = useState(shared ? 'Shared orbit loaded. Add a planet and make it yours.' : 'Drag from empty space to launch a new planet.');
  const canvasRef = useRef(null);
  const bodiesRef = useRef([]);
  const trailsRef = useRef([]);
  const gravityRef = useRef(gravity);
  const pausedRef = useRef(paused);
  const launchRef = useRef(null);
  const resetRef = useRef(0);

  useEffect(() => { gravityRef.current = gravity; }, [gravity]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  function loadPreset(id) {
    setPreset(id);
    setGravity(ORBIT_PRESETS[id].gravity);
    setPaused(false);
    setNotice(`${ORBIT_PRESETS[id].label} loaded. Drag to launch another body.`);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let width = 0;
    let height = 0;
    let animationId = 0;
    let frameCount = 0;
    let lastReset = -1;
    let startTime = performance.now();

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(360, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function resetBodies() {
      const base = ORBIT_PRESETS[preset];
      const scale = Math.min(width, height) * 0.19;
      bodiesRef.current = base.bodies.map((body) => ({
        ...body,
        x: body.x * width,
        y: body.y * height,
        vx: body.vx * scale,
        vy: body.vy * scale,
      }));
      trailsRef.current = bodiesRef.current.map(() => []);
      startTime = performance.now();
      setBodyCount(bodiesRef.current.length);
      setSurvival(0);
      context.fillStyle = '#02040c';
      context.fillRect(0, 0, width, height);
    }

    const observer = new ResizeObserver(() => {
      resize();
      resetBodies();
    });
    observer.observe(canvas);
    resize();
    resetBodies();

    function pointerPosition(event) {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function onPointerDown(event) {
      launchRef.current = pointerPosition(event);
      canvas.setPointerCapture?.(event.pointerId);
    }

    function onPointerUp(event) {
      if (!launchRef.current) return;
      const start = launchRef.current;
      const end = pointerPosition(event);
      launchRef.current = null;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const speed = clamp(Math.hypot(dx, dy), 8, 180);
      const hue = 155 + (bodiesRef.current.length * 47) % 195;
      bodiesRef.current.push({
        x: start.x,
        y: start.y,
        vx: dx * 0.58,
        vy: dy * 0.58,
        mass: 4 + speed * 0.035,
        radius: 4 + speed * 0.012,
        hue,
      });
      trailsRef.current.push([]);
      setBodyCount(bodiesRef.current.length);
      setNotice('Planet launched. A shorter drag makes a slower, tighter orbit.');
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        resetBodies();
      }

      context.fillStyle = 'rgba(2, 4, 12, 0.22)';
      context.fillRect(0, 0, width, height);
      const bodies = bodiesRef.current;

      if (!pausedRef.current) {
        const dt = 0.0035;
        const forceScale = gravityRef.current * 112;
        for (let i = 0; i < bodies.length; i += 1) {
          for (let j = i + 1; j < bodies.length; j += 1) {
            const a = bodies[i];
            const b = bodies[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distanceSquared = Math.max(90, dx * dx + dy * dy);
            const distance = Math.sqrt(distanceSquared);
            const force = forceScale / distanceSquared;
            const nx = dx / distance;
            const ny = dy / distance;
            a.vx += nx * force * b.mass * dt;
            a.vy += ny * force * b.mass * dt;
            b.vx -= nx * force * a.mass * dt;
            b.vy -= ny * force * a.mass * dt;
          }
        }
        bodies.forEach((body, index) => {
          body.x += body.vx * dt;
          body.y += body.vy * dt;
          const trail = trailsRef.current[index] || [];
          if (frameCount % 2 === 0) trail.push({ x: body.x, y: body.y });
          if (trail.length > 120) trail.shift();
          trailsRef.current[index] = trail;
        });
      }

      bodies.forEach((body, index) => {
        const trail = trailsRef.current[index] || [];
        if (trail.length > 1) {
          context.beginPath();
          context.moveTo(trail[0].x, trail[0].y);
          for (let point = 1; point < trail.length; point += 1) context.lineTo(trail[point].x, trail[point].y);
          context.strokeStyle = `hsla(${body.hue}, 88%, 68%, 0.35)`;
          context.lineWidth = 1;
          context.stroke();
        }
        const gradient = context.createRadialGradient(body.x, body.y, 0, body.x, body.y, body.radius * 3.2);
        gradient.addColorStop(0, `hsla(${body.hue}, 95%, 78%, 1)`);
        gradient.addColorStop(0.28, `hsla(${body.hue}, 90%, 58%, 0.9)`);
        gradient.addColorStop(1, `hsla(${body.hue}, 88%, 55%, 0)`);
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(body.x, body.y, body.radius * 3.2, 0, Math.PI * 2);
        context.fill();
      });

      const alive = bodies.filter((body) => body.x > -80 && body.x < width + 80 && body.y > -80 && body.y < height + 80).length;
      if (frameCount % 30 === 0) {
        const seconds = Math.floor((now - startTime) / 1000);
        setSurvival(Math.round(clamp((alive / Math.max(1, bodies.length)) * 70 + Math.min(seconds, 30), 0, 100)));
      }
      frameCount += 1;
      animationId = window.requestAnimationFrame(render);
    }

    animationId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.cancelAnimationFrame(animationId);
    };
  }, [preset]);

  function challengeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'gravity');
    url.searchParams.set('state', `${preset},${round(gravity, 2)}`);
    url.hash = 'playground';
    return url.toString();
  }

  return (
    <div className="gg-sim-lab gg-deep-lab">
      <DeepLabHeading
        kicker="Experiment 005 · orbital mechanics"
        title="Build a solar system that survives."
        description="Gravity is simple. Stable many-body motion is not. Drag from empty space to launch planets, then see whether your system holds together or tears itself apart."
        scoreLabel="Stability score"
        score={survival}
        scoreNote={`${bodyCount} active bodies`}
      />
      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap gg-gravity-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-gravity-canvas" aria-label="Interactive orbital gravity sandbox" />
          <div className="gg-sim-canvas-label"><MousePointer2 size={14} /> Drag to launch · longer drag = faster planet</div>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-deep-mission"><Orbit size={18} /><span>Mission</span><strong>Keep five bodies alive long enough to score 90.</strong></div>
          <label className="gg-control-row"><span>Gravity <strong>{round(gravity, 2)}×</strong></span><input type="range" min="0.2" max="1.4" step="0.02" value={gravity} onChange={(event) => setGravity(Number(event.target.value))} /></label>
          <div className="gg-deep-presets">
            {Object.entries(ORBIT_PRESETS).map(([id, item]) => <button key={id} type="button" className={preset === id ? 'active' : ''} onClick={() => loadPreset(id)}>{item.label}</button>)}
          </div>
          <div className="gg-model-card"><span>Model underneath</span><strong>Newtonian n-body gravity</strong><p>Every body pulls on every other body. Tiny launch changes accumulate into radically different futures.</p></div>
        </aside>
      </div>
      <DeepLabActions
        paused={paused}
        onPause={() => setPaused((value) => !value)}
        onReset={() => { resetRef.current += 1; setNotice('The system reset to its preset state.'); }}
        onShare={() => shareChallenge({ title: `My GaugeGap orbit scored ${survival}`, text: `Can you build a more stable ${bodyCount}-body system?`, url: challengeUrl(), setNotice })}
        onCopy={() => copyChallenge(challengeUrl(), setNotice)}
        notice={notice}
      />
    </div>
  );
}

function pendulumAcceleration(theta1, theta2, omega1, omega2, gravity) {
  const mass1 = 1;
  const mass2 = 1;
  const length1 = 1;
  const length2 = 1;
  const delta = theta1 - theta2;
  const denominator1 = length1 * (2 * mass1 + mass2 - mass2 * Math.cos(2 * delta));
  const denominator2 = length2 * (2 * mass1 + mass2 - mass2 * Math.cos(2 * delta));
  const alpha1 = (-gravity * (2 * mass1 + mass2) * Math.sin(theta1) - mass2 * gravity * Math.sin(theta1 - 2 * theta2) - 2 * Math.sin(delta) * mass2 * (omega2 * omega2 * length2 + omega1 * omega1 * length1 * Math.cos(delta))) / denominator1;
  const alpha2 = (2 * Math.sin(delta) * (omega1 * omega1 * length1 * (mass1 + mass2) + gravity * (mass1 + mass2) * Math.cos(theta1) + omega2 * omega2 * length2 * mass2 * Math.cos(delta))) / denominator2;
  return { alpha1, alpha2 };
}

function parsePendulumState() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') !== 'pendulum') return null;
  const [angleValue, differenceValue, gravityValue] = (query.get('state') || '').split(',').map(Number);
  if (![angleValue, differenceValue, gravityValue].every(Number.isFinite)) return null;
  return {
    angle: clamp(angleValue, 45, 175),
    difference: clamp(differenceValue, 0.01, 1.2),
    gravity: clamp(gravityValue, 0.2, 1.8),
  };
}

export function ChaosTwinsLab() {
  const shared = useMemo(() => parsePendulumState(), []);
  const [angle, setAngle] = useState(shared?.angle || 122);
  const [difference, setDifference] = useState(shared?.difference || 0.08);
  const [gravity, setGravity] = useState(shared?.gravity || 1);
  const [paused, setPaused] = useState(false);
  const [divergence, setDivergence] = useState(0);
  const [timeToSplit, setTimeToSplit] = useState(null);
  const [notice, setNotice] = useState(shared ? 'Shared chaos race loaded.' : 'Two pendulums begin almost identical. Predict when their paths split.');
  const canvasRef = useRef(null);
  const paramsRef = useRef({ angle, difference, gravity });
  const pausedRef = useRef(paused);
  const resetRef = useRef(0);

  useEffect(() => { paramsRef.current = { angle, difference, gravity }; }, [angle, difference, gravity]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let width = 0;
    let height = 0;
    let animationId = 0;
    let frameCount = 0;
    let lastReset = -1;
    let startedAt = performance.now();
    let splitRecorded = false;
    let twins = [];
    let trails = [[], []];

    function reset() {
      const base = paramsRef.current.angle * Math.PI / 180;
      const offset = paramsRef.current.difference * Math.PI / 180;
      twins = [
        { theta1: base, theta2: base * 0.72, omega1: 0, omega2: 0 },
        { theta1: base + offset, theta2: base * 0.72, omega1: 0, omega2: 0 },
      ];
      trails = [[], []];
      startedAt = performance.now();
      splitRecorded = false;
      setDivergence(0);
      setTimeToSplit(null);
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(360, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      reset();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function integrate(state, dt) {
      const acceleration = pendulumAcceleration(state.theta1, state.theta2, state.omega1, state.omega2, 9.81 * paramsRef.current.gravity);
      state.omega1 += acceleration.alpha1 * dt;
      state.omega2 += acceleration.alpha2 * dt;
      state.theta1 += state.omega1 * dt;
      state.theta2 += state.omega2 * dt;
    }

    function points(state) {
      const length = Math.min(width, height) * 0.19;
      const originX = width * 0.5;
      const originY = height * 0.25;
      const x1 = originX + Math.sin(state.theta1) * length;
      const y1 = originY + Math.cos(state.theta1) * length;
      const x2 = x1 + Math.sin(state.theta2) * length;
      const y2 = y1 + Math.cos(state.theta2) * length;
      return { originX, originY, x1, y1, x2, y2 };
    }

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        reset();
      }
      context.fillStyle = 'rgba(2, 4, 12, 0.18)';
      context.fillRect(0, 0, width, height);
      if (!pausedRef.current) {
        for (let pass = 0; pass < 5; pass += 1) twins.forEach((state) => integrate(state, 0.0034));
      }
      const colors = ['#7df9ff', '#ff5edb'];
      const endpoints = twins.map(points);
      endpoints.forEach((point, index) => {
        const trail = trails[index];
        if (!pausedRef.current && frameCount % 2 === 0) trail.push({ x: point.x2, y: point.y2 });
        if (trail.length > 180) trail.shift();
        if (trail.length > 1) {
          context.strokeStyle = `${colors[index]}55`;
          context.lineWidth = 1.2;
          context.beginPath();
          context.moveTo(trail[0].x, trail[0].y);
          trail.slice(1).forEach((item) => context.lineTo(item.x, item.y));
          context.stroke();
        }
        context.strokeStyle = colors[index];
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(point.originX, point.originY);
        context.lineTo(point.x1, point.y1);
        context.lineTo(point.x2, point.y2);
        context.stroke();
        context.fillStyle = colors[index];
        context.beginPath();
        context.arc(point.x1, point.y1, 6, 0, Math.PI * 2);
        context.arc(point.x2, point.y2, 8, 0, Math.PI * 2);
        context.fill();
      });
      const distance = Math.hypot(endpoints[0].x2 - endpoints[1].x2, endpoints[0].y2 - endpoints[1].y2);
      const normalized = Math.round(clamp(distance / Math.min(width, height) * 180, 0, 100));
      if (frameCount % 10 === 0) {
        setDivergence(normalized);
        if (!splitRecorded && normalized > 35) {
          splitRecorded = true;
          setTimeToSplit(round((now - startedAt) / 1000, 1));
        }
      }
      context.fillStyle = '#e7fbff';
      context.beginPath();
      context.arc(width * 0.5, height * 0.25, 5, 0, Math.PI * 2);
      context.fill();
      frameCount += 1;
      animationId = window.requestAnimationFrame(render);
    }

    animationId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationId);
    };
  }, []);

  function applyPreset(nextAngle, nextDifference, nextGravity, message) {
    setAngle(nextAngle);
    setDifference(nextDifference);
    setGravity(nextGravity);
    resetRef.current += 1;
    setNotice(message);
  }

  function challengeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'pendulum');
    url.searchParams.set('state', [angle, difference, round(gravity, 2)].join(','));
    url.hash = 'playground';
    return url.toString();
  }

  return (
    <div className="gg-sim-lab gg-deep-lab">
      <DeepLabHeading
        kicker="Experiment 008 · deterministic chaos"
        title="Race two almost-identical futures."
        description="The equations are deterministic and the starting difference can be smaller than a tenth of a degree. Yet the trajectories eventually become unrelated. Your task is to delay—or accelerate—the split."
        scoreLabel="Divergence"
        score={`${divergence}%`}
        scoreNote={timeToSplit ? `Visible split at ${timeToSplit}s` : 'Twins still tracking'}
      />
      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-pendulum-canvas" aria-label="Twin double pendulum chaos simulation" />
          <div className="gg-sim-canvas-label"><CircleDot size={14} /> Cyan and pink begin only {difference}° apart</div>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-deep-mission"><Target size={18} /><span>Mission</span><strong>Keep the twins under 20% divergence for ten seconds.</strong></div>
          <label className="gg-control-row"><span>Starting angle <strong>{angle}°</strong></span><input type="range" min="45" max="175" step="1" value={angle} onChange={(event) => { setAngle(Number(event.target.value)); resetRef.current += 1; }} /></label>
          <label className="gg-control-row"><span>Initial difference <strong>{difference}°</strong></span><input type="range" min="0.01" max="1.2" step="0.01" value={difference} onChange={(event) => { setDifference(Number(event.target.value)); resetRef.current += 1; }} /></label>
          <label className="gg-control-row"><span>Gravity <strong>{round(gravity, 2)}×</strong></span><input type="range" min="0.2" max="1.8" step="0.02" value={gravity} onChange={(event) => { setGravity(Number(event.target.value)); resetRef.current += 1; }} /></label>
          <div className="gg-deep-presets">
            <button type="button" onClick={() => applyPreset(90, 0.02, 0.55, 'Slow split loaded. How long can the twins remain together?')}>Slow split</button>
            <button type="button" onClick={() => applyPreset(149, 0.08, 1.15, 'Chaos race loaded. Watch the paths separate.')}>Chaos race</button>
            <button type="button" onClick={() => applyPreset(170, 0.4, 1.55, 'Instant storm loaded. Divergence should arrive fast.')}>Instant storm</button>
          </div>
          <div className="gg-model-card"><span>Model underneath</span><strong>Coupled double pendulum equations</strong><p>The result is unpredictable in practice even though no randomness is added after the start.</p></div>
        </aside>
      </div>
      <DeepLabActions
        paused={paused}
        onPause={() => setPaused((value) => !value)}
        onReset={() => { resetRef.current += 1; setNotice('Both futures restarted from the same tiny separation.'); }}
        onShare={() => shareChallenge({ title: `My GaugeGap chaos twins split in ${timeToSplit || 'over 10'} seconds`, text: 'Can you keep two almost-identical pendulums together longer?', url: challengeUrl(), setNotice })}
        onCopy={() => copyChallenge(challengeUrl(), setNotice)}
        notice={notice}
      />
    </div>
  );
}
