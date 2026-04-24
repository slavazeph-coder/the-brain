import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LAYER_CATALOG, LAYER_GROUPS } from '../utils/layerCatalog';

/**
 * Layer 92 — Command Palette
 *
 * ⌘K / Ctrl-K opens a centered fuzzy-search overlay. Each match is
 * a layer entry; selecting scrolls the matching panel into view (by
 * searching the DOM for a panel whose eyebrow-label contains the
 * layer id) and briefly highlights it.
 */

function fuzzyScore(needle, hay) {
  if (!needle) return 1;
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  if (h.includes(n)) return 2 + (h.startsWith(n) ? 1 : 0);
  // Subsequence match
  let i = 0;
  for (const ch of n) {
    const idx = h.indexOf(ch, i);
    if (idx < 0) return 0;
    i = idx + 1;
  }
  return 0.5;
}

function findAndFlashPanel(layerId) {
  try {
    // Every layer panel has an eyebrow "Layer N ·" at its top; find it
    const re = new RegExp(`\\blayer\\s*${layerId}\\b`, 'i');
    const labels = document.querySelectorAll('.eyebrow');
    for (const el of labels) {
      if (re.test(el.textContent || '')) {
        const panel = el.closest('.panel');
        if (!panel) continue;
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = panel.style.boxShadow;
        panel.style.transition = 'box-shadow 400ms ease';
        panel.style.boxShadow = '0 0 0 3px rgba(90,212,255,0.6)';
        setTimeout(() => { panel.style.boxShadow = prev; }, 1400);
        return true;
      }
    }
  } catch { /* noop */ }
  return false;
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  useEffect(() => { setIdx(0); }, [q, open]);

  const results = useMemo(() => {
    const scored = LAYER_CATALOG.map((l) => ({
      ...l,
      score: Math.max(
        fuzzyScore(q, l.name),
        fuzzyScore(q, l.blurb) * 0.7,
        fuzzyScore(q, `l${l.id}`) * 1.2,
        fuzzyScore(q, LAYER_GROUPS[l.group]?.label || '') * 0.5,
      ),
    }));
    return scored.filter((s) => s.score > 0.1).sort((a, b) => b.score - a.score).slice(0, 20);
  }, [q]);

  function pick(row) {
    setOpen(false);
    setQ('');
    setTimeout(() => findAndFlashPanel(row.id), 50);
  }

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 92vw)',
          background: '#0b1224',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          boxShadow: '0 40px 80px rgba(0,0,0,0.6)',
          overflow: 'hidden',
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === 'Enter' && results[idx]) pick(results[idx]);
          }}
          placeholder="Jump to a layer — try 'firewall', 'autopsy', 'recap', 'l46'…"
          style={{
            width: '100%',
            padding: '16px 18px',
            fontSize: 16,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#f1ece5',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            fontFamily: 'inherit',
          }}
        />
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {results.length === 0 ? (
            <p className="muted" style={{ padding: 16 }}>No matches. Try a layer number like <code>L46</code>.</p>
          ) : results.map((row, i) => {
            const g = LAYER_GROUPS[row.group] || { label: row.group, color: '#888' };
            const selected = i === idx;
            return (
              <div
                key={row.id}
                onMouseEnter={() => setIdx(i)}
                onClick={() => pick(row)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '50px 1fr 130px',
                  gap: 10,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: selected ? 'rgba(90,212,255,0.08)' : 'transparent',
                  borderLeft: `3px solid ${selected ? '#5ad4ff' : g.color}`,
                }}
              >
                <span className="muted" style={{ fontFamily: 'monospace', alignSelf: 'center' }}>L{row.id}</span>
                <div>
                  <strong>{row.name}</strong>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: 12 }}>{row.blurb}</p>
                </div>
                <span className="muted small-note" style={{ alignSelf: 'center', color: g.color }}>{g.label}</span>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 11 }} className="muted">
          ↑↓ navigate · ↵ select · esc close · ⌘K toggle
        </div>
      </div>
    </div>
  );
}
