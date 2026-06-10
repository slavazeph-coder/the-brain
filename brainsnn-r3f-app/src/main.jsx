import React from 'react';
import ReactDOM from 'react-dom/client';
// Self-hosted Inter (same weights the old Google Fonts link served) — keeps
// first paint off the fonts.googleapis.com critical path and lets the service
// worker cache the font files for offline use.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import App from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
