import React, { useEffect, useRef, useState } from 'react';
import { Box, Layers3, MousePointer2, RotateCcw, ScanLine } from 'lucide-react';

// An intentionally synthetic scene: visitors can explore the representation
// without mistaking the illustration for a customer scan or measured geometry.
function randomSequence(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = randomSequence(2719);
const POINTS = [];
function addPoint(x, y, z, kind, size = 1) {
  POINTS.push({ x, y, z, kind, size });
}
function addPlane(count, sampler, kind) {
  for (let i = 0; i < count; i++) {
    const p = sampler(rand(), rand());
    addPoint(p[0], p[1], p[2], kind, 0.65 + rand() * 1.1);
  }
}
function addBox(cx, cy, cz, sx, sy, sz, kind, count) {
  for (let i = 0; i < count; i++) {
    const u = rand() - 0.5;
    const v = rand() - 0.5;
    const face = Math.floor(rand() * 6);
    const x = cx + (face === 0 ? -sx / 2 : face === 1 ? sx / 2 : u * sx);
    const y = cy + (face === 2 ? -sy / 2 : face === 3 ? sy / 2 : (face <= 1 ? u : v) * sy);
    const z = cz + (face === 4 ? -sz / 2 : face === 5 ? sz / 2 : v * sz);
    addPoint(x, y, z, kind, 0.6 + rand() * 1.25);
  }
}
addPlane(1550, (a, b) => [-3.5 + a * 7, 0, -2.7 + b * 5.4], 'floor');
addPlane(1700, (a, b) => [-3.5 + a * 7, b * 3.55, -2.7], 'structure');
addPlane(900, (a, b) => [-3.5, b * 3.55, -2.7 + a * 5.4], 'side');
addPlane(360, (a, b) => [3.5, b * 3.55, -2.7 + a * 5.4], 'side');
for (let x = -3.5; x <= 3.5; x += 0.12) addPoint(x, 3.52, -2.7, 'edge', 1.3);
for (let z = -2.7; z <= 2.7; z += 0.12) addPoint(-3.5, 3.52, z, 'edge', 1.3);
addBox(-1.5, 0.44, 0.65, 2.1, 0.8, 0.95, 'furniture', 780);
addBox(-1.5, 0.96, 0.24, 2.1, 0.85, 0.24, 'furniture', 450);
addBox(0.65, 0.42, 0.82, 1.4, 0.15, 0.8, 'accent', 430);
addBox(0.55, 0.22, 0.82, 0.12, 0.45, 0.12, 'accent', 110);
addBox(0.1, 0.22, 0.82, 0.12, 0.45, 0.12, 'accent', 110);
addBox(2.05, 0.52, -1.45, 1.95, 1.04, 0.7, 'furniture', 540);
addBox(2.05, 1.11, -1.45, 1.95, 0.08, 0.8, 'edge', 260);
for (let i = 0; i < 470; i++) {
  const y = rand() * 1.5 + 0.2;
  const angle = rand() * Math.PI * 2;
  const radius = (1.7 - y) * 0.21 * rand();
  addPoint(2.7 + Math.cos(angle) * radius, y, 1.55 + Math.sin(angle) * radius, 'plant', 1.1);
}
const COLORS = { floor: '#7ca1ac', structure: '#58bdd3', side: '#7687c6', furniture: '#aa89ff', accent: '#d5c8ee', edge: '#e0faff', plant: '#7deac8' };
const BOXES = [
  [-3.5, 0, -2.7, 3.5, 3.55, 2.7, '#68eaff'],
  [-2.55, 0.03, 0.17, -0.45, 1.36, 1.13, '#ad8cff'],
  [-0.05, 0, 0.42, 1.35, 0.6, 1.22, '#b1a2ff'],
  [1.07, 0, -1.85, 3.02, 1.2, -1.05, '#68eaff'],
];
function drawOutline(ctx, project, cube) {
  const [x0, y0, z0, x1, y1, z1, color] = cube;
  const v = [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
  const p = v.map(q => project(q[0],q[1],q[2]));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.62;
  for (const indices of [[0,1,2,3,0],[4,5,6,7,4],[0,4],[1,5],[2,6],[3,7]]) {
    ctx.beginPath();
    indices.forEach((index, i) => i ? ctx.lineTo(p[index].x,p[index].y) : ctx.moveTo(p[index].x,p[index].y));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
export function WorldScene() {
  const canvasRef = useRef(null);
  const viewRef = useRef({ yaw: -0.48, pitch: 0.29, draw: null, drag: false, x: 0, y: 0 });
  const [mode, setMode] = useState('points');

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    let width = 0, height = 0;
    function render() {
      if (!width || !height) return;
      const v = viewRef.current;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      const cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
      const focal = Math.min(width * 1.25, height * 1.7);
      function project(x, y, z) {
        const rx = cy * x + sy * z;
        const rz = -sy * x + cy * z;
        const ey = y - 1.45;
        const up = cp * ey - sp * rz;
        const depth = sp * ey + cp * rz;
        const scale = focal / (10.2 + depth);
        return { x: width * 0.5 + rx * scale, y: height * 0.56 - up * scale, depth, scale };
      }
      const cloud = [];
      for (let i = 0; i < POINTS.length; i += (mode === 'geometry' ? 7 : mode === 'objects' ? 3 : 1)) {
        const point = POINTS[i];
        const p = project(point.x, point.y, point.z);
        if (p.x < -3 || p.x > width + 3 || p.y < -3 || p.y > height + 3) continue;
        cloud.push({ ...p, kind: point.kind, size: point.size });
      }
      cloud.sort((a,b) => b.depth - a.depth);
      for (const dot of cloud) {
        ctx.fillStyle = COLORS[dot.kind];
        ctx.globalAlpha = mode === 'geometry' ? 0.43 : (dot.kind === 'floor' ? 0.53 : 0.86);
        const size = Math.max(0.65, Math.min(2.9, dot.size * dot.scale * 0.028));
        ctx.fillRect(dot.x, dot.y, size, size);
      }
      ctx.globalAlpha = 1;
      if (mode !== 'points') {
        BOXES.forEach(box => drawOutline(ctx, project, box));
        if (mode === 'objects') {
          for (const [label, pos, color] of [
            ['ROOM SHELL', [-2.8, 2.85, -2.7], '#68eaff'],
            ['SEATING', [-1.3, 1.65, 0.55], '#b69cff'],
            ['FIXTURES', [2.05, 1.85, -1.45], '#68eaff'],
          ]) {
            const p = project(...pos);
            ctx.fillStyle = '#071019';
            ctx.fillRect(p.x - 4, p.y - 17, label.length * 7.6 + 13, 23);
            ctx.strokeStyle = color;
            ctx.strokeRect(p.x - 4, p.y - 17, label.length * 7.6 + 13, 23);
            ctx.font = '600 10px ui-monospace, monospace';
            ctx.fillStyle = '#e9faff';
            ctx.fillText(label, p.x + 4, p.y - 1);
          }
        }
      }
    }
    function resize() {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      render();
    }
    viewRef.current.draw = render;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(host);
    window.addEventListener('resize', resize);
    resize();
    return () => { observer?.disconnect(); window.removeEventListener('resize', resize); viewRef.current.draw = null; };
  }, [mode]);

  function onPointerDown(event) {
    viewRef.current.drag = true;
    viewRef.current.x = event.clientX;
    viewRef.current.y = event.clientY;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onPointerMove(event) {
    const v = viewRef.current;
    if (!v.drag) return;
    v.yaw += (event.clientX - v.x) * 0.006;
    v.pitch = Math.max(-0.05, Math.min(0.9, v.pitch + (event.clientY - v.y) * 0.003));
    v.x = event.clientX;
    v.y = event.clientY;
    v.draw?.();
  }
  function onPointerUp() { viewRef.current.drag = false; }
  function onKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    viewRef.current.yaw += event.key === 'ArrowLeft' ? -0.12 : event.key === 'ArrowRight' ? 0.12 : 0;
    viewRef.current.pitch = Math.max(-0.05, Math.min(0.9, viewRef.current.pitch + (event.key === 'ArrowUp' ? -0.1 : event.key === 'ArrowDown' ? 0.1 : 0)));
    viewRef.current.draw?.();
  }
  function reset() { viewRef.current.yaw = -0.48; viewRef.current.pitch = 0.29; viewRef.current.draw?.(); }

  const tabs = [
    { id: 'points', label: 'Point cloud', icon: ScanLine },
    { id: 'geometry', label: 'Geometry', icon: Box },
    { id: 'objects', label: 'Objects', icon: Layers3 },
  ];
  return <div className="world-scene-frame" id="world-preview" aria-label="Illustrative interactive spatial model">
    <div className="world-scene-top"><span><i /> WORLD ENGINE / SCENE 001</span><span>ILLUSTRATIVE DEMO</span></div>
    <div className="world-scene-stage">
      <canvas ref={canvasRef} role="img" tabIndex={0} aria-label="Procedurally generated 3D point-cloud room. Drag or use arrow keys to rotate." onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onKeyDown} />
      <div className="world-scene-floating world-scene-floating-a"><span>SPATIAL DATA</span><strong>Room geometry</strong><small>Illustrative</small></div>
      <div className="world-scene-floating world-scene-floating-b"><span>VIEW MODE</span><strong>{mode === 'points' ? 'RGB point cloud' : mode === 'geometry' ? 'Geometry outline' : 'Object labels'}</strong></div>
      <span className="world-scene-orbit"><MousePointer2 size={12} /> Drag to orbit</span>
    </div>
    <div className="world-scene-controls">
      <div className="world-scene-tabs" role="group" aria-label="Illustrative model views">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}><Icon size={14} aria-hidden="true" />{label}</button>)}
      </div>
      <button type="button" className="world-scene-reset" onClick={reset} aria-label="Reset 3D view"><RotateCcw size={17} /></button>
    </div>
    <p className="world-scene-note">Concept visualization, not a reconstructed scan or a precision measurement.</p>
  </div>;
}
