import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mineClusters } from '../utils/episodicMemory';
import { categoryColor } from '../data/episodicTaxonomy';

const NODE_RADIUS = 5;
const EDGE_ALPHA = 0.32;
const HIGHLIGHT_RADIUS = 9;

/**
 * Layer 101 — Connection Graph mini-viz.
 *
 * Canvas-rendered radial cluster layout:
 *   - Each connection cluster (mineClusters) is laid out as a small
 *     wheel; clusters are spread along a sine-arc so dense weeks
 *     don't overlap.
 *   - Singletons land in a base row at the bottom.
 *   - Edges within a cluster are drawn at low alpha; the highlighted
 *     node's edges are drawn opaque.
 *
 * Pure presentational — the parent owns the captures array.
 */
export default function EpisodicGraph({ captures, height = 140, onNodeClick }) {
  const canvasRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [size, setSize] = useState({ w: 600, h: height });

  const layout = useMemo(() => buildLayout(captures || [], size.w, size.h), [captures, size.w, size.h]);

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width } = e.contentRect;
        setSize((s) => (Math.abs(s.w - width) > 1 ? { w: Math.max(120, width), h: height } : s));
      }
    });
    if (canvasRef.current?.parentElement) ro.observe(canvasRef.current.parentElement);
    return () => ro.disconnect();
  }, [height]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGraph(ctx, layout, size, hoverIdx);
  }, [layout, size, hoverIdx]);

  function handleClick() {
    if (hoverIdx < 0 || !onNodeClick) return;
    const node = layout.nodes[hoverIdx];
    if (node?.id) onNodeClick(node.id);
  }

  function handleMove(e) {
    const canvas = canvasRef.current;
    if (!canvas || !layout.nodes.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best = -1;
    let bestD = HIGHLIGHT_RADIUS * HIGHLIGHT_RADIUS;
    for (let i = 0; i < layout.nodes.length; i++) {
      const n = layout.nodes[i];
      const dx = n.x - x;
      const dy = n.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    setHoverIdx(best);
  }

  if (!captures?.length) {
    return (
      <div className="episodic-graph-host" aria-label="Empty connection graph">
        <div className="episodic-graph-empty">
          Connection graph will render once you have ≥2 captures.
        </div>
      </div>
    );
  }

  const hovered = hoverIdx >= 0 ? layout.nodes[hoverIdx] : null;

  return (
    <div className="episodic-graph-host" aria-label="Capture connection graph">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: size.h, cursor: hoverIdx >= 0 ? 'pointer' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIdx(-1)}
        onClick={handleClick}
      />
      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: clampPx(hovered.x + 10, 4, size.w - 220),
            top: clampPx(hovered.y - 30, 4, size.h - 28),
            background: 'rgba(0,0,0,0.86)',
            color: '#e6f1ff',
            border: `1px solid ${hovered.color}`,
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 11,
            pointerEvents: 'none',
            maxWidth: 220,
            lineHeight: 1.3
          }}
        >
          <div style={{ color: hovered.color, fontWeight: 600 }}>{hovered.label}</div>
          <div style={{ opacity: 0.85 }}>{hovered.title.slice(0, 60)}</div>
        </div>
      )}
    </div>
  );
}

function clampPx(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function buildLayout(captures, w, h) {
  if (!captures.length) return { nodes: [], edges: [] };

  const clusters = mineClusters(captures, { threshold: 0.40 });
  const inCluster = new Set();
  for (const cl of clusters) for (const m of cl.members) inCluster.add(m.id);
  const singletons = captures.filter((c) => !inCluster.has(c.id)).slice(0, 30);

  const nodes = [];
  const edges = [];

  const padX = 28;
  const innerW = w - padX * 2;
  const topRowY = h * 0.42;
  const baseRowY = h * 0.84;

  // Cluster wheels along the top arc
  const N = Math.max(1, clusters.length);
  for (let i = 0; i < clusters.length; i++) {
    const cl = clusters[i];
    const cx = padX + ((i + 0.5) / N) * innerW;
    const cy = topRowY;
    const r = Math.min(34, 10 + cl.members.length * 4);
    const memberCount = Math.min(cl.members.length, 12); // cap rendered members per cluster
    for (let k = 0; k < memberCount; k++) {
      const m = cl.members[k];
      const t = (k / memberCount) * Math.PI * 2;
      nodes.push({
        id: m.id,
        x: cx + Math.cos(t) * r,
        y: cy + Math.sin(t) * (r * 0.7),
        clusterIdx: i,
        title: m.title,
        label: `cluster ${i + 1} · ${cl.size} notes`,
        color: categoryColor(m.primary),
        radius: NODE_RADIUS
      });
    }
    // intra-cluster edges (chord pattern, not full mesh — keeps it readable)
    const startIdx = nodes.length - memberCount;
    for (let a = 0; a < memberCount; a++) {
      for (let b = a + 1; b < memberCount; b++) {
        if ((b - a) > 2 && (b - a) < memberCount - 2) continue; // sparse chord
        edges.push({ from: startIdx + a, to: startIdx + b, color: categoryColor(cl.members[0].primary) });
      }
    }
  }

  // Singleton row along the bottom
  const M = Math.max(1, singletons.length);
  for (let j = 0; j < singletons.length; j++) {
    const m = singletons[j];
    const cx = padX + ((j + 0.5) / M) * innerW;
    nodes.push({
      id: m.id,
      x: cx,
      y: baseRowY + (j % 2 === 0 ? 0 : 8),
      clusterIdx: -1,
      title: m.title,
      label: 'orphan',
      color: categoryColor(m.primary),
      radius: NODE_RADIUS - 1
    });
  }

  return { nodes, edges };
}

function drawGraph(ctx, { nodes, edges }, size, hoverIdx) {
  ctx.clearRect(0, 0, size.w, size.h);

  // Background subtle grid
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let x = 0; x < size.w; x += 24) ctx.fillRect(x, 0, 1, size.h);
  for (let y = 0; y < size.h; y += 24) ctx.fillRect(0, y, size.w, 1);

  // Edges
  for (const e of edges) {
    const a = nodes[e.from];
    const b = nodes[e.to];
    if (!a || !b) continue;
    const isHot = hoverIdx === e.from || hoverIdx === e.to;
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = isHot ? 0.85 : EDGE_ALPHA;
    ctx.lineWidth = isHot ? 1.8 : 1;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Nodes
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const isHot = i === hoverIdx;
    ctx.beginPath();
    ctx.fillStyle = n.color;
    ctx.arc(n.x, n.y, isHot ? n.radius + 2 : n.radius, 0, Math.PI * 2);
    ctx.fill();
    if (isHot) {
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.arc(n.x, n.y, n.radius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
