import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';

const steps = [
  'Reading the message',
  'Mapping attention signals',
  'Checking trust pressure',
  'Building recommendations',
];

export function ScanProgress({ onCancel }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, steps.length - 1)), 900);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <div className="scan-progress-head">
        <Loader2 className="scan-spinner" size={18} aria-hidden="true" />
        <strong>{steps[step]}</strong>
      </div>
      <div className="scan-progress-steps" aria-hidden="true">
        {steps.map((item, index) => <span key={item} className={index <= step ? 'active' : ''}>{item}</span>)}
      </div>
      <Button variant="ghost" size="sm" onClick={onCancel}>Cancel scan</Button>
    </div>
  );
}
