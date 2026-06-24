import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../components/ui/Modal.jsx';
import { NAV_ITEMS } from './navigation.js';

export function CommandPalette({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const commands = useMemo(() => NAV_ITEMS.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="Command palette">
      <label className="command-input-label">
        Search commands
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Go to Cortex, Synapse, Memory..." autoFocus />
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
