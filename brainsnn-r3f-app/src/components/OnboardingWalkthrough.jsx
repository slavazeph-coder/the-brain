import React, { useEffect, useState } from 'react';

const STEPS = [
  {
    title: 'Welcome to BrainSNN',
    body: 'A neuromorphic brain visualiser powered by React Three Fiber, Meta TRIBE v2, and Google Gemma 4. Let\'s take a quick tour.',
    target: null
  },
  {
    title: '3D Brain Viewer',
    body: 'The main canvas renders 7 brain regions connected by 10 neural pathways with GPU-animated signal flow. Click any region to inspect it.',
    target: '.viewer-panel'
  },
  {
    title: 'Control Bar',
    body: 'Play/pause the simulation, trigger bursts, switch scenarios, toggle quality tiers, and choose your data mode — Simulation, TRIBE v2, or Live EEG.',
    target: '.controls-bar'
  },
  {
    title: 'Neural Analytics',
    body: 'Real-time sparklines, correlation matrix, anomaly detection, and threshold alerts. Expand for the full mission-control view.',
    target: '.analytics-dashboard'
  },
  {
    title: 'Cognitive Firewall',
    body: 'Paste any content to score manipulation patterns. When Gemma 4 is configured, analysis upgrades from regex to AI-powered deep scanning.',
    target: '.cognitive-firewall-panel'
  },
  {
    title: 'Snapshots & Sharing',
    body: 'Save brain states, compare them side-by-side, generate reports, and share via URL or embed code.',
    target: '.snapshot-panel'
  },
  {
    title: 'You\'re Ready!',
    body: 'Press ? anytime for keyboard shortcuts. Explore the brain, scan content, and see your neural network come alive.',
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
