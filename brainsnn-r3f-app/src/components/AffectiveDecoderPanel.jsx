import React, { useMemo, useState } from 'react';
import {
  decodeAffects,
  buildAffectOverride,
  QUADRANT_INFO
} from '../utils/affectiveDecoder';
import { AFFECT_CLUSTERS } from '../data/affectLexicon';

const REGION_ORDER = ['CTX', 'HPC', 'THL', 'AMY', 'BG', 'PFC', 'CBL'];

const EXAMPLE_TEXTS = {
  fear: `BREAKING: The collapse is imminent. Danger is everywhere — your family is at risk. They warned us this day would come. Panic in the streets. We are under attack. If you don't act now, everything you love will be destroyed.`,
  belonging: `Together as a community, we celebrate our shared journey. We are family. We hold each other up through the hardest days. Our tribe, our home, our neighbors — this is where we belong. We remember where we came from, and we know we're never alone.`,
  mixed: `I remember when my grandmother taught me to bake. The kitchen smelled of cinnamon and those afternoons are some of my warmest memories. But I should have visited her more. I was too busy, too distracted — I let her down. I'm ashamed of the person I was then. Still, every time I roll out dough, she's with me.`
};

/**
 * Layer 29 — Affective Trigger Decoder Panel
 *
 * Paste content → decode into 12 affects → plot on Russell's circumplex →
 * map to brain regions with per-affect colors. The headline feature is the
 * region glow override: AMY glows red for fear vs. soft pink for belonging —
 * same neural button, different finger.
 */
export default function AffectiveDecoderPanel({ onApplyToBrain, onApplyActivation }) {
  const [text, setText] = useState(EXAMPLE_TEXTS.mixed);
  const [decoded, setDecoded] = useState(null);
  const [applied, setApplied] = useState(false);

  const canDecode = text.trim().length >= 5;

  function handleDecode() {
    const result = decodeAffects(text);
    setDecoded(result);
    setApplied(false);
  }

  function handleApplyColors() {
    if (!decoded) return;
    const map = buildAffectOverride(decoded);
    onApplyToBrain?.(map);
    setApplied(true);
  }

  function handleApplyActivation() {
    if (!decoded) return;
    onApplyActivation?.(decoded);
  }

  function handleClearColors() {
    onApplyToBrain?.(null);
    setApplied(false);
  }

  return (
    <section className="panel panel-pad affect-panel">
      <div className="eyebrow">Layer 29</div>
      <h2>Affective Trigger Decoder</h2>
      <p className="muted">
        Layer 4 tells you content is manipulative. Layer 29 tells you{' '}
        <em>which feeling</em> is being installed. 12 affects across 4 clusters,
        plotted on Russell's circumplex (valence × arousal). Applied to the
        brain, each region glows in the color of the affect firing it — so AMY
        glows red for fear, pink for belonging. <strong>Same neural button,
        different finger.</strong>
      </p>

      <div className="affect-examples">
        <span className="muted small-note">Try an example:</span>
        <button className="ghost small" onClick={() => setText(EXAMPLE_TEXTS.fear)}>
          Fear-coded
        </button>
        <button className="ghost small" onClick={() => setText(EXAMPLE_TEXTS.belonging)}>
          Belonging-coded
        </button>
        <button className="ghost small" onClick={() => setText(EXAMPLE_TEXTS.mixed)}>
          Mixed (nostalgia + shame)
        </button>
      </div>

      <textarea
        className="affect-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="Paste content to decode the affect fingerprint…"
      />

      <div className="affect-actions">
        <button className="primary" onClick={handleDecode} disabled={!canDecode}>
          Decode affects
        </button>
        {decoded && !decoded.empty && (
          <>
            <button className="primary small" onClick={handleApplyColors}>
              {applied ? 'Re-apply colors' : 'Apply affect colors to brain'}
            </button>
            <button className="ghost small" onClick={handleApplyActivation}>
              Nudge activation
            </button>
            {applied && (
              <button className="ghost small" onClick={handleClearColors}>
                Clear colors
              </button>
            )}
          </>
        )}
      </div>

      {decoded && decoded.empty && (
        <p className="muted small-note">
          No affects detected above threshold. Try longer or more emotionally
          loaded text.
        </p>
      )}

      {decoded && !decoded.empty && (
        <>
          <ClusterStrip totals={decoded.clusterTotals} />

          <div className="affect-twocol">
            <Circumplex decoded={decoded} />
            <DominantList dominant={decoded.dominant} />
          </div>

          <RegionHeatmap decoded={decoded} />

          {decoded.crossCategoryInsight.length > 0 && (
            <div className="affect-insight">
              <strong>Cross-category convergence</strong>
              {decoded.crossCategoryInsight.map((ins) => (
                <p key={ins.region}>{ins.message}</p>
              ))}
            </div>
          )}

          <p className="muted small-note">
            Decoded from {decoded.wordCount} words · {decoded.dominant.length}{' '}
            dominant affect{decoded.dominant.length === 1 ? '' : 's'} · quadrant:{' '}
            <strong style={{ color: QUADRANT_INFO[decoded.quadrant].color }}>
              {QUADRANT_INFO[decoded.quadrant].label}
            </strong>
          </p>
        </>
      )}
    </section>
  );
}

