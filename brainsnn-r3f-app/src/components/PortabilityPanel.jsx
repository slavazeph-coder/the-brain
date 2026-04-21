import React, { useState } from 'react';
import {
  exportBundle, bundleStats, importBundle, wipeBundle, downloadBundle, countKeys,
} from '../utils/portability';

/**
 * Layer 57 — Data Portability panel.
 */
export default function PortabilityPanel() {
  const [importText, setImportText] = useState('');
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [keyCount, setKeyCount] = useState(() => countKeys());

  function handleDownload() {
    setErr(''); setInfo('');
    try {
      downloadBundle();
      setInfo(`Bundle downloaded (${keyCount} keys).`);
    } catch (e) { setErr(e.message || 'download failed'); }
  }

  async function copyExport() {
    setErr(''); setInfo('');
    try {
      const json = exportBundle();
      await navigator.clipboard.writeText(json);
      setInfo(`Copied ${json.length.toLocaleString()} chars to clipboard.`);
    } catch (e) {
      const json = exportBundle();
      window.prompt('Copy this bundle:', json.slice(0, 500) + '...');
      setInfo('Bundle opened in prompt (clipboard unavailable).');
    }
  }

  function doImport() {
    setErr(''); setInfo('');
    try {
      const stats = bundleStats(importText);
      if (!stats) throw new Error('not a BrainSNN bundle (version mismatch)');
      const result = importBundle(importText, { overwrite });
      setKeyCount(countKeys());
      setInfo(`Imported: ${result.added} added, ${result.replaced} replaced, ${result.skipped} skipped.`);
    } catch (e) { setErr(e.message || 'import failed'); }
  }

  function doWipe() {
    if (!window.confirm('Really wipe all BrainSNN local data? This cannot be undone.')) return;
    const removed = wipeBundle();
    setKeyCount(countKeys());
    setInfo(`Wiped ${removed} keys. Reload to see a clean state.`);
  }

  return (
    <section className="panel panel-pad portability-panel">
      <div className="eyebrow">Layer 57 · data portability</div>
      <h2>Own your state</h2>
      <p className="muted">
        Download every BrainSNN key from localStorage — immunity, streak,
        receipts, custom rules, handle, daily-challenge history. Import on
        another device to pick up where you left off. Wipe to reset.
      </p>

      <p className="muted small-note" style={{ marginTop: 6 }}>
        Keys currently stored: <strong>{keyCount}</strong>
      </p>

      <div className="control-actions" style={{ marginTop: 10 }}>
        <button className="btn primary" onClick={handleDownload}>Download JSON</button>
        <button className="btn" onClick={copyExport}>Copy to clipboard</button>
        <button className="btn" onClick={doWipe} style={{ color: '#dd6974' }}>Wipe all</button>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="eyebrow">Import bundle</div>
        <textarea
          className="firewall-input"
          placeholder='{"brainsnn":"brainsnn-bundle-v1", ...}'
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={5}
          style={{ marginTop: 6 }}
        />
        <div className="control-actions" style={{ marginTop: 6 }}>
          <button className="btn" onClick={doImport} disabled={!importText.trim()}>Import</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} className="muted small-note">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />
            Overwrite existing keys
          </label>
        </div>
      </div>

      {err && <p className="muted" style={{ color: '#dd6974', marginTop: 8 }}>{err}</p>}
      {info && <p className="muted" style={{ color: '#5ee69a', marginTop: 8 }}>{info}</p>}
    </section>
  );
}
