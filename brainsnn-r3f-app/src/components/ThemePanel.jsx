import React, { useEffect, useState } from 'react';
import { getTheme, setTheme, DEFAULT_THEME } from '../utils/theme';

export default function ThemePanel() {
  const [state, setState] = useState(() => getTheme());

  useEffect(() => { setTheme(state); }, [state]);

  function reset() { setState({ ...DEFAULT_THEME }); }

  return (
    <section className="panel panel-pad theme-panel">
      <div className="eyebrow">Layer 98 · theme + accessibility</div>
      <h2>Look + feel preferences</h2>
      <p className="muted">
        Theme picks, high-contrast toggle, reduced-motion respect, and a font
        scale. Applied to the <code>&lt;html&gt;</code> element via data-*
        attributes + CSS custom properties — any panel can respond if it
        wants to.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
        <Tile label="Theme">
          {['auto', 'dark', 'light'].map((t) => (
            <button
              key={t}
              className={`btn-sm${state.theme === t ? ' primary' : ''}`}
              onClick={() => setState((s) => ({ ...s, theme: t }))}
            >
              {t}
            </button>
          ))}
        </Tile>

        <Tile label="High contrast">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={state.highContrast}
              onChange={(e) => setState((s) => ({ ...s, highContrast: e.target.checked }))}
            />
            <span>{state.highContrast ? 'on' : 'off'}</span>
          </label>
        </Tile>

        <Tile label="Reduce motion">
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={state.reduceMotion}
              onChange={(e) => setState((s) => ({ ...s, reduceMotion: e.target.checked }))}
            />
            <span>{state.reduceMotion ? 'force on' : 'honor OS pref'}</span>
          </label>
        </Tile>

        <Tile label="Font scale">
          {[0.9, 1, 1.15, 1.3].map((sc) => (
            <button
              key={sc}
              className={`btn-sm${state.fontScale === sc ? ' primary' : ''}`}
              onClick={() => setState((s) => ({ ...s, fontScale: sc }))}
            >
              {sc.toFixed(2)}×
            </button>
          ))}
        </Tile>
      </div>

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button className="btn" onClick={reset}>Reset to defaults</button>
      </div>

      <p className="muted small-note" style={{ marginTop: 10 }}>
        Other panels can read <code>document.documentElement.dataset.theme</code>,
        <code> dataset.highContrast</code>, and <code> dataset.reduceMotion</code>
        to adapt. Font scale lives in <code>--bsnn-font-scale</code>.
      </p>
    </section>
  );
}

function Tile({ label, children }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
      <div className="muted small-note" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}
