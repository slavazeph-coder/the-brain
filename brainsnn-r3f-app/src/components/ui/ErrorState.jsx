import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button.jsx';

export function ErrorState({ title = 'Scan failed', message, onRetry }) {
  return (
    <section className="bsn-error" role="alert" aria-live="assertive">
      <AlertTriangle size={30} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{message || 'BrainSNN could not finish this scan. Your input is still preserved.'}</p>
      {onRetry ? <Button variant="primary" onClick={onRetry}>Retry scan</Button> : null}
    </section>
  );
}
