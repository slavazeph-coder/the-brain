import React from 'react';

export function Skeleton({ height = 16, className = '' }) {
  return <span className={`bsn-skeleton ${className}`.trim()} style={{ minHeight: height }} aria-hidden="true" />;
}