function ClusterStrip({ totals }) {
  return (
    <div className="affect-clusters">
      {Object.entries(AFFECT_CLUSTERS).map(([key, meta]) => {
        const pct = Math.round((totals[key] ?? 0) * 100);
        return (
          <div key={key} className="affect-cluster-card" style={{ borderColor: meta.color }}>
            <div className="affect-cluster-head">
              <span className="affect-cluster-dot" style={{ background: meta.color }} />
              <span>{meta.label}</span>
              <span className="muted small-note">{pct}%</span>
            </div>
            <div className="affect-cluster-bar">
              <div
                className="affect-cluster-fill"
                style={{ width: `${pct}%`, background: meta.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Circumplex({ decoded }) {
  const size = 220;
  const half = size / 2;
  // Map valence (-1..1) to x, arousal (0..1) to y-flipped.
  const x = half + decoded.valence * (half - 16);
  const y = size - (16 + decoded.arousal * (size - 32));
  const dotColor = decoded.dominant[0]?.color ?? '#8a8f99';

  return (
    <div className="affect-circumplex">
      <svg viewBox={`0 0 ${size} ${size}`} width="100%" role="img" aria-label="Russell's circumplex">
        <defs>
          <radialGradient id="affectDotGlow">
            <stop offset="0%" stopColor={dotColor} stopOpacity="1" />
            <stop offset="100%" stopColor={dotColor} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={half} cy={half} r={half - 6} fill="#0b0b0d" stroke="#222" strokeWidth="1" />
        <circle cx={half} cy={half} r={(half - 6) * 0.66} fill="none" stroke="#1c1c22" strokeWidth="1" />
        <circle cx={half} cy={half} r={(half - 6) * 0.33} fill="none" stroke="#1c1c22" strokeWidth="1" />
        <line x1={half} y1={6} x2={half} y2={size - 6} stroke="#2a2a30" strokeWidth="1" />
        <line x1={6} y1={half} x2={size - 6} y2={half} stroke="#2a2a30" strokeWidth="1" />

        <text x={size - 10} y={half - 6} fill="#777" fontSize="10" textAnchor="end">+ valence</text>
        <text x={10} y={half - 6} fill="#777" fontSize="10">− valence</text>
        <text x={half + 4} y={14} fill="#777" fontSize="10">↑ arousal</text>
        <text x={half + 4} y={size - 4} fill="#777" fontSize="10">calm</text>

        <text x={14} y={22} fill="#ff4066" fontSize="11" fontWeight="600">tense</text>
        <text x={size - 14} y={22} fill="#ffd54a" fontSize="11" fontWeight="600" textAnchor="end">excited</text>
        <text x={14} y={size - 12} fill="#6a4a80" fontSize="11" fontWeight="600">depressed</text>
        <text x={size - 14} y={size - 12} fill="#7dd87f" fontSize="11" fontWeight="600" textAnchor="end">calm</text>

        <circle cx={x} cy={y} r="18" fill="url(#affectDotGlow)" opacity="0.6" />
        <circle cx={x} cy={y} r="7" fill={dotColor} stroke="#fff" strokeWidth="1.5" />
      </svg>
      <div className="affect-circumplex-caption muted small-note">
        v={decoded.valence.toFixed(2)} · a={decoded.arousal.toFixed(2)}
      </div>
    </div>
  );
}

function DominantList({ dominant }) {
  return (
    <div className="affect-dominant">
      <strong className="muted small-note" style={{ display: 'block', marginBottom: 6 }}>
        Dominant affects
      </strong>
      {dominant.map((a) => (
        <div key={a.id} className="affect-chip">
          <span className="affect-chip-swatch" style={{ background: a.color }} />
          <div className="affect-chip-body">
            <div className="affect-chip-head">
              <strong>{a.label}</strong>
              <span className="muted small-note">{Math.round(a.score * 100)}%</span>
            </div>
            <div className="affect-chip-meta muted small-note">
              {AFFECT_CLUSTERS[a.cluster].label.toLowerCase()} · {a.nt}
            </div>
            {a.examples.length > 0 && (
              <div className="affect-chip-examples muted small-note">
                {a.examples.map((e, i) => (
                  <span key={i} className="affect-chip-example">"{e}"</span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RegionHeatmap({ decoded }) {
  const cells = useMemo(() => {
    return REGION_ORDER.map((region) => {
      const dom = decoded.regionDominant[region];
      const heat = decoded.regionHeatmap[region] ?? 0;
      return {
        region,
        color: dom?.color ?? '#2a2a30',
        strength: Math.abs(heat),
        signed: heat,
        affect: dom?.id ?? null
      };
    });
  }, [decoded]);

  return (
    <div className="affect-region-block">
      <strong className="muted small-note" style={{ display: 'block', marginBottom: 6 }}>
        Region color map — same neural hardware, affect-tinted
      </strong>
      <div className="affect-region-grid">
        {cells.map((c) => {
          const opacity = Math.min(0.95, 0.15 + c.strength * 1.2);
          return (
            <div
              key={c.region}
              className="affect-region-cell"
              style={{
                background: `linear-gradient(135deg, ${c.color}${toHex(opacity)}, #121215)`,
                borderColor: c.color,
                opacity: c.strength > 0 ? 1 : 0.45
              }}
            >
              <div className="affect-region-label">{c.region}</div>
              <div className="affect-region-affect muted small-note">
                {c.affect ?? '—'}
              </div>
              <div className="affect-region-strength muted small-note">
                {c.signed >= 0 ? '+' : ''}
                {(c.signed * 100).toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toHex(opacity) {
  const v = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  const h = v.toString(16).padStart(2, '0');
  return h;
}
