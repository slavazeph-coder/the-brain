import React from 'react';
import { Zap } from 'lucide-react';
import { CLASSIC_PRESETS } from '../../lib/classicPresets.js';

const LEVEL_TONES = {
  low: 'level-low',
  high: 'level-high',
  extreme: 'level-extreme',
};

export function ClassicsGallery({ onSelect, compact = false }) {
  const presets = compact ? CLASSIC_PRESETS.slice(0, 6) : CLASSIC_PRESETS;
  return (
    <div className={`classics-gallery ${compact ? 'compact' : ''}`} data-testid="classics-gallery">
      {presets.map((preset) => (
        <article key={preset.id} className="classics-card">
          <span className="classics-archetype">{preset.archetype}</span>
          <h3>{preset.label}</h3>
          {!compact ? <p className="classics-excerpt">“{preset.content}”</p> : null}
          <span className={`classics-teaser ${LEVEL_TONES[preset.teaser.level] || ''}`}>
            {preset.teaser.label}: {preset.teaser.level} — {preset.teaser.line}
          </span>
          <button type="button" className="classics-scan" onClick={() => onSelect(preset.content, preset)}>
            <Zap size={14} aria-hidden="true" /> Scan this
          </button>
        </article>
      ))}
    </div>
  );
}
