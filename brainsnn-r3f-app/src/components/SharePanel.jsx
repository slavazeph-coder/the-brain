import React, { useState } from 'react';

function encodeState(state) {
  try {
    const compact = {
      r: state.regions,
      w: state.weights,
      s: state.scenario,
      t: state.tick,
      sel: state.selected
    };
    return btoa(JSON.stringify(compact));
  } catch {
    return '';
  }
}

export function decodeStateFromHash() {
  try {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith('state=')) return null;
    const json = atob(hash.slice(6));
    const { r, w, s, t, sel } = JSON.parse(json);
    return { regions: r, weights: w, scenario: s, tick: t, selected: sel };
  } catch {
    return null;
  }
}

export default function SharePanel({ state }) {
  const [copied, setCopied] = useState('');

  const stateHash = `state=${encodeState(state)}`;
  const shareUrl = `${window.location.origin}${window.location.pathname}#${stateHash}`;

  const embedCode = `<iframe src="${shareUrl}" width="1200" height="800" frameborder="0" allow="web-share; bluetooth; serial" title="BrainSNN Viewer"></iframe>`;

  const handleCopy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  return (
    <section className="panel panel-pad share-panel">
      <div className="eyebrow">Share & Embed</div>
      <h2>Share This Brain State</h2>
      <p className="muted">
        Share a link that reconstructs the current brain state, or embed the viewer in any page.
      </p>

      <div className="share-row">
        <label className="share-label">Shareable URL</label>
        <div className="share-input-row">
          <input className="share-input" readOnly value={shareUrl} onClick={(e) => e.target.select()} />
          <button className="btn-sm" onClick={() => handleCopy(shareUrl, 'url')}>
            {copied === 'url' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="share-row">
        <label className="share-label">Embed code</label>
        <div className="share-input-row">
          <input className="share-input mono" readOnly value={embedCode} onClick={(e) => e.target.select()} />
          <button className="btn-sm" onClick={() => handleCopy(embedCode, 'embed')}>
            {copied === 'embed' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="share-row">
        <label className="share-label">Export as JSON</label>
        <button className="btn" onClick={() => {
          const json = JSON.stringify({ regions: state.regions, weights: state.weights, scenario: state.scenario, tick: state.tick }, null, 2);
          const blob = new Blob([json], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `brainsnn-state-${Date.now()}.json`;
          a.click();
          URL.revokeObjectURL(url);
        }}>
          Download state JSON
        </button>
      </div>
    </section>
  );
}
