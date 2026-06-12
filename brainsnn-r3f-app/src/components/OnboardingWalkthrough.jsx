import React, { useEffect, useState } from 'react';

const STEPS = [
  {
    title: 'Welcome to BrainSNN',
    body: 'A 3D brain that reads the feelings hidden in everyday content — and shows you, live, how they light it up. Six quick stops.',
    target: null
  },
  {
    title: 'Paste anything, see what it does',
    body: 'Drop a headline, email, or post here and hit Analyze. You get a verdict, the evidence phrases, and the exact feelings the text installs. Not sure what to paste? The example tiles below are one tap.',
    target: '.scan-hero'
  },
  {
    title: 'Watch the brain react',
    body: 'Seven regions, ten pathways, live signal flow — every scan drives it. Click a region to inspect it. The full simulation controls (scenarios, recording, quality, data mode) tuck into the strip at the bottom of this panel.',
    target: '.viewer-panel'
  },
  {
    title: 'Eight sections, 100+ layers',
    body: 'Everything else lives behind these tabs — scanning and firewall tools, knowledge bases, defense drills, studio toys, and more. Each section opens with a map of what\'s inside.',
    target: '.section-nav'
  },
  {
    title: 'Jump anywhere with ⌘K',
    body: 'The command palette searches all 100+ layers by name. Press ⌘K / Ctrl+K anytime, or click this button — it switches sections and lands you on the right panel.',
    target: '.section-nav .palette-cta'
  },
  {
    title: 'You\'re ready',
    body: 'Press ? for keyboard shortcuts, Shift+? for the full hotkey map, and hover any dotted-underlined term for a plain-English definition. Have fun.',
    target: null
  }
];

const STORAGE_KEY = 'brainsnn_onboarded_v2';

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
