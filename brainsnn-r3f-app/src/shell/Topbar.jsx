import React, { useEffect, useState } from 'react';
import { bus } from './bus';
import { getTheme, setTheme } from '../utils/theme';

const THEME_CYCLE = ['auto', 'dark', 'light'];

/**
 * Topbar — Claude.ai-style minimal header.
 * Left: wordmark + active workspace breadcrumb.
 * Right: theme toggle, ⌘K hint, keyboard help.
 */
function TopbarImpl({ workspace, firewallResult, immunity, onShowHelp }) {
  // Mirror the canonical theme state (theme.js owns persistence under
  // brainsnn_theme_v1 + applies CSS vars + broadcasts cross-tab).
  // Subscribing to BroadcastChannel via theme.js's registerTheme()
  // handler isn't necessary here — we just re-read on mount and on
  // every cycle. Cross-tab updates land via dataset mutations which
  // we observe via getTheme() lazily.
  const [theme, setLocalTheme] = useState(() => getTheme().theme);

  // Re-read in case another tab flipped the theme since mount.
  useEffect(() => {
    const handler = () => setLocalTheme(getTheme().theme);
    window.addEventListener('focus', handler);
    return () => window.removeEventListener('focus', handler);
  }, []);

  const cycleTheme = () => {
    const next = THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % THEME_CYCLE.length];
    const current = getTheme();
    setTheme({ ...current, theme: next });  // applies CSS + broadcasts cross-tab
    setLocalTheme(next);
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

// Topbar's props change only when the user runs a scan (firewallResult),
// switches workspace (label), or earns immunity — not every simulation
// tick. React.memo gates out the cascade. onShowHelp is the only
// inline lambda; if it gets de-stabilized later, memoize at the caller.
export default React.memo(TopbarImpl);
