import React from 'react';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';

export function CommandPalette({ open, onClose, onNavigate }) {
  if (!open) return null;
  const items = [...NAV_ITEMS, ...OVERFLOW_ITEMS];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(6, 6, 10, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(480px, 92vw)',
          background: '#0f1422',
          border: '1px solid rgba(0, 245, 255, 0.28)',
          borderRadius: '0.85rem',
          padding: '1.25rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
          <strong>Jump to section</strong>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'transparent', border: 0, color: '#94a3b8', cursor: 'pointer' }}
          >
            Esc
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onClose?.();
                onNavigate?.(item.id);
              }}
              style={{
                textAlign: 'left',
                padding: '0.6rem 0.8rem',
                borderRadius: '0.5rem',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#f1f5f9',
                cursor: 'pointer',
              }}
            >
              {item.label} <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{item.href}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
