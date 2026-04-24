import React, { useEffect, useState } from 'react';
import { listHotkeys, layerForHotkey, flashLayerInDom } from '../utils/hotkeys';

/**
 * Layer 97 — Hotkey Map
 *
 * Shift-? opens a fullscreen hotkey cheat-sheet. Typing two letters
 * (while not in a form field) jumps to the mapped panel.
 */
export default function HotkeyMap() {
  const [open, setOpen] = useState(false);
  const [buf, setBuf] = useState('');

  useEffect(() => {
    function onKey(e) {
      if (e.key === '?' && e.shiftKey) { e.preventDefault(); setOpen((v) => !v); return; }
      if (e.key === 'Escape') { setOpen(false); setBuf(''); return; }
      // Don't swallow keys inside form inputs
      const t = e.target;
      const inInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (inInput) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!/^[a-zA-Z]$/.test(e.key)) return;
      setBuf((prev) => {
        const next = (prev + e.key.toLowerCase()).slice(-2);
        if (next.length === 2) {
          const layer = layerForHotkey(next);
          if (layer != null) { flashLayerInDom(layer); setTimeout(() => setBuf(''), 400); return ''; }
        }
        return next;
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const rows = listHotkeys();

  if (!open) return buf ? (
    <div style={{
      position: 'fixed', bottom: 20, right: 20,
      padding: '10px 14px', borderRadius: 8,
      background: 'rgba(0,0,0,0.72)', color: '#e6f1ff',
      fontFamily: 'monospace', fontSize: 16, letterSpacing: 4,
      zIndex: 9990, boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
    }}>
      ▶ {buf}<span style={{ opacity: 0.4 }}>_</span>
    </div>
  ) : null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
        zIndex: 9995, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(760px, 94vw)', maxHeight: '80vh', overflowY: 'auto',
          background: '#0b1224', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: 20, boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Hotkey Map · Layer 97</h2>
          <span className="muted small-note">Shift-? to toggle · esc to close</span>
        </div>
        <p className="muted small-note" style={{ marginTop: 0 }}>
          Type two letters anywhere (not in a form field) to jump to that panel.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
          {rows.map(({ key, layer }) => (
            <div
              key={key}
              style={{
                display: 'grid', gridTemplateColumns: '48px 50px 1fr',
                gap: 8, alignItems: 'center',
                padding: '6px 10px', borderRadius: 6,
                background: 'rgba(255,255,255,0.04)',
                fontSize: 13,
              }}
            >
              <kbd style={{
                fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
                padding: '2px 6px', borderRadius: 4,
                background: '#1a1f2e', color: '#5ad4ff',
              }}>{key}</kbd>
              <span className="muted" style={{ fontFamily: 'monospace' }}>L{layer.id}</span>
              <span>{layer.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
