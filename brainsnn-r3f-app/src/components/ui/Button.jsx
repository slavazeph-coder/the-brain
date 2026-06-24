import React from 'react';

export function Button({ children, variant = 'secondary', size = 'md', className = '', ...props }) {
  const classes = ['bsn-button', `bsn-button-${variant}`, size === 'sm' ? 'bsn-button-sm' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={classes} type={props.type || 'button'} {...props}>
      {children}
    </button>
  );
}
