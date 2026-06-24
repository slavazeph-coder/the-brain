import React, { useState } from 'react';
import { Info } from 'lucide-react';

export function Tooltip({ children, label = 'More information' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="bsn-tooltip">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onBlur={() => setOpen(false)}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      {open ? (
        <span className="bsn-tooltip-popover" role="tooltip">
          {children}
        </span>
      ) : null}
    </span>
  );
}
