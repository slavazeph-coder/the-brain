import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/global.css';
import './styles/shell.css';

// Default shell flipped to the Claude-design AppShell. Legacy shell
// kept reachable via ?shell=old for one release as an escape hatch.
// Both are dynamic-import boundaries so the unused one never lands in
// the initial payload — `ws-legacy-app` is its own chunk that only
// fetches when ?shell=old or the localStorage pref is set.
function pickShell() {
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('shell') === 'old') return 'old';
    if (url.get('shell') === 'new') return 'new';
    if (localStorage.getItem('brainsnn_shell_pref') === 'old') return 'old';
  } catch { /* noop */ }
  return 'new';
}

const LegacyApp = lazy(() => import('./App'));
const NewApp = lazy(() => import('./shell/NewApp'));
const ShellRoot = pickShell() === 'old' ? LegacyApp : NewApp;

function Fallback() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      color: 'var(--muted)',
      fontFamily: 'var(--font-body)',
      fontSize: '0.9rem'
    }}>Loading the brain…</div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Suspense fallback={<Fallback />}>
      <ShellRoot />
    </Suspense>
  </React.StrictMode>
);
