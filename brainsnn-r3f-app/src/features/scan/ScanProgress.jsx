import React, { useEffect, useState } from 'react';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';

const steps = [
  'Ingesting creative',
  'Extracting local signals',
  'Fusing temporal model',
  'Running BrainSNN',
  'Building decision readout',
];

const streams = ['LANGUAGE', 'ATTENTION', 'TRUST', 'RISK'];

export function ScanProgress({ onCancel }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setStep((value) => Math.min(value + 1, steps.length - 1)),
      820,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <div className="scan-progress-head">
        <Loader2 className="scan-spinner" size={18} aria-hidden="true" />
        <strong>{steps[step]}</strong>
      </div>

      <div className="scan-convergence-stage" aria-hidden="true">
        <div className="scan-convergence-lines" />
        {streams.map((stream) => (
          <span className="scan-stream-node" key={stream}>
            <i />
            {stream}
          </span>
        ))}
        <div className="scan-convergence-core">
          <BrainCircuit size={26} />
        </div>
        <div className="scan-convergence-output" />
      </div>

      <div className="scan-progress-steps" aria-hidden="true">
        {steps.map((item, index) => (
          <span key={item} className={index <= step ? 'active' : ''}>{item}</span>
        ))}
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>Cancel scan</Button>
    </div>
  );
}
