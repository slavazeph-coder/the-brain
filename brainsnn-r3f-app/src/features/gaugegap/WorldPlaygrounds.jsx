import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3X3, Leaf, MousePointer2, PawPrint, Rabbit, Target } from 'lucide-react';
import { clamp, copyChallenge, DeepLabActions, DeepLabHeading, round, seededRandom, shareChallenge } from './DeepLabChrome.jsx';

function parseState(lab, defaults) {
  if (typeof window === 'undefined') return defaults;
  const query = new URLSearchParams(window.location.search);
  if (query.get('lab') !== lab) return defaults;
  const values = (query.get('state') || '').split(',').map(Number);
  return values.every(Number.isFinite) ? values : defaults;
}

const LIFE_PATTERNS = {
  glider: [[1,0],[2,1],[0,2],[1,2],[2,2]],
  acorn: [[1,0],[3,1],[0,2],[1,2],[4,2],[5,2],[6,2]],
  pulsar: [[2,0],[3,0],[4,0],[8,0],[9,0],[10,0],[0,2],[5,2],[7,2],[12,2],[0,3],[5,3],[7,3],[12,3],[0,4],[5,4],[7,4],[12,4],[2,5],[3,5],[4,5],[8,5],[9,5],[10,5],[2,7],[3,7],[4,7],[8,7],[9,7],[10,7],[0,8],[5,8],[7,8],[12,8],[0,9],[5,9],[7,9],[12,9],[0,10],[5,10],[7,10],[12,10],[2,12],[3,12],[4,12],[8,12],[9,12],[10,12]],
};

