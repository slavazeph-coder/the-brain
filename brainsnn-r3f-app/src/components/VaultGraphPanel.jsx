import React, { useEffect, useMemo, useState } from 'react';
import { sharedVault, subscribeVaultChanges } from '../utils/vault';
import { buildLinkGraph, layoutGraph } from '../utils/vaultGraph';

/**
 * Layer 110 — Vault Graph view.
 *
 * Force-directed 2D SVG of the link graph built from L109. Lightweight
 * by design — no R3F, no canvas, no external deps. R3F-flavored 3D
 * graphs are L37 Cognitive Fragments; this panel is the
 * sidebar-friendly Obsidian-style 2D graph.
 *
 * Reads the same vault store as L109, so when the user creates/edits a
 * note in VaultPanel, this graph picks it up on the next refresh.
 */

const VAULT = sharedVault;

const W = 480;
const H = 320;

export default function VaultGraphPanel() {
  const [tick, setTick] = useState(0);
  const [highlight, setHighlight] = useState(null);
  const [iterations, setIterations] = useState(200);

  const notes = useMemo(() => {
    void tick;
    return VAULT.list().map((entry) => VAULT.get(entry.id)).filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const laid = useMemo(() => {
    const g = buildLinkGraph(notes);
    return layoutGraph(g, { iterations });
  }, [notes, iterations]);

  useEffect(() => subscribeVaultChanges(() => setTick((t) => t + 1)), []);

  const maxOut = Math.max(1, ...laid.nodes.map((n) => n.out));
  const maxIn = Math.max(1, ...laid.nodes.map((n) => n.in));

  function r(node) {
    const d = (node.out / maxOut) + (node.in / maxIn);
    return 3 + d * 4;
  }

  function color(node) {
    if (highlight === node.id) return '#fdab43';
    if (node.in === 0 && node.out === 0) return '#475569';
    return '#5ad4ff';
  }

  return (
    <section className="panel panel-pad vault-graph-panel">
      <div className="eyebrow">Layer 110 · vault graph</div>
      <h2>Link graph — {laid.nodes.length} notes, {laid.edges.length} links</h2>
      <p className="muted">
        Force-directed view of the L109 vault. Node size = in-degree +
        out-degree. Click a node to highlight; reload to re-randomize the
        seed positions.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setTick((t) => t + 1)}>Refresh</button>
        <span className="muted small-note">layout iterations</span>
        <input
          type="range"
          min="50"
          max="600"
          step="50"
          value={iterations}
          onChange={(e) => setIterations(parseInt(e.target.value, 10))}
        />
        <span className="muted small-note" style={{ fontFamily: 'monospace' }}>{iterations}</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth: W, marginTop: 10, background: 'rgba(255,255,255,0.025)', borderRadius: 6 }}
        role="img"
        aria-label="Vault link graph"
      >
        {/* edges */}
        {laid.edges.map((e, i) => {
          const a = laid.layout[e.from];
          const b = laid.layout[e.to];
          if (!a || !b) return null;
          const isHi = highlight && (e.from === highlight || e.to === highlight);
          return (
            <line
              key={`${e.from}-${e.to}-${i}`}
              x1={a.x * W}
              y1={a.y * H}
              x2={b.x * W}
              y2={b.y * H}
              stroke={isHi ? '#fdab43' : 'rgba(203,213,225,0.18)'}
              strokeWidth={isHi ? 1.4 : 0.8}
            />
          );
        })}

        {/* nodes */}
        {laid.nodes.map((n) => {
          const p = laid.layout[n.id];
          if (!p) return null;
          return (
            <g
              key={n.id}
              transform={`translate(${(p.x * W).toFixed(2)} ${(p.y * H).toFixed(2)})`}
              style={{ cursor: 'pointer' }}
              onClick={() => setHighlight(n.id === highlight ? null : n.id)}
            >
              <circle r={r(n)} fill={color(n)} stroke="#0f172a" strokeWidth={0.5} />
              {(highlight === n.id || laid.nodes.length <= 30) && (
                <text
                  x={0}
                  y={r(n) + 9}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#cbd5e1"
                  style={{ pointerEvents: 'none' }}
                >
                  {n.title}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {highlight && (() => {
        const n = laid.nodes.find((x) => x.id === highlight);
        if (!n) return null;
        return (
          <div
            style={{
              padding: 8,
              background: 'rgba(255,255,255,0.025)',
              borderRadius: 6,
              marginTop: 8,
              fontSize: 12,
            }}
          >
            <strong style={{ color: '#fdab43' }}>{n.title}</strong>
            <span className="muted small-note" style={{ marginLeft: 8 }}>
              in: {n.in} · out: {n.out}{n.tags.length ? ` · #${n.tags.join(' #')}` : ''}
            </span>
          </div>
        );
      })()}

      {laid.nodes.length === 0 && (
        <div className="muted small-note" style={{ marginTop: 10 }}>
          Empty vault. Create notes in <strong>Layer 109 · Vault</strong> first.
        </div>
      )}
    </section>
  );
}
