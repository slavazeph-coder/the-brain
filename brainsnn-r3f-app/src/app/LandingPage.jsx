import React, { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, BrainCircuit, CheckCircle2, FlaskConical, Pause, Play, RadioTower, Sparkles, Zap } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { EXAMPLES } from '../features/scan/ExampleSelector.jsx';
import { track } from '../lib/analytics.js';
import { LAYER_CATALOG } from '../lib/layerCatalog.js';

const DEMO_SAMPLES = [
  {
    id: 'social-hook',
    label: 'Creator hook',
    title: 'Proof-led social post',
    content: EXAMPLES.find((example) => example.id === 'social-hook')?.content || EXAMPLES[0].content,
    verdict: 'Strong trust signal. Hook needs more contrast.',
    scores: { hook: 78, trust: 86, risk: 18 },
    timeline: [38, 44, 62, 76, 81, 72, 69, 74, 79, 83],
  },
  {
    id: 'paid-ad',
    label: 'Ad preflight',
    title: 'Paid campaign claim',
    content: EXAMPLES.find((example) => example.id === 'paid-ad')?.content || EXAMPLES[1].content,
    verdict: 'Clear promise. Add one proof point before the CTA.',
    scores: { hook: 84, trust: 73, risk: 29 },
    timeline: [42, 59, 74, 86, 80, 77, 75, 82, 86, 79],
  },
  {
    id: 'sales-email',
    label: 'Trust repair',
    title: 'Outbound email opener',
    content: EXAMPLES.find((example) => example.id === 'sales-email')?.content || EXAMPLES[3].content,
    verdict: 'Useful empathy. Reduce pressure in the second sentence.',
    scores: { hook: 69, trust: 81, risk: 24 },
    timeline: [33, 39, 54, 64, 67, 73, 70, 75, 71, 77],
  },
];

function DemoTimeline({ values }) {
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 100;
    const y = 100 - value;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="landing-timeline" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Demo attention timeline">
      <polyline points={points} />
    </svg>
  );
}

function LandingBrain({ sample, paused }) {
  const nodes = useMemo(() => [
    { id: 'hook', label: 'Hook', x: 28, y: 42, value: sample.scores.hook, color: '#00f5ff' },
    { id: 'trust', label: 'Trust', x: 62, y: 38, value: sample.scores.trust, color: '#22c55e' },
    { id: 'risk', label: 'Risk', x: 48, y: 64, value: sample.scores.risk, color: '#ef4444' },
    { id: 'memory', label: 'Context', x: 72, y: 66, value: 58, color: '#a855f7' },
  ], [sample]);

  return (
    <div className={`landing-brain ${paused ? 'paused' : ''}`} aria-label="Animated BrainSNN signal preview">
      <div className="landing-brain-core" />
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id="landing-edge" x1="0" x2="1">
            <stop offset="0%" stopColor="#00f5ff" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <path d="M28 42 C 42 26, 54 28, 62 38" />
        <path d="M28 42 C 42 54, 40 64, 48 64" />
        <path d="M62 38 C 76 47, 72 56, 72 66" />
        <path d="M48 64 C 58 73, 65 73, 72 66" />
      </svg>
      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          className="landing-brain-node"
          style={{ left: `${node.x}%`, top: `${node.y}%`, '--node-color': node.color, '--node-scale': 0.72 + node.value / 180 }}
          aria-label={`${node.label} demo signal ${node.value}`}
        >
          <span>{node.label}</span>
          <strong>{node.value}</strong>
        </button>
      ))}
    </div>
  );
}

