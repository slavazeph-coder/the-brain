import React, { useEffect } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  Layers3,
  Microscope,
  Orbit,
  Play,
  Share2,
  Shield,
  Sparkles,
  WandSparkles,
  Zap,
} from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { ExperimentArcade } from '../features/gaugegap/ExperimentArcade.jsx';
import { ClientPathways, TrustLadder, VisitorRoutes } from '../features/gaugegap/AudiencePathways.jsx';
import { track } from '../lib/analytics.js';
import '../styles/gaugegap.css';
import '../styles/arcade-discovery.css';

const CONTENT_SAMPLE = 'Everyone says this breakthrough changes everything. Here is what the evidence actually shows, what remains uncertain, and the one result worth paying attention to.';
const FRACTAL_LAB_URL = 'https://xioaisolutions.github.io/gaugegap-foundry/fractal-reality-lab/';

const DEEPER_TOOLS = [
  {
    id: 'fractal',
    eyebrow: 'Flagship research experience',
    title: 'Fractal Reality Lab',
    description: 'Explore Mandelbrot and Julia dynamics, sonify finite orbits, compare recurring forms, and watch a BrainSNN-style spiking bridge respond.',
    icon: Orbit,
    action: 'Open the live lab',
  },
  {
    id: 'soliton',
    eyebrow: 'Research workspace',
    title: 'Soliton Collision Lab',
    description: 'Move from a visual demonstration into nonlinear-wave controls, diagnostics and model-specific outputs.',
    icon: Zap,
    action: 'Open research mode',
  },
  {
    id: 'content',
    eyebrow: 'BrainSNN engine',
    title: 'Mind-Hack Autopsy',
    description: 'Paste content and expose attention pressure, emotional charge, trust cost and manipulation signals.',
    icon: BrainCircuit,
    action: 'Test the decision engine',
  },
  {
    id: 'reconstruct',
    eyebrow: 'Claim boundary',
    title: 'Reconstruct a Stronger Claim',
    description: 'Separate what the evidence supports from what the story merely implies, then rebuild the claim responsibly.',
    icon: Shield,
    action: 'Build a defensible claim',
  },
];

const LOOP = [
  { number: '01', title: 'Play', text: 'Touch the system before reading the explanation. Immediate response earns attention.' },
  { number: '02', title: 'Understand', text: 'Missions, model notes and visible limits connect the experience to the underlying mechanism.' },
  { number: '03', title: 'Publish', text: 'Share the run, challenge and explanation from the same experiment state.' },
];

const ARCADE_IDS = new Set(['attractor', 'fireflies', 'waves', 'reaction', 'gravity', 'flock', 'outbreak', 'pendulum', 'ants', 'traffic', 'life', 'ecosystem']);

