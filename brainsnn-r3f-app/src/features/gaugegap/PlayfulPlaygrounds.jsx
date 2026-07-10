import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, Car, MapPin, MousePointer2, Route, Target } from 'lucide-react';
import { clamp, copyChallenge, DeepLabActions, DeepLabHeading, round, seededRandom, shareChallenge } from './DeepLabChrome.jsx';

function parseState(lab, defaults) {
  if (typeof window === 'undefined') return defaults;
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') !== lab) return defaults;
  const values = (query.get('state') || '').split(',').map(Number);
  return values.every(Number.isFinite) ? values : defaults;
}

function makeAnts(count, nest, seed = 43) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => ({
    x: nest.x + (random() - 0.5) * 24,
    y: nest.y + (random() - 0.5) * 24,
    angle: random() * Math.PI * 2,
    carrying: false,
    trail: [],
  }));
}

export function AntTrailLab() {
  const shared = useMemo(() => parseState('ants', [90, 0.8, 0.07]), []);
  const [count, setCount] = useState(clamp(shared[0], 40, 180));
  const [smell, setSmell] = useState(clamp(shared[1], 0.2, 1.5));
  const [evaporation, setEvaporation] = useState(clamp(shared[2], 0.02, 0.18));
  const [mode, setMode] = useState('food');
  const [paused, setPaused] = useState(false);
  const [deliveries, setDeliveries] = useState(0);
  const [notice, setNotice] = useState('Tap the field to place food. Switch modes to build obstacles.');
  const canvasRef = useRef(null);
  const antsRef = useRef([]);
  const foodsRef = useRef([]);
  const obstaclesRef = useRef([]);
  const controlsRef = useRef({ count, smell, evaporation, mode });
  const pausedRef = useRef(paused);
  const resetRef = useRef(0);
  const deliveriesRef = useRef(0);

  useEffect(() => { controlsRef.current = { count, smell, evaporation, mode }; }, [count, smell, evaporation, mode]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let width = 0;
    let height = 0;
    let animationId = 0;
    let lastReset = -1;
    let frame = 0;
    let nest = { x: 0, y: 0 };

    function seedWorld() {
      nest = { x: width * 0.5, y: height * 0.52 };
      antsRef.current = makeAnts(controlsRef.current.count, nest, Date.now() % 100000);
      foodsRef.current = [
        { x: width * 0.2, y: height * 0.23, amount: 38 },
        { x: width * 0.8, y: height * 0.28, amount: 38 },
        { x: width * 0.72, y: height * 0.78, amount: 38 },
      ];
      obstaclesRef.current = [];
      deliveriesRef.current = 0;
      setDeliveries(0);
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(380, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seedWorld();
    }

    function addObject(event) {
      const rect = canvas.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (Math.hypot(point.x - nest.x, point.y - nest.y) < 40) return;
      if (controlsRef.current.mode === 'food') {
        foodsRef.current.push({ ...point, amount: 45 });
        setNotice('Food placed. The colony must discover and route around the field.');
      } else {
        obstaclesRef.current.push({ ...point, radius: 24 });
        setNotice('Obstacle placed. Watch the trail network reorganize.');
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('pointerdown', addObject);
    resize();

    function steer(ant, target, strength) {
      const desired = Math.atan2(target.y - ant.y, target.x - ant.x);
      let delta = desired - ant.angle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      ant.angle += clamp(delta, -strength, strength);
    }

    function render() {
      if (lastReset !== resetRef.current || antsRef.current.length !== controlsRef.current.count) {
        lastReset = resetRef.current;
        seedWorld();
      }
      context.fillStyle = 'rgba(2, 4, 8, 0.28)';
      context.fillRect(0, 0, width, height);

      context.strokeStyle = 'rgba(125,249,255,0.08)';
      context.lineWidth = 1;
      for (let x = 0; x < width; x += 40) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
      for (let y = 0; y < height; y += 40) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }

      foodsRef.current = foodsRef.current.filter((food) => food.amount > 0);
      foodsRef.current.forEach((food) => {
        context.fillStyle = 'rgba(217,255,101,0.16)'; context.beginPath(); context.arc(food.x, food.y, 16 + Math.min(18, food.amount * 0.2), 0, Math.PI * 2); context.fill();
        context.fillStyle = '#d9ff65'; context.beginPath(); context.arc(food.x, food.y, 5, 0, Math.PI * 2); context.fill();
      });
      obstaclesRef.current.forEach((obstacle) => {
        context.fillStyle = 'rgba(255,94,219,0.14)'; context.beginPath(); context.arc(obstacle.x, obstacle.y, obstacle.radius, 0, Math.PI * 2); context.fill();
        context.strokeStyle = 'rgba(255,94,219,0.5)'; context.stroke();
      });
      context.fillStyle = 'rgba(125,249,255,0.18)'; context.beginPath(); context.arc(nest.x, nest.y, 31, 0, Math.PI * 2); context.fill();
      context.strokeStyle = '#7df9ff'; context.lineWidth = 2; context.stroke();
      context.fillStyle = '#dffcff'; context.font = '11px ui-monospace'; context.textAlign = 'center'; context.fillText('NEST', nest.x, nest.y + 4);

      if (!pausedRef.current) {
        antsRef.current.forEach((ant) => {
          ant.angle += (Math.random() - 0.5) * 0.24;
          if (ant.carrying) steer(ant, nest, 0.17);
          else {
            let nearest = null;
            let nearestDistance = Infinity;
            foodsRef.current.forEach((food) => {
              const distance = Math.hypot(food.x - ant.x, food.y - ant.y);
              if (distance < nearestDistance && distance < 70 + controlsRef.current.smell * 150) { nearest = food; nearestDistance = distance; }
            });
            if (nearest) steer(ant, nearest, 0.12 * controlsRef.current.smell);
          }
          obstaclesRef.current.forEach((obstacle) => {
            const dx = ant.x - obstacle.x;
            const dy = ant.y - obstacle.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            if (distance < obstacle.radius + 20) steer(ant, { x: ant.x + dx / distance * 80, y: ant.y + dy / distance * 80 }, 0.5);
          });
          ant.x += Math.cos(ant.angle) * (ant.carrying ? 1.8 : 1.45);
          ant.y += Math.sin(ant.angle) * (ant.carrying ? 1.8 : 1.45);
          if (ant.x < 0 || ant.x > width) { ant.angle = Math.PI - ant.angle; ant.x = clamp(ant.x, 0, width); }
          if (ant.y < 0 || ant.y > height) { ant.angle = -ant.angle; ant.y = clamp(ant.y, 0, height); }
          if (!ant.carrying) {
            const food = foodsRef.current.find((item) => item.amount > 0 && Math.hypot(item.x - ant.x, item.y - ant.y) < 12);
            if (food) { ant.carrying = true; food.amount -= 1; ant.angle += Math.PI; }
          } else if (Math.hypot(nest.x - ant.x, nest.y - ant.y) < 28) {
            ant.carrying = false;
            deliveriesRef.current += 1;
            ant.angle += Math.PI;
          }
          ant.trail.push({ x: ant.x, y: ant.y });
          if (ant.trail.length > Math.round(8 + 26 * (1 - controlsRef.current.evaporation))) ant.trail.shift();
        });
      }

      antsRef.current.forEach((ant) => {
        if (ant.trail.length > 1) {
          context.strokeStyle = ant.carrying ? 'rgba(217,255,101,0.16)' : 'rgba(125,249,255,0.08)';
          context.lineWidth = 1; context.beginPath();
          ant.trail.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke();
        }
        context.save(); context.translate(ant.x, ant.y); context.rotate(ant.angle);
        context.fillStyle = ant.carrying ? '#d9ff65' : '#7df9ff'; context.fillRect(-3.5, -1.5, 7, 3); context.restore();
      });
      if (frame % 20 === 0) setDeliveries(deliveriesRef.current);
      frame += 1;
      animationId = window.requestAnimationFrame(render);
    }
    animationId = window.requestAnimationFrame(render);
    return () => { observer.disconnect(); window.cancelAnimationFrame(animationId); canvas.removeEventListener('pointerdown', addObject); };
  }, []);

  const score = Math.min(100, Math.round(deliveries * 3.5));
  function challengeUrl() {
    const url = new URL(window.location.href); url.searchParams.set('lab', 'ants'); url.searchParams.set('state', [count, round(smell, 2), round(evaporation, 2)].join(',')); url.hash = 'playground'; return url.toString();
  }

  return <div className="gg-sim-lab gg-deep-lab">
    <DeepLabHeading kicker="Experiment 009 · swarm logistics" title="Build a road system without roads." description="Place food and barriers while individual ants discover routes through local sensing, memory and repeated traffic." scoreLabel="Colony efficiency" score={`${score}%`} scoreNote={`${deliveries} food delivered`} />
    <div className="gg-sim-frame"><div className="gg-sim-canvas-wrap"><canvas ref={canvasRef} className="gg-sim-canvas gg-ant-canvas" aria-label="Interactive ant colony trail simulation" /><div className="gg-sim-canvas-label"><MousePointer2 size={14} /> Tap to place {mode === 'food' ? 'food' : 'an obstacle'}</div></div>
      <aside className="gg-sim-controls"><div className="gg-deep-mission"><Target size={18} /><span>Mission</span><strong>Deliver 25 food while forcing the colony around at least two obstacles.</strong></div>
        <div className="gg-deep-toggle"><button type="button" className={mode === 'food' ? 'active' : ''} onClick={() => setMode('food')}><MapPin size={14} /> Food</button><button type="button" className={mode === 'obstacle' ? 'active' : ''} onClick={() => setMode('obstacle')}><Route size={14} /> Obstacle</button></div>
        <label className="gg-control-row"><span>Ants <strong>{count}</strong></span><input type="range" min="40" max="180" step="10" value={count} onChange={(event) => setCount(Number(event.target.value))} /></label>
        <label className="gg-control-row"><span>Smell radius <strong>{round(smell, 2)}</strong></span><input type="range" min="0.2" max="1.5" step="0.05" value={smell} onChange={(event) => setSmell(Number(event.target.value))} /></label>
        <label className="gg-control-row"><span>Trail evaporation <strong>{round(evaporation, 2)}</strong></span><input type="range" min="0.02" max="0.18" step="0.01" value={evaporation} onChange={(event) => setEvaporation(Number(event.target.value))} /></label>
        <div className="gg-model-card"><span>Model underneath</span><strong>Stigmergic routing</strong><p>Agents coordinate indirectly by changing and sensing a shared environment instead of exchanging plans.</p></div>
      </aside></div>
    <DeepLabActions paused={paused} onPause={() => setPaused((value) => !value)} onReset={() => { resetRef.current += 1; setNotice('A fresh colony is searching the same type of world.'); }} onShare={() => shareChallenge({ title: `My GaugeGap ants delivered ${deliveries} food`, text: 'Can you design a faster leaderless transport network?', url: challengeUrl(), setNotice })} onCopy={() => copyChallenge(challengeUrl(), setNotice)} notice={notice} />
  </div>;
}

function makeCar(direction, width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  if (direction === 'north') return { direction, x: centerX + 24, y: height + 24, speed: 0, hue: 190 + Math.random() * 90 };
  if (direction === 'south') return { direction, x: centerX - 24, y: -24, speed: 0, hue: 190 + Math.random() * 90 };
  if (direction === 'east') return { direction, x: -24, y: centerY + 24, speed: 0, hue: 190 + Math.random() * 90 };
  return { direction, x: width + 24, y: centerY - 24, speed: 0, hue: 190 + Math.random() * 90 };
}

export function TrafficTamerLab() {
  const shared = useMemo(() => parseState('traffic', [0.72, 5.5, 1]), []);
  const [density, setDensity] = useState(clamp(shared[0], 0.2, 1.2));
  const [cycle, setCycle] = useState(clamp(shared[1], 2.5, 10));
  const [smart, setSmart] = useState(Boolean(shared[2]));
  const [paused, setPaused] = useState(false);
  const [phase, setPhase] = useState('NS');
  const [stats, setStats] = useState({ passed: 0, queue: 0, peak: 0 });
  const [notice, setNotice] = useState('Tap the intersection or use Switch lights to control the signal.');
  const canvasRef = useRef(null);
  const carsRef = useRef([]);
  const controlsRef = useRef({ density, cycle, smart });
  const phaseRef = useRef(phase);
  const pausedRef = useRef(paused);
  const resetRef = useRef(0);

  useEffect(() => { controlsRef.current = { density, cycle, smart }; }, [density, cycle, smart]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  function togglePhase() { setPhase((current) => current === 'NS' ? 'EW' : 'NS'); setNotice('Signal changed. Watch the queues redistribute.'); }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let width = 0; let height = 0; let animationId = 0; let frame = 0; let passed = 0; let peak = 0; let lastReset = -1; let lastSwitch = performance.now();
    const directions = ['north', 'south', 'east', 'west'];
    function resize() { const rect = canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2); width = Math.max(320, rect.width); height = Math.max(400, rect.height); canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio); context.setTransform(ratio, 0, 0, ratio, 0, 0); carsRef.current = []; }
    const observer = new ResizeObserver(resize); observer.observe(canvas); canvas.addEventListener('pointerdown', togglePhase); resize();

    function beforeStop(car, centerX, centerY) {
      if (car.direction === 'north') return car.y > centerY + 72;
      if (car.direction === 'south') return car.y < centerY - 72;
      if (car.direction === 'east') return car.x < centerX - 72;
      return car.x > centerX + 72;
    }
    function position(car) { return car.direction === 'north' ? -car.y : car.direction === 'south' ? car.y : car.direction === 'east' ? car.x : -car.x; }

    function render(now) {
      if (lastReset !== resetRef.current) { lastReset = resetRef.current; carsRef.current = []; passed = 0; peak = 0; setStats({ passed: 0, queue: 0, peak: 0 }); }
      const centerX = width / 2; const centerY = height / 2;
      context.fillStyle = '#061018'; context.fillRect(0, 0, width, height);
      context.fillStyle = '#111827'; context.fillRect(centerX - 74, 0, 148, height); context.fillRect(0, centerY - 74, width, 148);
      context.strokeStyle = 'rgba(255,255,255,0.18)'; context.setLineDash([14, 12]); context.beginPath(); context.moveTo(centerX, 0); context.lineTo(centerX, height); context.moveTo(0, centerY); context.lineTo(width, centerY); context.stroke(); context.setLineDash([]);
      context.fillStyle = phaseRef.current === 'NS' ? '#d9ff65' : '#ff5e6d'; context.fillRect(centerX - 68, centerY - 82, 18, 8); context.fillRect(centerX + 50, centerY + 74, 18, 8);
      context.fillStyle = phaseRef.current === 'EW' ? '#d9ff65' : '#ff5e6d'; context.fillRect(centerX - 82, centerY + 50, 8, 18); context.fillRect(centerX + 74, centerY - 68, 8, 18);

      if (!pausedRef.current) {
        if (Math.random() < controlsRef.current.density * 0.018 && carsRef.current.length < 90) carsRef.current.push(makeCar(directions[Math.floor(Math.random() * 4)], width, height));
        const elapsed = (now - lastSwitch) / 1000;
        if (elapsed > controlsRef.current.cycle) {
          if (controlsRef.current.smart) {
            const ns = carsRef.current.filter((car) => ['north', 'south'].includes(car.direction) && beforeStop(car, centerX, centerY)).length;
            const ew = carsRef.current.filter((car) => ['east', 'west'].includes(car.direction) && beforeStop(car, centerX, centerY)).length;
            setPhase(ns >= ew ? 'NS' : 'EW');
          } else togglePhase();
          lastSwitch = now;
        }
        directions.forEach((direction) => {
          const sameLane = carsRef.current.filter((car) => car.direction === direction).sort((a, b) => position(b) - position(a));
          sameLane.forEach((car, index) => {
            const green = ['north', 'south'].includes(direction) ? phaseRef.current === 'NS' : phaseRef.current === 'EW';
            const lead = sameLane[index - 1];
            const gap = lead ? position(lead) - position(car) : Infinity;
            const redStop = !green && beforeStop(car, centerX, centerY);
            const target = redStop || gap < 25 ? 0 : 2.1;
            car.speed += (target - car.speed) * 0.12;
            if (direction === 'north') car.y -= car.speed;
            if (direction === 'south') car.y += car.speed;
            if (direction === 'east') car.x += car.speed;
            if (direction === 'west') car.x -= car.speed;
          });
        });
        const survivors = [];
        carsRef.current.forEach((car) => {
          const outside = car.x < -50 || car.x > width + 50 || car.y < -50 || car.y > height + 50;
          if (outside) passed += 1; else survivors.push(car);
        });
        carsRef.current = survivors;
      }

      carsRef.current.forEach((car) => { context.save(); context.translate(car.x, car.y); if (['east', 'west'].includes(car.direction)) context.rotate(Math.PI / 2); context.fillStyle = `hsl(${car.hue},85%,65%)`; context.fillRect(-8, -14, 16, 28); context.fillStyle = 'rgba(255,255,255,0.6)'; context.fillRect(-5, -10, 10, 5); context.restore(); });
      const queue = carsRef.current.filter((car) => car.speed < 0.45 && beforeStop(car, centerX, centerY)).length; peak = Math.max(peak, queue);
      if (frame % 20 === 0) setStats({ passed, queue, peak }); frame += 1;
      animationId = window.requestAnimationFrame(render);
    }
    animationId = window.requestAnimationFrame(render);
    return () => { observer.disconnect(); window.cancelAnimationFrame(animationId); canvas.removeEventListener('pointerdown', togglePhase); };
  }, []);

  const score = clamp(Math.round(stats.passed * 1.8 - stats.peak * 2.2), 0, 100);
  function challengeUrl() { const url = new URL(window.location.href); url.searchParams.set('lab', 'traffic'); url.searchParams.set('state', [round(density, 2), round(cycle, 1), smart ? 1 : 0].join(',')); url.hash = 'playground'; return url.toString(); }

  return <div className="gg-sim-lab gg-deep-lab">
    <DeepLabHeading kicker="Experiment 010 · traffic flow" title="Can you beat the traffic light?" description="Control one intersection under rising demand. Every green light solves one queue while quietly creating another." scoreLabel="City flow" score={`${score}%`} scoreNote={`${stats.passed} passed · peak queue ${stats.peak}`} />
    <div className="gg-sim-frame"><div className="gg-sim-canvas-wrap"><canvas ref={canvasRef} className="gg-sim-canvas gg-traffic-canvas" aria-label="Interactive traffic intersection simulation" /><button type="button" className="gg-sim-float-action" onClick={togglePhase}><Car size={15} /> Switch lights</button><div className="gg-sim-canvas-label">Current green: {phase === 'NS' ? 'north–south' : 'east–west'} · queue {stats.queue}</div></div>
      <aside className="gg-sim-controls"><div className="gg-deep-mission"><Target size={18} /><span>Mission</span><strong>Move 50 cars while keeping the peak queue below 12.</strong></div>
        <label className="gg-control-row"><span>Traffic demand <strong>{round(density, 2)}</strong></span><input type="range" min="0.2" max="1.2" step="0.05" value={density} onChange={(event) => setDensity(Number(event.target.value))} /></label>
        <label className="gg-control-row"><span>Signal cycle <strong>{round(cycle, 1)}s</strong></span><input type="range" min="2.5" max="10" step="0.5" value={cycle} onChange={(event) => setCycle(Number(event.target.value))} /></label>
        <div className="gg-deep-toggle"><button type="button" className={!smart ? 'active' : ''} onClick={() => setSmart(false)}>Fixed timer</button><button type="button" className={smart ? 'active' : ''} onClick={() => setSmart(true)}>Queue sensing</button></div>
        <div className="gg-model-card"><span>Model underneath</span><strong>Queueing and phase control</strong><p>Throughput depends on arrival rates, service windows and whether local optimization creates downstream congestion.</p></div>
      </aside></div>
    <DeepLabActions paused={paused} onPause={() => setPaused((value) => !value)} onReset={() => { resetRef.current += 1; setNotice('Intersection reset. Try a different signal policy.'); }} onShare={() => shareChallenge({ title: `My GaugeGap traffic score: ${score}%`, text: 'Can you move more cars with a smaller queue?', url: challengeUrl(), setNotice })} onCopy={() => copyChallenge(challengeUrl(), setNotice)} notice={notice} />
  </div>;
}