export function LandingPage({ onStart }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const activeSample = DEMO_SAMPLES[activeIndex];

  useEffect(() => {
    track('landing_viewed');
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % DEMO_SAMPLES.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, [paused]);

  function start(sample = activeSample) {
    track('landing_scan_cta_clicked', { sampleId: sample.id });
    onStart(sample.content);
  }

  return (
    <div className="landing-shell">
      <header className="landing-nav" aria-label="BrainSNN landing navigation">
        <button type="button" className="landing-brand" onClick={() => start(activeSample)} aria-label="Open BrainSNN scanner">
          <span className="landing-mark">SNN</span>
          <span>
            <strong>BrainSNN.com</strong>
            <small>Affective Intelligence Core</small>
          </span>
          <em>V2.0</em>
        </button>
        <div className="landing-status">
          <span aria-hidden="true" />
          System optimal
        </div>
      </header>

      <main className="landing-hero">
        <section className="landing-copy" aria-labelledby="landing-heading">
          <div className="landing-trend-pill">
            <Sparkles size={18} aria-hidden="true" />
            Neuromarketing trends 2026: real-time content pre-testing
          </div>
          <h1 id="landing-heading">
            See response signals in any content
            <span>before behavior forms.</span>
          </h1>
          <p>
            BrainSNN estimates hook strength, trust pressure, emotional charge and brand-safety risk before a post,
            ad, email or script goes live. Technical Crumb LLM, TRIBE and {LAYER_CATALOG.length}-layer traces stay available when you want the research layer.
          </p>
          <div className="landing-actions">
            <Button variant="primary" onClick={() => start(activeSample)}>
              Launch Active Demo <ArrowRight size={17} aria-hidden="true" />
            </Button>
            <Button variant="secondary" onClick={() => onStart('')}>
              Open Scanner <BrainCircuit size={17} aria-hidden="true" />
            </Button>
          </div>
          <div className="landing-metrics" aria-label="BrainSNN capability highlights">
            <div>
              <span>Attention run</span>
              <strong>O(N log N)</strong>
              <small>Wave mechanics</small>
            </div>
            <div>
              <span>Trust gain</span>
              <strong>+31</strong>
              <small>Rewrite target</small>
            </div>
            <div>
              <span>Layer trace</span>
              <strong>102</strong>
              <small>Context triggers</small>
            </div>
          </div>
        </section>

        <aside className="landing-demo" aria-label="Interactive BrainSNN demo">
          <div className="landing-demo-topline">
            <span><RadioTower size={16} aria-hidden="true" /> Live scan</span>
            <button type="button" onClick={() => setPaused((value) => !value)}>
              {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
          </div>
          <LandingBrain sample={activeSample} paused={paused} />
          <div className="landing-sample-card">
            <div className="landing-sample-head">
              <span>AI @NeuroEngine</span>
              <strong>Live scan</strong>
            </div>
            <p className="landing-sample-label">{activeSample.label}</p>
            <h2>{activeSample.title}</h2>
            <p>{activeSample.content}</p>
            <DemoTimeline values={activeSample.timeline} />
            <div className="landing-score-grid">
              <div><span>Hook</span><strong>{activeSample.scores.hook}</strong></div>
              <div><span>Trust</span><strong>{activeSample.scores.trust}</strong></div>
              <div><span>Risk</span><strong>{activeSample.scores.risk}</strong></div>
            </div>
            <p className="landing-verdict"><CheckCircle2 size={16} aria-hidden="true" /> {activeSample.verdict}</p>
          </div>
          <div className="landing-sample-tabs" aria-label="Demo samples">
            {DEMO_SAMPLES.map((sample, index) => (
              <button
                key={sample.id}
                type="button"
                className={index === activeIndex ? 'active' : ''}
                onClick={() => {
                  setActiveIndex(index);
                  setPaused(true);
                }}
              >
                <span>{sample.label}</span>
                <strong>{sample.title}</strong>
              </button>
            ))}
          </div>
        </aside>
      </main>

      <section className="landing-deep-strip" aria-label="Advanced engine surfaces">
        <article>
          <Activity size={18} aria-hidden="true" />
          <span>Decision Engine</span>
          <strong>Scan, diagnose, improve, compare, approve and export in one flow.</strong>
        </article>
        <article>
          <Zap size={18} aria-hidden="true" />
          <span>TRIBE + Gemma-ready</span>
          <strong>Provider layers activate only when configured; local fallback remains transparent.</strong>
        </article>
        <article>
          <FlaskConical size={18} aria-hidden="true" />
          <span>Research drawer</span>
          <strong>{LAYER_CATALOG.length}-layer traces, Crumb physics and benchmarks stay out of the buyer workflow.</strong>
        </article>
      </section>
    </div>
  );
}
