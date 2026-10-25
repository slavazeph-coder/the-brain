import React from 'react';
import { Button } from '../../components/ui/Button.jsx';

export function ExportCard({ icon: Icon, title, description, actionLabel, onAction, disabled }) {
  return (
    <article className={`export-action-card ${disabled ? 'disabled' : ''}`}>
      {Icon ? <Icon size={22} aria-hidden="true" /> : null}
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <Button variant={disabled ? 'ghost' : 'secondary'} size="sm" onClick={onAction} disabled={disabled}>
        {actionLabel}
      </Button>
    </article>
  );
}
