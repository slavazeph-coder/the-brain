import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { useReducedMotion } from '../../hooks/useReducedMotion.js';
import { clampScore } from '../../lib/formatters.js';
import { getBusinessMetrics } from '../../lib/scoreMapping.js';

const REGION_LAYOUT = [
  { id: 'hookStrength', x: 0.32, y: 0.36, radius: 0.13 },
  { id: 'trust', x: 0.63, y: 0.35, radius: 0.13 },
  { id: 'urgency', x: 0.26, y: 0.62, radius: 0.11 },
  { id: 'empathy', x: 0.64, y: 0.63, radius: 0.12 },
  { id: 'manipulationRisk', x: 0.47, y: 0.52, radius: 0.14 },
];

const COLOR = {
  hookStrength: '#00f5ff',
  trust: '#22c55e',
  urgency: '#eab308',
  empathy: '#a855f7',
  manipulationRisk: '#ef4444',
};

export function BrainVisualizer({ result }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const frameRef = useRef(0);
  const visibleRef = useRef(true);
  const [paused, setPaused] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState('hookStrength');
  const reducedMotion = useReducedMotion();
  const metrics = useMemo(() => getBusinessMetrics(result), [result]);
  const metricById = useMemo(() => Object.fromEntries(metrics.map((metric) => [metric.id, metric])), [metrics]);
  const regions = useMemo(() => REGION_LAYOUT.map((region) => ({ ...region, value: metricById[region.id]?.value || 0, label: metricById[region.id]?.label || region.id })), [metricById]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return undefined;
    const ctx = canvas.getContext('2d');
    let width = 0;
    let height = 0;
    let time = 0;

    function resize() {
      const rect = wrap.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 1.75);
      width = Math.max(320, Math.floor(rect.width));
      height = Math.max(260, Math.floor(rect.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      renderFrame(false);
    }

    function drawBrain(region, index) {
      const x = width * region.x;
      const y = height * region.y;
      const r = Math.min(width, height) * region.radius * zoom;
      const pulse = reducedMotion || paused ? 0 : Math.sin(time / 900 + index) * 4;
      const alpha = 0.16 + region.value / 180;
      ctx.beginPath();
      ctx.fillStyle = `${COLOR[region.id]}33`;
      ctx.strokeStyle = selected === region.id ? '#f1f1f6' : COLOR[region.id];
      ctx.lineWidth = selected === region.id ? 2.5 : 1.25;
      ctx.arc(x, y, r + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = COLOR[region.id];
      ctx.globalAlpha = alpha;
      ctx.arc(x, y, Math.max(8, r * (region.value / 140)), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function renderFrame(animated) {
      if (animated) time += 16;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#05050a';
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);

      const gradient = ctx.createRadialGradient(width * 0.48, height * 0.5, 20, width * 0.48, height * 0.5, Math.min(width, height) * 0.44);
      gradient.addColorStop(0, 'rgba(0,245,255,0.13)');
      gradient.addColorStop(1, 'rgba(168,85,247,0.04)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(width * 0.48, height * 0.5, width * 0.32, height * 0.34, -0.08, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0,245,255,0.16)';
      ctx.lineWidth = 1;
      regions.forEach((from, i) => {
        regions.slice(i + 1).forEach((to) => {
          ctx.beginPath();
          ctx.moveTo(width * from.x, height * from.y);
          ctx.quadraticCurveTo(width * 0.48, height * 0.5, width * to.x, height * to.y);
          ctx.stroke();
        });
      });
      regions.forEach(drawBrain);
      ctx.restore();
    }

    function isActive() {
      return !paused && !reducedMotion && !document.hidden && visibleRef.current;
    }

    function draw() {
      if (!isActive()) {
        renderFrame(false);
        frameRef.current = 0;
        return;
      }
      renderFrame(true);
      frameRef.current = requestAnimationFrame(draw);
    }

    function start() {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
    }

    resize();
    renderFrame(false);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(wrap);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
      if (entry.isIntersecting) start();
    }, { threshold: 0.05 });
    intersectionObserver.observe(wrap);
    document.addEventListener('visibilitychange', start);
    start();
    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', start);
      cancelAnimationFrame(frameRef.current);
    };
  }, [regions, paused, reducedMotion, selected, zoom]);

  const active = metricById[selected] || metricById.hookStrength;

  return (
    <section className="brain-visualizer" aria-labelledby="brain-visualizer-heading">
      <div className="brain-viz-header">
        <div>
          <p className="bsn-eyebrow">Neural view</p>
          <h2 id="brain-visualizer-heading">BrainSNN signal map</h2>
          <p className="bsn-note">A visual metaphor tied to displayed content signals, not a literal brain measurement.</p>
        </div>
        <div className="brain-viz-controls">
          <IconButton label={paused ? 'Resume motion' : 'Pause motion'} onClick={() => setPaused((value) => !value)}>
            {paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
          </IconButton>
          <IconButton label="Zoom in" onClick={() => setZoom((value) => Math.min(1.35, Number((value + 0.1).toFixed(2))))}>
            <ZoomIn size={17} aria-hidden="true" />
          </IconButton>
          <IconButton label="Zoom out" onClick={() => setZoom((value) => Math.max(0.8, Number((value - 0.1).toFixed(2))))}>
            <ZoomOut size={17} aria-hidden="true" />
          </IconButton>
          <IconButton label="Reset visualizer" onClick={() => { setZoom(1); setSelected('hookStrength'); }}>
            <RotateCcw size={17} aria-hidden="true" />
          </IconButton>
          <IconButton label="Fit visualizer" onClick={() => setZoom(1)}>
            <Maximize2 size={17} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <div className="brain-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} role="img" aria-label="BrainSNN signal map showing hook strength, trust, urgency, empathy and manipulation risk." />
      </div>
      <div className="brain-region-tabs" aria-label="Brain signal regions">
        {regions.map((region) => (
          <button key={region.id} type="button" className={selected === region.id ? 'active' : ''} onClick={() => setSelected(region.id)}>
            <span style={{ background: COLOR[region.id] }} aria-hidden="true" />
            {region.label} {clampScore(region.value)}
          </button>
        ))}
      </div>
      <p className="brain-summary">
        Selected region: <strong>{active.label}</strong>. {active.explanation} Current estimate: {clampScore(active.value)}.
      </p>
    </section>
  );
}
