import React, { useEffect, useState } from 'react';
import { bus } from './bus';

const THEME_CYCLE = ['auto', 'dark', 'light'];

/**
 * Topbar — Claude.ai-style minimal header.
 * Left: wordmark + active workspace breadcrumb.
 * Right: theme toggle, ⌘K hint, keyboard help.
 */
export default function Topbar({ workspace, firewallResult, immunity, onShowHelp }) {
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'auto';
    return document.documentElement.dataset.theme || 'auto';
  });

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('brainsnn_theme', next); } catch { /* noop */ }
    setTheme(next);
    bus.emit('shell:theme', { theme: next });
  };

  const openPalette = () => bus.emit('shell:palette-open');

  // Optional ambient indicator — last firewall pressure pill.
  const pressure = firewallResult?.manipulationPressure;
  const pressureLabel = typeof pressure === 'number'
    ? `${Math.round(pressure * 100)}%`
    : null;

  return (
    <header className="shell-topbar">
      <div className="shell-topbar-left">
        <div className="shell-wordmark">BrainSNN</div>
        <span className="shell-breadcrumb-sep" aria-hidden>·</span>
        <span className="shell-breadcrumb">{workspace}</span>
      </div>

      <div className="shell-topbar-right">
        {pressureLabel && (
          <span className="shell-stat-chip" title="Latest firewall pressure">
            <span className="shell-stat-dot" /> {pressureLabel}
          </span>
        )}
        {typeof immunity === 'number' && (
          <span className="shell-stat-chip" title="Cognitive immunity">
            🛡 {Math.round(immunity)}
          </span>
        )}
        <button className="shell-icon-btn" onClick={openPalette} title="Command palette (⌘K)">
          <span className="shell-kbd">⌘K</span>
        </button>
        <button className="shell-icon-btn" onClick={cycleTheme} title={`Theme: ${theme} (click to cycle)`}>
          {theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'}
        </button>
        <button className="shell-icon-btn" onClick={onShowHelp} title="Keyboard help (?)">?</button>
      </div>
    </header>
  );
}