export function LifePainterLab() {
  const shared = useMemo(() => parseState('life', [8, 1]), []);
  const [speed, setSpeed] = useState(clamp(shared[0], 1, 24));
  const [wrap, setWrap] = useState(Boolean(shared[1]));
  const [paused, setPaused] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [alive, setAlive] = useState(0);
  const [notice, setNotice] = useState('Paint cells directly onto the grid, then press play.');
  const canvasRef = useRef(null);
  const gridRef = useRef(null);
  const controlsRef = useRef({ speed, wrap });
  const pausedRef = useRef(paused);
  const resetRef = useRef(0);
  const patternRef = useRef('glider');

  useEffect(() => { controlsRef.current = { speed, wrap }; }, [speed, wrap]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    const cols = 96;
    const rows = 64;
    let width = 0;
    let height = 0;
    let animationId = 0;
    let lastStep = 0;
    let lastReset = -1;
    let drawing = false;
    let generationCount = 0;

    const blank = () => new Uint8Array(cols * rows);
    const index = (x, y) => y * cols + x;

    function stamp(name) {
      const grid = blank();
      const pattern = LIFE_PATTERNS[name] || LIFE_PATTERNS.glider;
      const offsetX = Math.floor(cols / 2 - 7);
      const offsetY = Math.floor(rows / 2 - 7);
      pattern.forEach(([x, y]) => {
        const px = offsetX + x;
        const py = offsetY + y;
        if (px >= 0 && px < cols && py >= 0 && py < rows) grid[index(px, py)] = 1;
      });
      gridRef.current = grid;
      generationCount = 0;
      setGeneration(0);
      setAlive(pattern.length);
    }

    function randomField() {
      const random = seededRandom(Date.now() % 100000);
      const grid = blank();
      for (let position = 0; position < grid.length; position += 1) grid[position] = random() > 0.82 ? 1 : 0;
      gridRef.current = grid;
      generationCount = 0;
      setGeneration(0);
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(380, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (!gridRef.current) stamp('glider');
    }

    function paint(event) {
      const rect = canvas.getBoundingClientRect();
      const x = clamp(Math.floor((event.clientX - rect.left) / rect.width * cols), 0, cols - 1);
      const y = clamp(Math.floor((event.clientY - rect.top) / rect.height * rows), 0, rows - 1);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && px < cols && py >= 0 && py < rows) gridRef.current[index(px, py)] = 1;
        }
      }
    }

    const pointerDown = (event) => { drawing = true; paint(event); };
    const pointerMove = (event) => { if (drawing) paint(event); };
    const pointerUp = () => { drawing = false; };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('pointerdown', pointerDown);
    canvas.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    resize();

    function step() {
      const current = gridRef.current || blank();
      const next = blank();
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          let neighbors = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (!dx && !dy) continue;
              let nx = x + dx;
              let ny = y + dy;
              if (controlsRef.current.wrap) {
                nx = (nx + cols) % cols;
                ny = (ny + rows) % rows;
              }
              if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) neighbors += current[index(nx, ny)];
            }
          }
          const live = current[index(x, y)] === 1;
          next[index(x, y)] = live ? (neighbors === 2 || neighbors === 3 ? 1 : 0) : (neighbors === 3 ? 1 : 0);
        }
      }
      gridRef.current = next;
      generationCount += 1;
      if (generationCount % 4 === 0) {
        let count = 0;
        for (let position = 0; position < next.length; position += 1) count += next[position];
        setAlive(count);
        setGeneration(generationCount);
      }
    }

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        if (patternRef.current === 'random') randomField();
        else stamp(patternRef.current);
      }
      const interval = 1000 / controlsRef.current.speed;
      if (!pausedRef.current && now - lastStep > interval) {
        step();
        lastStep = now;
      }
      context.fillStyle = '#02050a';
      context.fillRect(0, 0, width, height);
      const cellW = width / cols;
      const cellH = height / rows;
      const grid = gridRef.current || blank();
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          if (!grid[index(x, y)]) continue;
          const hue = 176 + ((x + y + generationCount) % 90);
          context.fillStyle = `hsla(${hue},90%,65%,0.88)`;
          context.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
      context.strokeStyle = 'rgba(125,249,255,0.035)';
      for (let x = 0; x <= cols; x += 8) {
        context.beginPath();
        context.moveTo(x * cellW, 0);
        context.lineTo(x * cellW, height);
        context.stroke();
      }
      for (let y = 0; y <= rows; y += 8) {
        context.beginPath();
        context.moveTo(0, y * cellH);
        context.lineTo(width, y * cellH);
        context.stroke();
      }
      animationId = window.requestAnimationFrame(render);
    }

    animationId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationId);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
    };
  }, []);

  const score = clamp(Math.round(Math.min(generation, 300) / 3 + Math.min(alive, 350) / 8), 0, 100);
  function loadPattern(name) {
    patternRef.current = name;
    resetRef.current += 1;
    setPaused(false);
    setNotice(`${name === 'random' ? 'Random universe' : name} loaded. Paint into it and change its future.`);
  }
  function challengeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'life');
    url.searchParams.set('state', [speed, wrap ? 1 : 0].join(','));
    url.hash = 'playground';
    return url.toString();
  }

  return (
    <div className="gg-sim-lab gg-deep-lab">
      <DeepLabHeading kicker="Experiment 011 · cellular automata" title="Paint rules that become life." description="Every cell sees only eight neighbours. From that tiny rule set, moving creatures, oscillators, explosions and long-lived machines emerge." scoreLabel="Living complexity" score={`${score}%`} scoreNote={`${alive} cells · generation ${generation}`} />
      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap"><canvas ref={canvasRef} className="gg-sim-canvas gg-life-canvas" aria-label="Interactive Conway Game of Life painter" /><div className="gg-sim-canvas-label"><MousePointer2 size={14} /> Drag to paint living cells</div></div>
        <aside className="gg-sim-controls">
          <div className="gg-deep-mission"><Target size={18} /><span>Mission</span><strong>Create a pattern that survives 150 generations with at least 40 cells.</strong></div>
          <div className="gg-sim-presets"><button type="button" onClick={() => loadPattern('glider')}>Glider</button><button type="button" onClick={() => loadPattern('acorn')}>Acorn</button><button type="button" onClick={() => loadPattern('pulsar')}>Pulsar</button><button type="button" onClick={() => loadPattern('random')}>Random world</button></div>
          <label className="gg-control-row"><span>Generations/sec <strong>{speed}</strong></span><input type="range" min="1" max="24" step="1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
          <div className="gg-deep-toggle"><button type="button" className={!wrap ? 'active' : ''} onClick={() => setWrap(false)}>Hard edges</button><button type="button" className={wrap ? 'active' : ''} onClick={() => setWrap(true)}>Wrap world</button></div>
          <div className="gg-model-card"><span>Model underneath</span><strong>Conway’s Game of Life</strong><p>Birth occurs with exactly three neighbours; survival requires two or three. Everything else is emergent computation.</p></div>
        </aside>
      </div>
      <DeepLabActions paused={paused} onPause={() => setPaused((value) => !value)} onReset={() => { resetRef.current += 1; setNotice('Pattern reset. Try changing one cell before restarting.'); }} onShare={() => shareChallenge({ title: `My GaugeGap life survived ${generation} generations`, text: 'Can you paint a longer-lived cellular universe?', url: challengeUrl(), setNotice })} onCopy={() => copyChallenge(challengeUrl(), setNotice)} notice={notice} />
    </div>
  );
}

