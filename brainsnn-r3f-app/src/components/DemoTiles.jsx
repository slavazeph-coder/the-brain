import React from 'react';
import { scoreContent } from '../utils/cognitiveFirewall';

/**
 * Six pre-seeded "wow moment" starting points. First-time visitors
 * should never see a blank textarea — they should be one click from a
 * visible brain reaction.
 *
 * Each tile scores locally (no network) and applies the result to
 * the brain so the 3D scene lights up immediately.
 */
const TILES = [
  {
    id: 'outrage',
    label: 'Outrage headline',
    emoji: '🔥',
    hint: 'watch AMY spike',
    text:
      "BREAKING: Shocking betrayal! Everyone is furious. This is the most disgusting scandal they covered up — and you won't believe what they did next.",
  },
  {
    id: 'fear',
    label: 'Fear cascade',
    emoji: '⚠️',
    hint: 'AMY + THL surge',
    text:
      "WARNING: a deadly new virus is spreading fast. Experts say collapse is imminent. If you don't act now, it may already be too late to protect your family.",
  },
  {
    id: 'urgency-ad',
    label: 'Urgency ad copy',
    emoji: '⏳',
    hint: 'PFC dampens',
    text:
      "ACT FAST — last chance! This limited-time offer ends in minutes. Don't miss it. Guaranteed results. 100% proven. Everyone is switching — clearly you should too.",
  },
  {
    id: 'phishing',
    label: 'AI phishing email',
    emoji: '🎣',
    hint: 'manipulation pressure',
    text:
      "URGENT: unauthorized login detected on your account. Immediate action required. Click here now to verify your identity or your account will be terminated within the hour.",
  },
  {
    id: 'meditation',
    label: 'Meditation prompt',
    emoji: '🌿',
    hint: 'quiet baseline',
    text:
      "Take a slow breath. Notice the weight of your body. There is nothing you have to do right now — just this breath, and the next one, arriving gently.",
  },
  {
    id: 'political-ad',
    label: 'Political attack ad',
    emoji: '🗳️',
    hint: 'outrage + certainty',
    text:
      "Obviously they betrayed us. Everyone knows the truth. It is an undeniable fact — a scandal they don't want you to see. We must act immediately before it's too late.",
  },
];

export default function DemoTiles({ onPlay }) {
  return (
    <section className="demo-tiles panel panel-pad">
      <div className="eyebrow">Try it now</div>
      <h3 style={{ margin: '6px 0 4px' }}>Paste any tweet — or tap a preset</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        One click feeds the Cognitive Firewall and lights up the 3D brain.
      </p>
      <div
        className="demo-tile-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
          marginTop: 12,
        }}
      >
        {TILES.map((tile) => (
          <button
            key={tile.id}
            className="demo-tile btn"
            onClick={() => {
              const result = scoreContent(tile.text);
              onPlay?.({ text: tile.text, result });
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              padding: '12px 14px',
              textAlign: 'left',
              whiteSpace: 'normal',
              lineHeight: 1.3,
            }}
          >
            <span style={{ fontSize: 22 }}>{tile.emoji}</span>
            <strong>{tile.label}</strong>
            <span className="muted" style={{ fontSize: 12 }}>{tile.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export { TILES as DEMO_TILES };
