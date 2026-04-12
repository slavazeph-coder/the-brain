import React, { useState } from 'react';
import { listPlugins, togglePlugin, runPlugins } from '../utils/pluginSystem';

export default function PluginPanel({ onApplyResults }) {
  const [plugins, setPlugins] = useState(() => listPlugins());
  const [text, setText] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => setPlugins(listPlugins());

  const handleToggle = (name, enabled) => {
    togglePlugin(name, enabled);
    refresh();
  };

  const handleRun = async () => {
    setLoading(true);
    try {
      const res = await runPlugins(text);
      setResults(res);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel panel-pad plugin-panel">
      <div className="eyebrow">Analysis Plugins</div>
      <h2>Plugin Pipeline</h2>
      <p className="muted">
        Extensible analysis modules that run alongside the Cognitive Firewall.
        Toggle plugins on/off and run the full pipeline on any content.
      </p>

      {/* Plugin registry */}
      <div className="plugin-list">
        {plugins.map((p) => (
          <div key={p.name} className="plugin-item">
            <label className="plugin-toggle">
              <input
                type="checkbox"
                checked={p.enabled}
                onChange={(e) => handleToggle(p.name, e.target.checked)}
              />
              <strong>{p.name}</strong>
              <span className="plugin-version">v{p.version}</span>
            </label>
            <p className="muted plugin-desc">{p.description}</p>
          </div>
        ))}
      </div>

      {/* Run pipeline */}
      <textarea
        className="firewall-input"
        placeholder="Paste content to run through all enabled plugins..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
      />

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={handleRun} disabled={loading || text.trim().length < 5}>
          {loading ? 'Analysing...' : `Run ${plugins.filter((p) => p.enabled).length} plugins`}
        </button>
        {results && onApplyResults && (
          <button className="btn" onClick={() => onApplyResults(results.combined)}>
            Apply combined scores
          </button>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="plugin-results">
          {results.plugins.map((r, i) => (
            <div key={i} className="plugin-result-card">
              <div className="plugin-result-header">
                <strong>{r.plugin}</strong>
                {r.label && <span className="plugin-result-label">{r.label}</span>}
              </div>
              <div className="plugin-result-scores">
                {Object.entries(r)
                  .filter(([k, v]) => typeof v === 'number' && k !== 'plugin')
                  .map(([k, v]) => (
                    <div key={k} className="plugin-score-row">
                      <span>{k}</span>
                      <div className="weight-bar">
                        <span style={{ width: `${Math.abs(v) * 100}%`, background: v >= 0 ? 'var(--primary)' : 'var(--danger)' }} />
                      </div>
                      <span className="muted">{typeof v === 'number' ? v.toFixed(3) : v}</span>
                    </div>
                  ))}
              </div>
              {r.signals && (
                <div className="firewall-chips" style={{ marginTop: 6 }}>
                  {r.signals.map((s, j) => (
                    <span key={j} className="firewall-chip">{s}</span>
                  ))}
                </div>
              )}
            </div>
          ))}

          {Object.keys(results.combined).length > 0 && (
            <div className="plugin-combined">
              <div className="eyebrow">Combined scores (averaged)</div>
              <div className="plugin-result-scores">
                {Object.entries(results.combined).map(([k, v]) => (
                  <div key={k} className="plugin-score-row">
                    <span>{k}</span>
                    <strong>{v.toFixed(3)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