function makeEntity(type, x, y, random) {
  return {
    type,
    x,
    y,
    vx: (random() - 0.5) * 1.2,
    vy: (random() - 0.5) * 1.2,
    energy: type === 'plant' ? 1 : type === 'prey' ? 48 : 62,
    age: 0,
  };
}

export function EcosystemBalanceLab() {
  const shared = useMemo(() => parseState('ecosystem', [0.72, 0.62, 1]), []);
  const [sunlight, setSunlight] = useState(clamp(shared[0], 0.2, 1.2));
  const [metabolism, setMetabolism] = useState(clamp(shared[1], 0.25, 1.1));
  const [speed, setSpeed] = useState(clamp(shared[2], 0.5, 1.8));
  const [mode, setMode] = useState('plant');
  const [paused, setPaused] = useState(false);
  const [counts, setCounts] = useState({ plant: 0, prey: 0, predator: 0, seconds: 0 });
  const [notice, setNotice] = useState('Add plants, prey or predators. Balance matters more than abundance.');
  const canvasRef = useRef(null);
  const entitiesRef = useRef([]);
  const controlsRef = useRef({ sunlight, metabolism, speed, mode });
  const pausedRef = useRef(paused);
  const resetRef = useRef(0);

  useEffect(() => { controlsRef.current = { sunlight, metabolism, speed, mode }; }, [sunlight, metabolism, speed, mode]);
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
    let started = performance.now();
    let random = seededRandom(73);

    function seedWorld() {
      random = seededRandom(Date.now() % 100000);
      const entities = [];
      for (let index = 0; index < 100; index += 1) entities.push(makeEntity('plant', random() * width, random() * height, random));
      for (let index = 0; index < 34; index += 1) entities.push(makeEntity('prey', random() * width, random() * height, random));
      for (let index = 0; index < 8; index += 1) entities.push(makeEntity('predator', random() * width, random() * height, random));
      entitiesRef.current = entities;
      started = performance.now();
      setCounts({ plant: 100, prey: 34, predator: 8, seconds: 0 });
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(320, rect.width);
      height = Math.max(400, rect.height);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      seedWorld();
    }

    function addEntity(event) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const amount = controlsRef.current.mode === 'plant' ? 8 : controlsRef.current.mode === 'prey' ? 3 : 1;
      for (let index = 0; index < amount; index += 1) entitiesRef.current.push(makeEntity(controlsRef.current.mode, x + (random() - 0.5) * 24, y + (random() - 0.5) * 24, random));
      setNotice(`${controlsRef.current.mode} added. Watch the food web react.`);
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener('pointerdown', addEntity);
    resize();

    function nearest(entity, type, radius) {
      let best = null;
      let bestDistance = radius;
      entitiesRef.current.forEach((candidate) => {
        if (candidate.type !== type || candidate === entity) return;
        const distance = Math.hypot(candidate.x - entity.x, candidate.y - entity.y);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      });
      return best;
    }

    function reproduce(entity, chance) {
      if (Math.random() < chance && entitiesRef.current.length < 420) {
        entity.energy *= 0.58;
        entitiesRef.current.push(makeEntity(entity.type, entity.x + (random() - 0.5) * 14, entity.y + (random() - 0.5) * 14, random));
      }
    }

    function render(now) {
      if (lastReset !== resetRef.current) {
        lastReset = resetRef.current;
        seedWorld();
      }
      context.fillStyle = 'rgba(2,8,8,0.38)';
      context.fillRect(0, 0, width, height);

      if (!pausedRef.current) {
        const controls = controlsRef.current;
        const plantCount = entitiesRef.current.filter((entity) => entity.type === 'plant').length;
        if (Math.random() < controls.sunlight * 0.38 && plantCount < 220) entitiesRef.current.push(makeEntity('plant', random() * width, random() * height, random));
        const removed = new Set();
        const initialLength = entitiesRef.current.length;
        for (let index = 0; index < initialLength; index += 1) {
          const entity = entitiesRef.current[index];
          entity.age += 1;
          if (entity.type === 'plant') {
            entity.energy = Math.min(4, entity.energy + 0.002 * controls.sunlight);
            reproduce(entity, entity.energy > 2.8 ? 0.0015 * controls.sunlight : 0);
            continue;
          }
          const targetType = entity.type === 'prey' ? 'plant' : 'prey';
          const target = nearest(entity, targetType, entity.type === 'prey' ? 90 : 125);
          if (target) {
            const dx = target.x - entity.x;
            const dy = target.y - entity.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            entity.vx += dx / distance * (entity.type === 'prey' ? 0.045 : 0.06);
            entity.vy += dy / distance * (entity.type === 'prey' ? 0.045 : 0.06);
            if (distance < 8) {
              removed.add(entitiesRef.current.indexOf(target));
              entity.energy += entity.type === 'prey' ? 15 : 24;
            }
          }
          entity.vx += (random() - 0.5) * 0.08;
          entity.vy += (random() - 0.5) * 0.08;
          const maximum = entity.type === 'prey' ? 1.65 : 1.95;
          const magnitude = Math.max(0.01, Math.hypot(entity.vx, entity.vy));
          if (magnitude > maximum) {
            entity.vx = entity.vx / magnitude * maximum;
            entity.vy = entity.vy / magnitude * maximum;
          }
          entity.x = (entity.x + entity.vx * controls.speed + width) % width;
          entity.y = (entity.y + entity.vy * controls.speed + height) % height;
          entity.energy -= (entity.type === 'prey' ? 0.022 : 0.035) * controls.metabolism * controls.speed;
          if (entity.energy <= 0 || entity.age > 12000) removed.add(index);
          reproduce(entity, entity.energy > (entity.type === 'prey' ? 62 : 85) ? 0.004 : 0);
        }
        entitiesRef.current = entitiesRef.current.filter((_, index) => !removed.has(index));
      }

      entitiesRef.current.forEach((entity) => {
        if (entity.type === 'plant') {
          context.fillStyle = 'rgba(110,255,120,0.68)';
          context.beginPath();
          context.arc(entity.x, entity.y, 2.2, 0, Math.PI * 2);
          context.fill();
        } else if (entity.type === 'prey') {
          context.save();
          context.translate(entity.x, entity.y);
          context.rotate(Math.atan2(entity.vy, entity.vx));
          context.fillStyle = '#7df9ff';
          context.beginPath();
          context.moveTo(7, 0);
          context.lineTo(-4, 4);
          context.lineTo(-2, 0);
          context.lineTo(-4, -4);
          context.closePath();
          context.fill();
          context.restore();
        } else {
          context.fillStyle = '#ff5e6d';
          context.beginPath();
          context.arc(entity.x, entity.y, 5, 0, Math.PI * 2);
          context.fill();
          context.strokeStyle = 'rgba(255,94,109,0.35)';
          context.beginPath();
          context.arc(entity.x, entity.y, 12, 0, Math.PI * 2);
          context.stroke();
        }
      });

      if (frame % 24 === 0) {
        const next = { plant: 0, prey: 0, predator: 0, seconds: Math.floor((now - started) / 1000) };
        entitiesRef.current.forEach((entity) => { next[entity.type] += 1; });
        setCounts(next);
      }
      frame += 1;
      animationId = window.requestAnimationFrame(render);
    }

    animationId = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationId);
      canvas.removeEventListener('pointerdown', addEntity);
    };
  }, []);

  const allAlive = counts.plant > 0 && counts.prey > 0 && counts.predator > 0;
  const balance = allAlive ? clamp(100 - Math.abs(counts.plant - counts.prey * 3) * 0.35 - Math.abs(counts.prey - counts.predator * 4) * 1.2, 0, 100) : 0;
  function challengeUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('lab', 'ecosystem');
    url.searchParams.set('state', [round(sunlight, 2), round(metabolism, 2), round(speed, 2)].join(','));
    url.hash = 'playground';
    return url.toString();
  }

  return (
    <div className="gg-sim-lab gg-deep-lab">
      <DeepLabHeading kicker="Experiment 012 · predator–prey ecology" title="Keep the whole world alive." description="Add energy, prey or predators and watch every intervention travel through the food web. Saving one species can destabilize another." scoreLabel="Ecosystem balance" score={`${Math.round(balance)}%`} scoreNote={`${counts.plant} plants · ${counts.prey} prey · ${counts.predator} predators`} />
      <div className="gg-sim-frame">
        <div className="gg-sim-canvas-wrap"><canvas ref={canvasRef} className="gg-sim-canvas gg-ecosystem-canvas" aria-label="Interactive predator prey ecosystem simulation" /><div className="gg-sim-canvas-label"><MousePointer2 size={14} /> Tap to add {mode}</div></div>
        <aside className="gg-sim-controls">
          <div className="gg-deep-mission"><Target size={18} /><span>Mission</span><strong>Keep plants, prey and predators alive for 60 seconds with balance above 65%.</strong></div>
          <div className="gg-species-picker"><button type="button" className={mode === 'plant' ? 'active' : ''} onClick={() => setMode('plant')}><Leaf size={15} /> Plants</button><button type="button" className={mode === 'prey' ? 'active' : ''} onClick={() => setMode('prey')}><Rabbit size={15} /> Prey</button><button type="button" className={mode === 'predator' ? 'active' : ''} onClick={() => setMode('predator')}><PawPrint size={15} /> Predator</button></div>
          <label className="gg-control-row"><span>Sunlight <strong>{round(sunlight, 2)}</strong></span><input type="range" min="0.2" max="1.2" step="0.05" value={sunlight} onChange={(event) => setSunlight(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Metabolism <strong>{round(metabolism, 2)}</strong></span><input type="range" min="0.25" max="1.1" step="0.05" value={metabolism} onChange={(event) => setMetabolism(Number(event.target.value))} /></label>
          <label className="gg-control-row"><span>Time speed <strong>{round(speed, 2)}×</strong></span><input type="range" min="0.5" max="1.8" step="0.1" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
          <div className="gg-model-card"><span>Model underneath</span><strong>Agent predator–prey dynamics</strong><p>Energy flows upward through a food web while reproduction, scarcity and mortality create delayed feedback.</p></div>
        </aside>
      </div>
      <DeepLabActions paused={paused} onPause={() => setPaused((value) => !value)} onReset={() => { resetRef.current += 1; setNotice('A fresh ecosystem is ready. Try a different intervention order.'); }} onShare={() => shareChallenge({ title: `My GaugeGap ecosystem balance: ${Math.round(balance)}%`, text: 'Can you keep all three levels alive longer?', url: challengeUrl(), setNotice })} onCopy={() => copyChallenge(challengeUrl(), setNotice)} notice={notice} />
    </div>
  );
}
