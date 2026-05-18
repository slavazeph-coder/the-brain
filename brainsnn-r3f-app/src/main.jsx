import React from 'react';
import ReactDOM from 'react-dom/client';
import NewApp from './shell/NewApp';
import './styles/tokens.css';
import './styles/global.css';
import './styles/shell.css';

// Legacy shell retired. The Claude-design AppShell (src/shell/NewApp.jsx)
// is now the only renderer. `?shell=old` is honored as a one-release
// notice that the legacy code is gone — toasts the user with a hint
// and then continues into the new shell.
if (typeof window !== 'undefined') {
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('shell') === 'old' || localStorage.getItem('brainsnn_shell_pref') === 'old') {
      console.info('[brainsnn] legacy shell has been removed; rendering the new AppShell.');
      // Clear the stale preference so subsequent loads don't keep nagging.
      try { localStorage.removeItem('brainsnn_shell_pref'); } catch { /* noop */ }
    }
  } catch { /* noop */ }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <NewApp />
  </React.StrictMode>
);
