import React from 'react';

export const WORKSPACES = [
  { id: 'home',      label: 'Home',      chord: 'gh', glyph: '◉' },
  { id: 'analyze',   label: 'Analyze',   chord: 'ga', glyph: '◯' },
  { id: 'defend',    label: 'Defend',    chord: 'gd', glyph: '◇' },
  { id: 'brain',     label: 'Brain',     chord: 'gb', glyph: '◐' },
  { id: 'knowledge', label: 'Knowledge', chord: 'gk', glyph: '◑' },
  { id: 'training',  label: 'Training',  chord: 'gt', glyph: '◒' },
  { id: 'connect',   label: 'Connect',   chord: 'gc', glyph: '◓' }
];

export default function WorkspaceTabs({ active, onChange }) {
  return (
    <nav className="shell-tabs" aria-label="Workspaces">
      {WORKSPACES.map((w) => (
        <button
          key={w.id}
          className={`shell-tab ${active === w.id ? 'is-active' : ''}`}
          onClick={() => onChange(w.id)}
          title={`${w.label} (${w.chord})`}
          aria-current={active === w.id ? 'page' : undefined}
        >
          <span className="shell-tab-glyph" aria-hidden>{w.glyph}</span>
          <span className="shell-tab-label">{w.label}</span>
          <span className="shell-tab-chord" aria-hidden>{w.chord}</span>
        </button>
      ))}
    </nav>
  );
}
