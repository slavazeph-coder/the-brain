import React, { useState } from 'react';
import { exportBundle, importBundle } from '../utils/portability';

function generateCode() {
  // 6-char uppercase code, easy to read out loud
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function SyncPanel() {
  const [mode, setMode] = useState('send');
  const [code, setCode] = useState(generateCode());
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  async function send() {
    setErr(''); setStatus('uploading…');
    try {
      const bundle = exportBundle();
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, bundle }),
      });
      const data = await r.json();
      if (!r.ok) { setErr(data.error || `HTTP ${r.status}`); setStatus(''); return; }
      setStatus(`Uploaded · ${data.bytes.toLocaleString()} bytes · expires in ${Math.round(data.ttlSec / 60)} min`);
    } catch (e) { setErr(e.message || 'upload failed'); setStatus(''); }
  }

  async function receive() {
    setErr(''); setStatus('fetching…');
    try {
      const r = await fetch(`/api/sync/${encodeURIComponent(code)}`);
      const data = await r.json();
      if (!r.ok) { setErr(data.error || `HTTP ${r.status}`); setStatus(''); return; }
      const result = importBundle(data.bundle, { overwrite });
      setStatus(`Imported · ${result.added} added · ${result.replaced} replaced · ${result.skipped} skipped`);
    } catch (e) { setErr(e.message || 'fetch failed'); setStatus(''); }
  }

  return (
    <section className="panel panel-pad sync-panel">
      <div className="eyebrow">Layer 96 · cross-device sync</div>
      <h2>Copy state between devices in 10 seconds</h2>
      <p className="muted">
        On the source device, pick <em>Send</em>, generate a 6-char code,
        and upload. On the target device, pick <em>Receive</em>, type the
        same code, import. Bundle lives on the server for 10 minutes then
        auto-expires. Payload is your Layer 57 export — we don't read it.
      </p>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className={`btn${mode === 'send' ? ' primary' : ''}`} onClick={() => setMode('send')}>Send</button>
        <button className={`btn${mode === 'receive' ? ' primary' : ''}`} onClick={() => setMode('receive')}>Receive</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <input
          className="share-input"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
          style={{ fontFamily: 'monospace', fontSize: 20, letterSpacing: 3, textAlign: 'center', maxWidth: 260 }}
          placeholder="6-CHAR CODE"
        />
        {mode === 'send' && <button className="btn" onClick={() => setCode(generateCode())}>New code</button>}
        {mode === 'send' ? (
          <button className="btn primary" onClick={send} disabled={code.length < 4}>Upload bundle</button>
        ) : (
          <button className="btn primary" onClick={receive} disabled={code.length < 4}>Fetch & import</button>
        )}
      </div>

      {mode === 'receive' && (
        <label className="muted small-note" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
          Overwrite existing keys on this device
        </label>
      )}

      {status && <p className="muted small-note" style={{ marginTop: 6 }}>{status}</p>}
      {err && <p className="muted" style={{ color: '#dd6974' }}>{err}</p>}
    </section>
  );
}
