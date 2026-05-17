import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import NewApp from './shell/NewApp';
import './styles/tokens.css';
import './styles/global.css';
import './styles/shell.css';

// Feature flag — ?shell=new switches to the Claude-design AppShell.
// Both shells share the same providers, panels, and persistence; only
// one mounts at a time to avoid double-registering the MCP bridge and
// dream monitor.
function pickShell() {
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.get('shell') === 'new') return 'new';
    if (url.get('shell') === 'old') return 'old';
    if (localStorage.getItem('brainsnn_shell_pref') === 'new') return 'new';
  } catch { /* noop */ }
  return 'old';
}

const ShellRoot = pickShell() === 'new' ? NewApp : App;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ShellRoot />
  </React.StrictMode>
);
