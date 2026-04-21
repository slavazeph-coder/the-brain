import React, { useEffect, useState } from 'react';
import {
  CATEGORIES,
  getCustomRules,
  addCustomRule,
  removeCustomRule,
  clearCustomRules,
  exportCustomRules,
  importCustomRules,
  applyMergedRules,
} from '../utils/customRules';

/**
 * Layer 55 — Custom Rules Editor panel.
 */
export default function CustomRulesPanel() {
  const [rules, setRules] = useState(getCustomRules());
  const [category, setCategory] = useState('urgency');
  const [pattern, setPattern] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [importText, setImportText] = useState('');

  useEffect(() => { applyMergedRules(); }, []);

  function add() {
    setErr(''); setInfo('');
    try {
      addCustomRule({ category, pattern, label });
      setRules(getCustomRules());
      setPattern(''); setLabel('');
      setInfo(`Added ${category} rule.`);
    } catch (e) { setErr(e.message || 'add failed'); }
  }
  function remove(id) {
    removeCustomRule(id);
    setRules(getCustomRules());
  }
  function clearAll() {
    clearCustomRules();
    setRules([]);
  }
  async function copyExport() {
    const json = exportCustomRules();
    try { await navigator.clipboard.writeText(json); setInfo('Exported to clipboard.'); }
    catch { window.prompt('Copy this export:', json); }
  }
  function doImport() {
    setErr(''); setInfo('');
    try {
      const added = importCustomRules(importText);
      setRules(getCustomRules());
      setImportText('');
      setInfo(`Imported ${added.length} rules.`);
    } catch (e) { setErr(e.message || 'import failed'); }
  }

  return (
    <section className="panel panel-pad custom-rules-panel">
      <div className="eyebrow">Layer 55 · custom rules</div>
      <h2>Write your own Firewall patterns</h2>
      <p className="muted">
        User-defined regex layered on top of the defaults. Anything you add
        persists in localStorage and is picked up by every scan, the Quiz, the
        Autopsy, and the API (on this browser — the API endpoint stays on the
        server-side ruleset). Export as JSON to share or back up.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 100px', gap: 8, marginTop: 10 }}>
        <select
          className="share-input"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          className="share-input"
          placeholder="regex pattern (e.g. \\bpanic buy\\b)"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <input
          className="share-input"
          placeholder="label (optional)"
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 48))}
        />
        <button className="btn primary" onClick={add} disabled={!pattern.trim()}>
          Add
        </button>
      </div>

      {err && <p className="muted" style={{ color: '#dd6974', marginTop: 6 }}>{err}</p>}
      {info && <p className="muted" style={{ color: '#5ee69a', marginTop: 6 }}>{info}</p>}

      {rules.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="eyebrow">Active rules ({rules.length})</div>
          {rules.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.03)',
                marginTop: 6,
                fontFamily: 'monospace',
                fontSize: 13,
              }}
            >
              <span>
                <strong style={{ color: '#a86fdf' }}>{r.category}</strong>
                {' '}· /{r.pattern}/{r.flags}
                {r.label && <span className="muted small-note" style={{ marginLeft: 8 }}>— {r.label}</span>}
              </span>
              <button className="ghost small" onClick={() => remove(r.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      <div className="control-actions" style={{ marginTop: 12 }}>
        <button className="btn" onClick={copyExport} disabled={rules.length === 0}>
          Copy export
        </button>
        <button className="btn" onClick={clearAll} disabled={rules.length === 0}>
          Clear all
        </button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="eyebrow">Import</div>
        <textarea
          className="firewall-input"
          placeholder='{"brainsnn":"custom-rules-v1","rules":[...]}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={4}
          style={{ marginTop: 6 }}
        />
        <div className="control-actions" style={{ marginTop: 6 }}>
          <button className="btn" onClick={doImport} disabled={!importText.trim()}>Import</button>
        </div>
      </div>
    </section>
  );
}