export function GaugeGapLanding({ onStart, onNavigate, onOpenReconstruct }) {
  useEffect(() => {
    document.title = 'GaugeGap Foundry | Play with the impossible';
    track('gaugegap_landing_viewed');
  }, []);

  function scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToPlayground() {
    track('gaugegap_hero_play_clicked');
    scrollTo('playground');
  }

  function openResearch() {
    track('gaugegap_research_cta_clicked');
    onNavigate?.('research');
  }

  function openLab(id) {
    track('gaugegap_lab_clicked', { labId: id });
    if (id === 'fractal') {
      window.open(FRACTAL_LAB_URL, '_blank', 'noopener,noreferrer');
      return;
    }
    if (ARCADE_IDS.has(id)) {
      const url = new URL(window.location.href);
      url.searchParams.set('lab', id);
      url.searchParams.delete('run');
      url.searchParams.delete('state');
      url.hash = 'playground';
      window.history.replaceState({}, '', url);
      window.dispatchEvent(new CustomEvent('gaugegap:lab', { detail: { lab: id } }));
      scrollToPlayground();
    }
    if (id === 'soliton') openResearch();
    if (id === 'content') onStart?.(CONTENT_SAMPLE);
    if (id === 'reconstruct') onOpenReconstruct?.();
  }

  return (
    <div className="gg-site">
      <header className="gg-nav" aria-label="GaugeGap navigation">
        <button type="button" className="gg-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="gg-brand-mark">G</span>
          <span className="gg-brand-copy"><strong>GaugeGap Foundry</strong><small>Playable science by BrainSNN</small></span>
          <em>Alpha</em>
        </button>
        <nav className="gg-nav-links" aria-label="Primary">
          <button type="button" onClick={scrollToPlayground}>Arcade</button>
          <a href={FRACTAL_LAB_URL} target="_blank" rel="noreferrer">Fractal Lab</a>
          <button type="button" onClick={() => scrollTo('clients')}>For organizations</button>
          <button type="button" onClick={openResearch}>Research</button>
        </nav>
        <div className="gg-nav-actions">
          <button type="button" className="gg-brain-link" onClick={() => onStart?.('')}>Open BrainSNN</button>
          <Button variant="primary" onClick={() => scrollTo('gg-start-heading')}>Start here <Play size={15} /></Button>
        </div>
      </header>

      <main>
        <section className="gg-hero" aria-labelledby="gg-hero-heading">
          <div className="gg-hero-grid" />
          <div className="gg-hero-orb gg-hero-orb-one" />
          <div className="gg-hero-orb gg-hero-orb-two" />
          <div className="gg-hero-copy">
            <p className="gg-kicker"><Sparkles size={16} /> Playable science for curious people and ambitious organizations</p>
            <h1 id="gg-hero-heading">Do not just explain the idea. <span>Let people operate it.</span></h1>
            <p className="gg-hero-lead">
              GaugeGap is the public science arcade. BrainSNN is the analysis and publishing engine underneath.
              Together they turn difficult systems into interactive missions, shareable discoveries and client-ready experiences.
            </p>
            <div className="gg-hero-actions">
              <Button variant="primary" onClick={scrollToPlayground}>Enter the science arcade <ArrowRight size={17} /></Button>
              <a className="button button-secondary" href={FRACTAL_LAB_URL} target="_blank" rel="noreferrer">Open Fractal Reality Lab <Orbit size={17} /></a>
              <Button variant="secondary" onClick={() => scrollTo('clients')}>Build for your audience <ArrowRight size={17} /></Button>
            </div>
            <div className="gg-hero-proof" aria-label="Product capabilities">
              <div><strong>16 live</strong><span>15 arcade + flagship lab</span></div>
              <div><strong>4 paths</strong><span>Clear first steps</span></div>
              <div><strong>Client</strong><span>Custom pilot pathway</span></div>
              <div><strong>Open</strong><span>Models and limits</span></div>
            </div>
          </div>

          <div className="gg-hero-challenge" aria-label="Featured GaugeGap challenge">
            <div className="gg-challenge-topline"><span><i /> Live system</span><strong>Start in seconds</strong></div>
            <div className="gg-mini-attractor" aria-hidden="true">
              <svg viewBox="0 0 520 380" role="presentation">
                <defs>
                  <linearGradient id="gg-path-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7df9ff" /><stop offset="0.5" stopColor="#8b5cf6" /><stop offset="1" stopColor="#ff4fd8" /></linearGradient>
                  <filter id="gg-glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                </defs>
                <path className="gg-orbit-path gg-orbit-a" d="M255 190 C165 70 48 95 70 202 C91 305 226 307 255 190 C286 67 431 72 454 186 C476 300 336 324 255 190Z" />
                <path className="gg-orbit-path gg-orbit-b" d="M258 190 C202 105 113 112 114 196 C115 278 218 284 258 190 C303 92 398 106 401 190 C404 275 303 288 258 190Z" />
                <circle cx="255" cy="190" r="6" />
              </svg>
              <span className="gg-mini-label gg-mini-label-a">change one rule</span><span className="gg-mini-label gg-mini-label-b">watch the future split</span>
            </div>
            <div className="gg-challenge-copy"><p>Find the edge of chaos.</p><span>No signup. No tutorial wall. The model responds immediately.</span><strong>2 min</strong></div>
            <button type="button" onClick={() => openLab('attractor')}>Play the fastest demo <ArrowRight size={16} /></button>
          </div>

          <button type="button" className="gg-scroll-cue" onClick={() => scrollTo('gg-start-heading')} aria-label="Choose a starting path"><span>Choose your path</span><ChevronDown size={17} /></button>
        </section>

        <VisitorRoutes onResearch={openResearch} />
        <ExperimentArcade onOpenScanner={onStart} />

        <section className="gg-loop" aria-labelledby="gg-loop-heading">
          <div className="gg-section-heading"><p className="gg-kicker"><Share2 size={16} /> The engagement engine</p><h2 id="gg-loop-heading">A useful interaction should continue after the first click.</h2><p>The visual earns attention. The model earns understanding. The shared state brings the next person into the same system.</p></div>
          <div className="gg-loop-grid">{LOOP.map((item) => <article key={item.number}><span>{item.number}</span><h3>{item.title}</h3><p>{item.text}</p></article>)}</div>
          <div className="gg-output-ribbon" aria-label="Generated outputs"><span>One experience can create</span><strong>Interactive lesson</strong><strong>Challenge link</strong><strong>Visual asset</strong><strong>Model note</strong><strong>Research state</strong></div>
        </section>

        <ClientPathways />

        <section id="labs" className="gg-labs" aria-labelledby="gg-labs-heading">
          <div className="gg-section-heading gg-section-heading-wide"><div><p className="gg-kicker"><FlaskConical size={16} /> Beyond the public arcade</p><h2 id="gg-labs-heading">Four deeper tools. Four different jobs.</h2></div><p>The arcade builds intuition. These workspaces analyze content, expose claim boundaries and support deeper technical exploration.</p></div>
          <div className="gg-lab-grid">
            {DEEPER_TOOLS.map((lab, index) => { const Icon = lab.icon; return <article key={lab.id} className={`gg-lab-card gg-lab-card-${index + 1}`}><div className="gg-lab-card-art" aria-hidden="true"><Icon size={34} /><span /><span /><span /></div><div className="gg-lab-card-copy"><p>{lab.eyebrow}</p><h3>{lab.title}</h3><span>{lab.description}</span><button type="button" onClick={() => openLab(lab.id)}>{lab.action} <ArrowRight size={15} /></button></div></article>; })}
          </div>
        </section>

        <section className="gg-depth" aria-labelledby="gg-depth-heading">
          <div className="gg-depth-visual" aria-hidden="true"><div className="gg-depth-ring gg-depth-ring-one" /><div className="gg-depth-ring gg-depth-ring-two" /><div className="gg-depth-core"><Layers3 size={38} /></div><span className="gg-depth-node gg-depth-node-one">Play</span><span className="gg-depth-node gg-depth-node-two">Model</span><span className="gg-depth-node gg-depth-node-three">Verify</span><span className="gg-depth-node gg-depth-node-four">Publish</span></div>
          <div className="gg-depth-copy"><p className="gg-kicker"><Layers3 size={16} /> One platform, two visible products</p><h2 id="gg-depth-heading">GaugeGap attracts attention. BrainSNN turns the result into a decision.</h2><p>The public experience should be simple. The engine underneath preserves the model, analyzes the message and supports a more responsible publishing workflow.</p><ul><li><CheckCircle2 size={17} /> GaugeGap handles interaction, missions and shareable states.</li><li><CheckCircle2 size={17} /> BrainSNN handles content analysis, revision and publishing decisions.</li><li><CheckCircle2 size={17} /> Research mode exposes equations, diagnostics and limitations.</li></ul><div className="gg-depth-actions"><Button variant="primary" onClick={openResearch}>Open research mode <Microscope size={16} /></Button><Button variant="ghost" onClick={() => onStart?.(CONTENT_SAMPLE)}>Test BrainSNN <WandSparkles size={16} /></Button></div><p className="gg-depth-foundry"><a href="https://xioaisolutions.github.io/gaugegap-foundry/foundry-experience/" target="_blank" rel="noreferrer">Open the Deep Foundry — the verification-first research playground with proofpack export <ArrowRight size={14} /></a></p></div>
        </section>

        <TrustLadder onResearch={openResearch} />

        <section className="gg-final-cta" aria-labelledby="gg-final-heading"><div className="gg-final-glow" /><p className="gg-kicker"><Sparkles size={16} /> Choose the next useful step</p><h2 id="gg-final-heading">Play a system—or build one for the people you need to reach.</h2><p>The public arcade proves the interaction model. A focused client pilot applies it to your own audience, concept and outcome.</p><div className="gg-hero-actions"><Button variant="primary" onClick={scrollToPlayground}>Enter the arcade <ArrowRight size={17} /></Button><a className="button button-secondary" href={FRACTAL_LAB_URL} target="_blank" rel="noreferrer">Explore the flagship lab <Orbit size={17} /></a><Button variant="secondary" onClick={() => scrollTo('clients')}>Discuss a client pilot <ArrowRight size={17} /></Button></div></section>
      </main>

      <footer className="gg-footer"><div><span className="gg-brand-mark">G</span><p><strong>GaugeGap Foundry</strong><small>Playable science and interactive client experiences by BrainSNN.</small></p></div><nav><button type="button" onClick={scrollToPlayground}>Arcade</button><a href={FRACTAL_LAB_URL} target="_blank" rel="noreferrer">Fractal Lab</a><button type="button" onClick={() => scrollTo('clients')}>For organizations</button><button type="button" onClick={openResearch}>Research</button><button type="button" onClick={() => onStart?.('')}>BrainSNN</button><a href="mailto:hello@brainsnn.com">Contact</a></nav><p className="gg-footer-note">Public simulations are educational numerical models, not proof of physical claims. Research releases must state assumptions, diagnostics and limitations.</p><p className="gg-footer-legal">© {new Date().getFullYear()} GaugeGap Foundry · BrainSNN.com</p></footer>
    </div>
  );
}
