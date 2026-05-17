import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import NewApp from './shell/NewApp';
import './styles/tokens.css';
import './styles/global.css';
import './styles/shell.css';

// Default shell flipped to the Claude-design AppShell. Legacy shell
// kept reachable via ?shell=old for one release as an escape hatch
// while users adjust; will be removed in a follow-up PR.
function pickShell() {
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('shell') === 'old') return 'old';
    if (url.get('shell') === 'new') return 'new';
    if (localStorage.getItem('brainsnn_shell_pref') === 'old') return 'old';
  } catch { /* noop */ }
  return 'new';
}

const ShellRoot = pickShell() === 'old' ? App : NewApp;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ShellRoot />
  </React.StrictMode>
);
