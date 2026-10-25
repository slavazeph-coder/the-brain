import React from 'react';
import { Button } from './Button.jsx';

export function EmptyState({ title, children, actionLabel, onAction }) {
  return (
    <section className="bsn-empty">
      <h2>{title}</h2>
      <p>{children}</p>
      {actionLabel ? <Button variant="primary" onClick={onAction}>{actionLabel}</Button> : null}
    </section>
  );
}
