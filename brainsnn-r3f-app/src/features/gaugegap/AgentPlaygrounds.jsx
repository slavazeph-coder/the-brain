import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Shield, Target, Wind } from 'lucide-react';
import {
  clamp,
  copyChallenge,
  DeepLabActions,
  DeepLabHeading,
  round,
  seededRandom,
  shareChallenge,
} from './DeepLabChrome.jsx';

function makeFlock(count, width, height, seed = 42) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const angle = random() * Math.PI * 2;
    const speed = 0.7 + random();
    return {
      x: random() * width,
      y: random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hue: 176 + (index % 70),
    };
  });
}

function parseFlockState() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') !== 'flock') return null;
  const [countValue, alignmentValue, cohesionValue, separationValue, modeValue] = (query.get('state') || '').split(',');
  const values = [countValue, alignmentValue, cohesionValue, separationValue].map(Number);
  if (!values.every(Number.isFinite)) return null;
  return {
    count: clamp(values[0], 40, 220),
    alignment: clamp(values[1], 0, 1.4),
    cohesion: clamp(values[2], 0, 1.4),
    separation: clamp(values[3], 0, 1.5),
    mode: modeValue === 'beacon' ? 'beacon' : 'predator',
  };
}

export function FlockMindLab() {
  const shared = useMemo(() => parseFlockState(), []);
  const [count, setCount] = useState(shared?.count || 120);
  const [alignment, setAlignment] = useState(shared?.alignment || 0.72);
  const [cohesion, setCohesion] = useState(shared?.cohesion || 0.54);
  const [separation, setSeparation] = useState(shared?.separation || 0.86);
  const [mode, setMode] = useState(shared?.mode || 'predator');
  const [paused, setPaused] = useState(false);
  const [coherence, setCoherence] = useState(0);
  const [notice, setNotice] = useState(shared ? 'Shared flock loaded. Move over the field to test it.' : 'Move across the field. The flock treats you as a predator.');
  const canvasRef = useRef(null);
  const birdsRef = useRef([]);
  const controlsRef = useRef({ count, alignment, cohesion, separation, mode });
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });
  const pausedRef = useRef(paused);
  const resetRef = useRef(0);

  useEffect(() => { controlsRef.current = { count, alignment, cohesion, separation, mode }; }, [count, alignment, cohesion, separation, mode]);
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

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(360, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      birdsRef.current = makeFlock(controlsRef.current.count, width, height, 91);
    }

    function pointer(event) {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top, active: true };
    }

    function pointerLeave() {
      pointerRef.current.active = false;
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('pointermove', pointer);
    canvas.addEventListener('pointerenter', pointer);
    canvas.addEventListener('pointerleave', pointerLeave);
    resize();

    function render() {
      if (lastReset !== resetRef.current || birdsRef.current.length !== controlsRef.current.count) {
        lastReset = resetRef.current;
        birdsRef.current = makeFlock(controlsRef.current.count, width, height, Date.now() % 100000);
      }

      context.fillStyle = 'rgba(2, 5, 12, 0.3)';
      context.fillRect(0, 0, width, height);
      const birds = birdsRef.current;
      const controls = controlsRef.current;

      if (!pausedRef.current) {
        for (let index = 0; index < birds.length; index += 1) {
          const bird = birds[index];
          let neighbors = 0;
          let avgVx = 0;
          let avgVy = 0;
          let centerX = 0;
          let centerY = 0;
          let avoidX = 0;
          let avoidY = 0;

          for (let otherIndex = 0; otherIndex < birds.length; otherIndex += 1) {
            if (otherIndex === index) continue;
            const other = birds[otherIndex];
            let dx = other.x - bird.x;
            let dy = other.y - bird.y;
            if (Math.abs(dx) > width / 2) dx -= Math.sign(dx) * width;
            if (Math.abs(dy) > height / 2) dy -= Math.sign(dy) * height;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared < 4200) {
              neighbors += 1;
              avgVx += other.vx;
              avgVy += other.vy;
              centerX += dx;
              centerY += dy;
              if (distanceSquared < 420) {
                const scale = 1 / Math.max(1, distanceSquared);
                avoidX -= dx * scale;
                avoidY -= dy * scale;
              }
            }
          }

          if (neighbors) {
            avgVx /= neighbors;
            avgVy /= neighbors;
            centerX /= neighbors;
            centerY /= neighbors;
            bird.vx += (avgVx - bird.vx) * 0.012 * controls.alignment;
            bird.vy += (avgVy - bird.vy) * 0.012 * controls.alignment;
            bird.vx += centerX * 0.00018 * controls.cohesion;
            bird.vy += centerY * 0.00018 * controls.cohesion;
            bird.vx += avoidX * 2.8 * controls.separation;
            bird.vy += avoidY * 2.8 * controls.separation;
          }

          if (pointerRef.current.active) {
            const dx = pointerRef.current.x - bird.x;
            const dy = pointerRef.current.y - bird.y;
            const distanceSquared = Math.max(120, dx * dx + dy * dy);
            const direction = controls.mode === 'beacon' ? 1 : -1;
            bird.vx += direction * dx * 18 / distanceSquared;
            bird.vy += direction * dy * 18 / distanceSquared;
          }

          const speed = Math.hypot(bird.vx, bird.vy);
          const maxSpeed = 2.45;
          if (speed > maxSpeed) {
            bird.vx = bird.vx / speed * maxSpeed;
            bird.vy = bird.vy / speed * maxSpeed;
          }
          bird.x = (bird.x + bird.vx + width) % width;
          bird.y = (bird.y + bird.vy + height) % height;
        }
      }

      let directionX = 0;
      let directionY = 0;
      birds.forEach((bird) => {
        const angle = Math.atan2(bird.vy, bird.vx);
        directionX += Math.cos(angle);
        directionY += Math.sin(angle);
        context.save();
        context.translate(bird.x, bird.y);
        context.rotate(angle);
        context.fillStyle = `hsla(${bird.hue}, 90%, 68%, 0.82)`;
        context.beginPath();
        context.moveTo(7, 0);
        context.lineTo(-4, 3.2);
        context.lineTo(-2.2, 0);
        context.lineTo(-4, -3.2);
        context.closePath();
        context.fill();
        context.restore();
      });

      if (frameCount % 20 === 0) setCoherence(Math.round(Math.hypot(directionX, directionY) / Math.max(1, birds.length) * 100));
      frameCount += 1;
      animationId = window.requestAnimationFrame(render);
    }

    animationId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationId);
      canvas.removeEventListener('pointermove', pointer);
      canvas.removeEventListener('pointerenter', pointer);
      canvas.removeEventListener('pointerleave', pointerLeave);
    };
  }, []);

  function challengeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'flock');
    url.searchParams.set('state', [count, round(alignment, 2), round(cohesion, 2), round(separation, 2), mode].join(','));
    url.hash = 'playground';
    return url.toString();
  }

  return (
    <div className="gg-sim-lab gg-deep-lab">
      <DeepLabHeading
        kicker="Experiment 006 · collective intelligence"
        title="Steer a mind with no leader."
        description="Each bird follows only three local rules: align, gather and avoid collisions. Move through the flock as a predator or beacon and watch group intelligence reorganize around you."
        scoreLabel="Flock coherence"
        score={`${coherence}%`}
        scoreNote={coherence > 82 ? 'Shared direction achieved' : 'Local rules still competing'}
      />
      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-flock-canvas" aria-label="Interactive flocking simulation" />
          <div className="gg-sim-canvas-label"><Wind size={14} /> Move over the canvas to influence the flock</div>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-deep-mission"><Target size={18} /><span>Mission</span><strong>Reach 85% coherence while predator mode is active.</strong></div>
          <label className="gg-control-row"><span>Birds <strong>{count}</strong></span><input type="range" min="40" max="220" step="10" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Alignment <strong>{round(alignment, 2)}</strong></span><input type="range" min="0" max="1.4" step="0.02" value={alignment} onChange={(event) => setAlignment(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Cohesion <strong>{round(cohesion, 2)}</strong></span><input type="range" min="0" max="1.4" step="0.02" value={cohesion} onChange={(event) => setCohesion(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Separation <strong>{round(separation, 2)}</strong></span><input type="range" min="0" max="1.5" step="0.02" value={separation} onChange={(event) => setSeparation(Number(event.target.value))} /></label>
          <div className="gg-deep-toggle">
            <button type="button" className={mode === 'predator' ? 'active' : ''} onClick={() => { setMode('predator'); setNotice('Predator mode active. The flock repels away from your pointer.'); }}>Predator</button>
            <button type="button" className={mode === 'beacon' ? 'active' : ''} onClick={() => { setMode('beacon'); setNotice('Beacon mode active. The flock is drawn toward your pointer.'); }}>Beacon</button>
          </div>
          <div className="gg-model-card"><span>Model underneath</span><strong>Reynolds boids</strong><p>Complex flocking emerges from three local steering rules without a central controller.</p></div>
        </aside>
      </div>
      <DeepLabActions
        paused={paused}
        onPause={() => setPaused((value) => !value)}
        onReset={() => { resetRef.current += 1; setNotice('New flock generated from the same rules.'); }}
        onShare={() => shareChallenge({ title: `My GaugeGap flock reached ${coherence}% coherence`, text: 'Can you make a leaderless flock coordinate better?', url: challengeUrl(), setNotice })}
        onCopy={() => copyChallenge(challengeUrl(), setNotice)}
        notice={notice}
      />
    </div>
  );
}

function buildNetwork(count, width, height, seed) {
  const random = seededRandom(seed);
  const nodes = Array.from({ length: count }, (_, index) => ({
    x: 38 + random() * Math.max(20, width - 76),
    y: 38 + random() * Math.max(20, height - 76),
    state: 'susceptible',
    timer: 0,
    id: index,
  }));
  const edges = [];
  const keys = new Set();
  for (let index = 0; index < count; index += 1) {
    const distances = nodes
      .map((node, other) => ({ other, distance: Math.hypot(node.x - nodes[index].x, node.y - nodes[index].y) }))
      .filter((item) => item.other !== index)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);
    distances.forEach(({ other }) => {
      const key = index < other ? `${index}-${other}` : `${other}-${index}`;
      if (!keys.has(key)) {
        keys.add(key);
        edges.push({ key, a: index, b: other });
      }
    });
  }
  return { nodes, edges };
}

function parseOutbreakState() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') !== 'outbreak') return null;
  const [transmissionValue, recoveryValue, contactsValue] = (query.get('state') || '').split(',').map(Number);
  if (![transmissionValue, recoveryValue, contactsValue].every(Number.isFinite)) return null;
  return {
    transmission: clamp(transmissionValue, 0.08, 0.9),
    recovery: clamp(recoveryValue, 2, 12),
    contacts: clamp(contactsValue, 1, 4),
  };
}

export function OutbreakZeroLab() {
  const shared = useMemo(() => parseOutbreakState(), []);
  const [transmission, setTransmission] = useState(shared?.transmission || 0.38);
  const [recovery, setRecovery] = useState(shared?.recovery || 6);
  const [contacts, setContacts] = useState(shared?.contacts || 1);
  const [tool, setTool] = useState('infect');
  const [paused, setPaused] = useState(false);
  const [stats, setStats] = useState({ infected: 0, recovered: 0, immunized: 0, peak: 0 });
  const [budget, setBudget] = useState(12);
  const [notice, setNotice] = useState(shared ? 'Shared outbreak settings loaded. Choose patient zero.' : 'Choose patient zero, then use your limited vaccine budget.');
  const canvasRef = useRef(null);
  const networkRef = useRef({ nodes: [], edges: [] });
  const controlsRef = useRef({ transmission, recovery, contacts });
  const pausedRef = useRef(paused);
  const budgetRef = useRef(budget);
  const toolRef = useRef(tool);
  const resetRef = useRef(0);

  useEffect(() => { controlsRef.current = { transmission, recovery, contacts }; }, [transmission, recovery, contacts]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { budgetRef.current = budget; }, [budget]);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let width = 0;
    let height = 0;
    let animationId = 0;
    let frameCount = 0;
    let accumulator = 0;
    let lastTime = performance.now();
    let lastReset = -1;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(360, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      networkRef.current = buildNetwork(62, width, height, 734);
    }

    function resetNetwork() {
      networkRef.current = buildNetwork(62, width, height, Date.now() % 100000);
      setBudget(12);
      setStats({ infected: 0, recovered: 0, immunized: 0, peak: 0 });
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    function onClick(event) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const nearest = networkRef.current.nodes.reduce((best, candidate) => {
        const distance = Math.hypot(candidate.x - x, candidate.y - y);
        return distance < best.distance ? { node: candidate, distance } : best;
      }, { node: null, distance: Infinity });
      if (!nearest.node || nearest.distance > 20) return;
      const node = nearest.node;
      if (toolRef.current === 'infect' && node.state === 'susceptible') {
        node.state = 'infected';
        node.timer = 0;
        setNotice('Patient zero selected. Switch to immunize and interrupt the graph.');
      }
      if (toolRef.current === 'immunize' && node.state === 'susceptible' && budgetRef.current > 0) {
        node.state = 'immunized';
        setBudget((value) => value - 1);
        setNotice('Node immunized. Strategic bridge positions matter more than random coverage.');
      }
    }

    canvas.addEventListener('click', onClick);

    function step(delta) {
      const { nodes, edges } = networkRef.current;
      const active = controlsRef.current;
      const newlyInfected = new Set();
      edges.forEach((edge) => {
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        const attempts = Math.max(1, Math.round(active.contacts));
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const probability = active.transmission * delta * 0.48;
          if (a.state === 'infected' && b.state === 'susceptible' && Math.random() < probability) newlyInfected.add(b);
          if (b.state === 'infected' && a.state === 'susceptible' && Math.random() < probability) newlyInfected.add(a);
        }
      });
      newlyInfected.forEach((node) => { node.state = 'infected'; node.timer = 0; });
      nodes.forEach((node) => {
        if (node.state === 'infected') {
          node.timer += delta;
          if (node.timer > active.recovery) node.state = 'recovered';
        }
      });
    }

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        resetNetwork();
      }
      const delta = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      accumulator += delta;
      if (!pausedRef.current && accumulator > 0.035) {
        step(accumulator);
        accumulator = 0;
      }

      context.fillStyle = '#02050d';
      context.fillRect(0, 0, width, height);
      const { nodes, edges } = networkRef.current;
      edges.forEach((edge) => {
        const a = nodes[edge.a];
        const b = nodes[edge.b];
        context.strokeStyle = a.state === 'infected' || b.state === 'infected' ? 'rgba(255, 88, 115, 0.28)' : 'rgba(125, 249, 255, 0.09)';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      });

      const palette = { susceptible: '#5a7184', infected: '#ff5873', recovered: '#7df9ff', immunized: '#d9ff65' };
      nodes.forEach((node) => {
        context.shadowBlur = node.state === 'infected' ? 18 : 10;
        context.shadowColor = palette[node.state];
        context.fillStyle = palette[node.state];
        context.beginPath();
        context.arc(node.x, node.y, node.state === 'infected' ? 6 : 4.5, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      });

      if (frameCount % 14 === 0) {
        const infected = nodes.filter((node) => node.state === 'infected').length;
        const recoveredCount = nodes.filter((node) => node.state === 'recovered').length;
        const immunized = nodes.filter((node) => node.state === 'immunized').length;
        setStats((current) => ({ infected, recovered: recoveredCount, immunized, peak: Math.max(current.peak, infected) }));
      }
      frameCount += 1;
      animationId = window.requestAnimationFrame(render);
    }

    animationId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      canvas.removeEventListener('click', onClick);
      window.cancelAnimationFrame(animationId);
    };
  }, []);

  const containment = Math.round(clamp(100 - (stats.peak / 62) * 100 + budget * 1.2, 0, 100));

  function challengeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'outbreak');
    url.searchParams.set('state', [round(transmission, 2), recovery, contacts].join(','));
    url.hash = 'playground';
    return url.toString();
  }

  return (
    <div className="gg-sim-lab gg-deep-lab">
      <DeepLabHeading
        kicker="Experiment 007 · network epidemiology"
        title="Stop an outbreak before the graph turns red."
        description="Pick patient zero. Then spend only twelve vaccines. The challenge is not maximum coverage—it is finding the few network positions that interrupt the most transmission paths."
        scoreLabel="Containment"
        score={`${containment}%`}
        scoreNote={`Peak infected: ${stats.peak} / 62`}
      />
      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap">
          <canvas ref={canvasRef} className="gg-sim-canvas gg-outbreak-canvas" aria-label="Interactive epidemic network simulation" />
          <div className="gg-sim-canvas-label"><Crosshair size={14} /> Click nodes to {tool === 'infect' ? 'choose patient zero' : 'immunize'} · vaccines left: {budget}</div>
        </div>
        <aside className="gg-sim-controls">
          <div className="gg-deep-mission"><Shield size={18} /><span>Mission</span><strong>Keep peak infections under 12 using twelve vaccines.</strong></div>
          <div className="gg-deep-toggle">
            <button type="button" className={tool === 'infect' ? 'active' : ''} onClick={() => setTool('infect')}>Infect</button>
            <button type="button" className={tool === 'immunize' ? 'active' : ''} onClick={() => setTool('immunize')}>Immunize ({budget})</button>
          </div>
          <label className="gg-control-row"><span>Transmission <strong>{round(transmission, 2)}</strong></span><input type="range" min="0.08" max="0.9" step="0.02" value={transmission} onChange={(event) => setTransmission(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Recovery time <strong>{recovery}s</strong></span><input type="range" min="2" max="12" step="0.5" value={recovery} onChange={(event) => setRecovery(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Contact intensity <strong>{contacts}×</strong></span><input type="range" min="1" max="4" step="1" value={contacts} onChange={(event) => setContacts(Number(event.target.value))} /></label>
          <div className="gg-outbreak-stats"><span>Active <strong>{stats.infected}</strong></span><span>Recovered <strong>{stats.recovered}</strong></span><span>Immunized <strong>{stats.immunized}</strong></span></div>
          <div className="gg-model-card"><span>Model underneath</span><strong>SIR process on a contact graph</strong><p>Transmission depends on network edges, not physical distance. High-degree bridge nodes can matter more than broad random vaccination.</p></div>
        </aside>
      </div>
      <DeepLabActions
        paused={paused}
        onPause={() => setPaused((value) => !value)}
        onReset={() => { resetRef.current += 1; setNotice('Fresh contact network generated. Choose a new patient zero.'); }}
        onShare={() => shareChallenge({ title: `I contained GaugeGap outbreak at ${containment}%`, text: `Can you keep the peak below ${stats.peak} with twelve vaccines?`, url: challengeUrl(), setNotice })}
        onCopy={() => copyChallenge(challengeUrl(), setNotice)}
        notice={notice}
      />
    </div>
  );
}
