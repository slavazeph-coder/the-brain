import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal.jsx';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';

const SITE_ITEMS = [...NAV_ITEMS, ...OVERFLOW_ITEMS];

export function CommandPalette({ open, onClose, onNavigate, items = SITE_ITEMS, placeholder = 'Go to Walk, World Builder, Review…' }) {
  const [query, setQuery] = useState('');
  const commands = useMemo(() => items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [items, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Command palette">
      <label className="command-input-label">
        Search commands
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} autoFocus />
      </label>
      <div className="command-list">
        {commands.map((item) => (
          <button key={item.id} type="button" onClick={() => { onNavigate(item.id); onClose(); }}>
            <strong>{item.label}</strong><br />
            <span className="bsn-note">{item.description}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
