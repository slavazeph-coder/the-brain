import React, { useEffect, useState } from 'react';
import { capabilitySnapshot, hasWebGPU } from '../utils/capabilities';

/**
 * CapabilitiesPanel — surfaces what's available under the hood.
 *
 * Companion to Privacy Budget. Lets the user (and the user's IT
 * sysadmin, in enterprise) see which Beast-mode features are active
 * and which the current browser doesn't support.
 */
export default function CapabilitiesPanel() {
  const [snap, setSnap] = useState(() => capabilitySnapshot());
  const [webgpu, setWebgpu] = useState(null);

  useEffect(() => {
    hasWebGPU().then(setWebgpu);
  }, []);

  const refresh = () => setSnap(capabilitySnapshot());

  const rows = [
    { label: 'CPU cores',           value: snap.cores, kind: 'info' },
    { label: 'Web Worker',          value: snap.worker },
    { label: 'IndexedDB',           value: snap.indexedDB },
    { label: 'BroadcastChannel',    value: snap.broadcastChannel, hint: 'multi-tab brain sync' },
    { label: 'Web Locks',           value: snap.webLocks, hint: 'atomic snapshot writes' },
    { label: 'Background Sync',     value: snap.backgroundSync, hint: 'offline write queue' },
    { label: 'OffscreenCanvas',     value: snap.offscreenCanvas, hint: 'unblocks renderer (future)' },
    { label: 'File System Access',  value: snap.fileSystemAccess, hint: 'skip download dialogs' },
    { label: 'WebGPU',              value: webgpu, hint: 'experimental renderer (future)' }
  ];

  return (
    <section className="panel panel-pad capabilities-panel">
      <div className="eyebrow">Layer 103 · Capabilities</div>
      <h2>What's available under the hood</h2>
      <p className="muted">
        Beast-mode features depend on browser support. This is what your current browser
        actually offers. Refresh after switching browsers or updating to re-probe.
      </p>

      <div className="capability-list" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {rows.map((r) => (
          <div key={r.label} style={{
            display: 'grid',
            gridTemplateColumns: '180px auto 1fr',
            gap: 12,
            alignItems: 'center',
            padding: '8px 12px',
            border: 'var(--hairline)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)'
          }}>
            <span style={{ color: 'var(--text)' }}>{r.label}</span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85rem',
              color: r.kind === 'info' ? 'var(--accent)' : (r.value ? 'var(--ok)' : 'var(--muted)')
            }}>
              {r.kind === 'info' ? r.value
                : r.value === null ? '…probing'
                : r.value ? '✓ available' : '— missing'}
            </span>
            <span className="muted" style={{ fontSize: '0.82rem' }}>{r.hint || ''}</span>
          </div>
        ))}
      </div>

      <button className="btn-sm" style={{ marginTop: 12 }} onClick={refresh}>Re-probe</button>
    </section>
  );
}
