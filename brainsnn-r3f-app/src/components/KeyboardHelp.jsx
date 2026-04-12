import React from 'react';
import { SHORTCUT_MAP } from '../utils/shortcuts';

export default function KeyboardHelp({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="kb-overlay" onClick={onClose}>
      <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
        <div className="kb-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="kb-list">
          {SHORTCUT_MAP.map((s) => (
            <div key={s.action} className="kb-row">
              <kbd className="kb-key">{s.key === 'Space' ? '␣ Space' : s.key}</kbd>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
