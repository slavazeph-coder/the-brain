import React from 'react';

export function Card({ as: Component = 'section', children, className = '', ...props }) {
  return <Component className={className} {...props}>{children}</Component>;
}
