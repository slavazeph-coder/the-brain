import React from 'react';

export function IconButton({ label, children, className = '', ...props }) {
  return (
    <button className={`bsn-icon-button ${className}`.trim()} type="button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
