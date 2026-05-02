import React, { useEffect, useState } from 'react';

const STEPS = [
  {
    title: 'Welcome to BrainSNN',
    body: 'An affective-intelligence engine that detects the emotional payload inside online content before it shapes attention, behavior, brand risk, or public perception. Quick tour:',
    target: null
  },
  {
    title: '3D brain — the visualization layer',
    body: 'The brain is the readout, not the headline. 7 regions and 10 pathways react in real time as the engine absorbs whatever you feed it. Click a region to inspect it.',
    target: '.viewer-panel'
  },
  {
    title: 'Cognitive Firewall — the engine',
    body: 'Paste a tweet, an inbox, or a press release. The engine scores it across four affective dimensions, names the manipulation templates that fire, and returns evidence words plus a deterministic receipt.',
    target: '.cognitive-firewall-panel'
  },
  {
    title: 'Brand Risk Scorecard',
    body: 'Working with mention streams, ad copy, or a review pile? Layer 106 rolls many items into one 0–100 brand risk score with a tier and a copy-ready brief.',
    target: '.brand-risk-panel'
  },
  {
    title: 'Controls & data modes',
    body: 'Play/pause the brain, trigger bursts, switch scenarios, toggle quality tiers, and pick your data mode — Simulation, TRIBE v2 fMRI, or Live EEG.',
    target: '.controls-bar'
  },
  {
    title: 'Snapshots, share, audit',
    body: 'Save brain states, compare them side-by-side, export receipts, and share scans via /r/<hash> URLs or iframe embeds.',
    target: '.snapshot-panel'
  },
  {
    title: 'You\'re ready',
    body: 'Press ? for keyboard shortcuts, ⌘K to jump to any layer. Try the Firewall first, then the Brand Risk Scorecard.',
    target: null
  }
];

const STORAGE_KEY = 'brainsnn_onboarded';

export default function OnboardingWalkthrough() {
  const [step, setStep] = useState(-1); // -1 = not started / dismissed
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      // First visit — auto start after a short delay
      const timer = setTimeout(() => {
        setStep(0);
        setVisible(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleNext = () => {
    if (step >= STEPS.length - 1) {
      handleDismiss();
    } else {
      setStep(step + 1);
    }
  };

  const handlePrev = () => {
    if (step > 0) setStep(step - 1);
  };

  const handleDismiss = () => {
    setVisible(false);
    setStep(-1);
    localStorage.setItem(STORAGE_KEY, 'true');
  };

  // Highlight target element
  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return;
    const target = STEPS[step].target;
    if (!target) return;
    const el = document.querySelector(target);
    if (el) {
      el.classList.add('onboard-highlight');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return () => el.classList.remove('onboard-highlight');
    }
  }, [step]);

  if (!visible || step < 0) return null;

  const current = STEPS[step];

  return (
    <div className="onboard-overlay">
      <div className="onboard-modal">
        <div className="onboard-progress">
          {STEPS.map((_, i) => (
            <span key={i} className={`onboard-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        <div className="onboard-actions">
          {step > 0 && <button className="btn-sm" onClick={handlePrev}>Back</button>}
          <button className="btn primary" onClick={handleNext}>
            {step >= STEPS.length - 1 ? 'Get Started' : 'Next'}
          </button>
          <button className="btn-sm" onClick={handleDismiss}>Skip</button>
        </div>
        <p className="muted onboard-step-count">{step + 1} / {STEPS.length}</p>
      </div>
    </div>
  );
}

/** Call this to restart the walkthrough manually */
export function restartOnboarding() {
  localStorage.removeItem(STORAGE_KEY);
  window.location.reload();
}
