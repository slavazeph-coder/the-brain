import React, { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';

export function TechnicalDetails({ result, onOpenResearch }) {
  const [open, setOpen] = useState(false);
  const metrics = result.metrics || {};
  return (
    <section className="technical-details" aria-labelledby="technical-details-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Advanced</p>
          <h2 id="technical-details-heading">Technical details</h2>
        </div>
        <div className="header-actions">
          <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>{open ? 'Hide details' : 'View details'}</Button>
          <Button variant="secondary" size="sm" onClick={onOpenResearch}>Open Research</Button>
        </div>
      </div>
      {open ? (
        <div className="technical-grid">
          <div><span>Firing rate</span><strong>{metrics.firingRate ?? 'n/a'}</strong></div>
          <div><span>Plasticity</span><strong>{metrics.plasticity ?? 'n/a'}</strong></div>
          <div><span>Wave damping</span><strong>{metrics.wavesDamping ?? result.crumbModelStats?.wavesDamping ?? 'n/a'}</strong></div>
          <div><span>Wave frequency</span><strong>{metrics.wavesFrequency ?? result.crumbModelStats?.wavesFrequency ?? 'n/a'}</strong></div>
          <div><span>Payload</span><strong>{result.payloadType || 'content_response_estimate'}</strong></div>
          <div><span>Model</span><strong>{result.crumbModelStats?.model || 'unknown'}</strong></div>
          <div><span>Confidence</span><strong>{result.confidence ?? 'n/a'}</strong></div>
          <div><span>Fallback</span><strong>{result.isFallback ? 'Yes' : 'No'}</strong></div>
        </div>
      ) : null}
    </section>
  );
}
