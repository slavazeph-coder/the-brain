import React from 'react';

export function Badge({ children, tone = 'cyan', className = '' }) {
  return <span className={`bsn-badge bsn-badge-${tone} ${className}`.trim()}>{children}</span>;
}
