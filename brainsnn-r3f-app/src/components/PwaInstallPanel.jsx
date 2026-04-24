import React, { useEffect, useState } from 'react';
import { subscribeInstall, triggerInstall } from '../utils/pwa';

export default function PwaInstallPanel() {
  const [state, setState] = useState({ hasPrompt: false, isStandalone: false, hasServiceWorker: false });
  const [outcome, setOutcome] = useState(null);

  useEffect(() => subscribeInstall(setState), []);

  async function install() {
    const r = await triggerInstall();
    setOutcome(r);
  }

  return (
    <section className="panel panel-pad pwa-install-panel">
      <div className="eyebrow">Layer 91 · install</div>
      <h2>Add BrainSNN to your device</h2>
      <p className="muted">
        Installs as a standalone app on desktop (Chrome / Edge / Brave) and
        mobile. Launches without the address bar, caches the 3D shell for
        offline, and shows up in your app launcher like any native app.
        Nothing ships to our servers — install is a browser-side action.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
        <StateTile label="Service Worker" ok={state.hasServiceWorker} />
        <StateTile label="Installable" ok={state.hasPrompt} />
        <StateTile label="Standalone" ok={state.isStandalone} />
      </div>

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button
          className="btn primary"
          onClick={install}
          disabled={!state.hasPrompt || state.isStandalone}
        >
          {state.isStandalone ? 'Already installed' : state.hasPrompt ? 'Install BrainSNN' : 'Waiting for browser prompt…'}
        </button>
      </div>

      {outcome?.ok && (
        <p className="muted small-note" style={{ marginTop: 8 }}>
          Result: <strong>{outcome.outcome}</strong>
        </p>
      )}

      <p className="muted small-note" style={{ marginTop: 10 }}>
        On iOS Safari, use Share → "Add to Home Screen" (no API prompt
        available there). On Chromium browsers, the install prompt shows
        up automatically once the usage heuristics are satisfied.
      </p>
    </section>
  );
}

function StateTile({ label, ok }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        borderLeft: `3px solid ${ok ? '#5ee69a' : 'rgba(255,255,255,0.1)'}`,
        background: ok ? 'rgba(94,230,154,0.06)' : 'rgba(255,255,255,0.03)',
      }}
    >
      <div className="muted small-note">{label}</div>
      <strong style={{ color: ok ? '#5ee69a' : '#94a3b8' }}>
        {ok ? 'available' : 'not yet'}
      </strong>
    </div>
  );
}
