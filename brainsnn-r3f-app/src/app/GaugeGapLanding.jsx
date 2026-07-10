import React, { useEffect } from 'react';
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Dna,
  FlaskConical,
  Gauge,
  Layers3,
  Microscope,
  Play,
  Share2,
  Sparkles,
  WandSparkles,
  Waves,
  Zap,
} from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { ExperimentArcade } from '../features/gaugegap/ExperimentArcade.jsx';
import { track } from '../lib/analytics.js';
import '../styles/gaugegap.css';

const CONTENT_SAMPLE = 'Everyone says this breakthrough changes everything. Here is what the evidence actually shows, what remains uncertain, and the one result worth paying attention to.';

const LABS = [
  {
    id: 'attractor',
    eyebrow: 'Live experiment 001',
    title: 'Butterfly Effect Lab',
    description: 'Tune a chaotic system until order and turbulence balance on the same orbit.',
    icon: Gauge,
    action: 'Shape chaos',
  },
  {
    id: 'fireflies',
    eyebrow: 'Live experiment 002',
    title: 'Firefly Sync Lab',
    description: 'Connect hundreds of independent clocks and watch collective rhythm emerge without a leader.',
    icon: Sparkles,
    action: 'Sync the swarm',
  },
  {
    id: 'waves',
    eyebrow: 'Live experiment 003',
    title: 'Wave Eraser',
    description: 'Move a detector through overlapping waves and find the exact places where energy disappears.',
    icon: Waves,
    action: 'Find silence',
  },
  {
    id: 'reaction',
    eyebrow: 'Live experiment 004',
    title: 'Living Chemistry',
    description: 'Draw into a reaction-diffusion field and grow coral, cells, worms and mazes from two chemicals.',
    icon: Dna,
    action: 'Grow a species',
  },
  {
    id: 'soliton',
    eyebrow: 'Research engine',
    title: 'Soliton Collision Lab',
    description: 'Launch nonlinear waves, change their amplitude and watch them pass through one another without losing identity.',
    icon: Zap,
    action: 'Open research lab',
  },
  {
    id: 'content',
    eyebrow: 'BrainSNN crossover',
    title: 'Mind-Hack Autopsy',
    description: 'Paste viral content and expose the emotional pressure, trust cost and attention mechanics hiding inside it.',
    icon: BrainCircuit,
    action: 'Scan a viral claim',
  },
];

const LOOP = [
  { number: '01', title: 'Play', text: 'Touch the variables before reading the lesson. The system teaches through response.' },
  { number: '02', title: 'Discover', text: 'Find an unusual state, score it and preserve the exact parameters that produced it.' },
  { number: '03', title: 'Publish', text: 'Export the visual, the challenge link and the explanation from one run.' },
];

const ARCADE_IDS = new Set(['attractor', 'fireflies', 'waves', 'reaction']);

export function GaugeGapLanding({ onStart, onNavigate, onOpenReconstruct }) {
  useEffect(() => {
    document.title = 'GaugeGap Foundry | Play with the impossible';
    track('gaugegap_landing_viewed');
  }, []);

  function scrollToPlayground() {
    track('gaugegap_hero_play_clicked');
    document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openLab(id) {
    track('gaugegap_lab_clicked', { labId: id });
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
    if (id === 'soliton') onNavigate?.('research');
    if (id === 'content') onStart?.(CONTENT_SAMPLE);
  }

  return (
    <div className="gg-site">
      <header className="gg-nav" aria-label="GaugeGap navigation">
        <button type="button" className="gg-brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="gg-brand-mark">G</span>
          <span className="gg-brand-copy">
            <strong>GaugeGap Foundry</strong>
            <small>Playable science by BrainSNN</small>
          </span>
          <em>Alpha</em>
        </button>
        <nav className="gg-nav-links" aria-label="Primary">
          <button type="button" onClick={scrollToPlayground}>Arcade</button>
          <button type="button" onClick={() => document.getElementById('labs')?.scrollIntoView({ behavior: 'smooth' })}>Experiments</button>
          <button type="button" onClick={() => onNavigate?.('research')}>Research</button>
        </nav>
        <div className="gg-nav-actions">
          <button type="button" className="gg-brain-link" onClick={() => onStart?.('')}>Open BrainSNN</button>
          <Button variant="primary" onClick={scrollToPlayground}>Play now <Play size={15} /></Button>
        </div>
      </header>

      <main>
        <section className="gg-hero" aria-labelledby="gg-hero-heading">
          <div className="gg-hero-grid" />
          <div className="gg-hero-orb gg-hero-orb-one" />
          <div className="gg-hero-orb gg-hero-orb-two" />
          <div className="gg-hero-copy">
            <p className="gg-kicker"><Sparkles size={16} /> Science you can touch, remix and publish</p>
            <h1 id="gg-hero-heading">Don’t just learn the universe. <span>Play with it.</span></h1>
            <p className="gg-hero-lead">
              Four live experiments turn difficult science into visual games and shareable challenges.
              Shape chaos, synchronize a crowd, erase a wave or draw a new species.
            </p>
            <div className="gg-hero-actions">
              <Button variant="primary" onClick={scrollToPlayground}>Enter the science arcade <ArrowRight size={17} /></Button>
              <Button variant="secondary" onClick={() => onNavigate?.('research')}>See the research layer <Microscope size={17} /></Button>
            </div>
            <div className="gg-hero-proof" aria-label="Product capabilities">
              <div><strong>4 live</strong><span>Distinct experiments</span></div>
              <div><strong>1-click</strong><span>Challenge links</span></div>
              <div><strong>Exact</strong><span>Shareable run states</span></div>
              <div><strong>Open</strong><span>Equations and limits</span></div>
            </div>
          </div>

          <div className="gg-hero-challenge" aria-label="Featured GaugeGap challenge">
            <div className="gg-challenge-topline">
              <span><i /> Challenge live</span>
              <strong>#001</strong>
            </div>
            <div className="gg-mini-attractor" aria-hidden="true">
              <svg viewBox="0 0 520 380" role="presentation">
                <defs>
                  <linearGradient id="gg-path-gradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#7df9ff" />
                    <stop offset="0.5" stopColor="#8b5cf6" />
                    <stop offset="1" stopColor="#ff4fd8" />
                  </linearGradient>
                  <filter id="gg-glow">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <path className="gg-orbit-path gg-orbit-a" d="M255 190 C165 70 48 95 70 202 C91 305 226 307 255 190 C286 67 431 72 454 186 C476 300 336 324 255 190Z" />
                <path className="gg-orbit-path gg-orbit-b" d="M258 190 C202 105 113 112 114 196 C115 278 218 284 258 190 C303 92 398 106 401 190 C404 275 303 288 258 190Z" />
                <circle cx="255" cy="190" r="6" />
              </svg>
              <span className="gg-mini-label gg-mini-label-a">stable orbit</span>
              <span className="gg-mini-label gg-mini-label-b">chaos threshold</span>
            </div>
            <div className="gg-challenge-copy">
              <p>Find the most beautiful edge of chaos.</p>
              <span>Then try three completely different systems</span>
              <strong>4 labs</strong>
            </div>
            <button type="button" onClick={scrollToPlayground}>Accept challenge <ArrowRight size={16} /></button>
          </div>

          <button type="button" className="gg-scroll-cue" onClick={scrollToPlayground} aria-label="Scroll to the science arcade">
            <span>Scroll to arcade</span><ChevronDown size={17} />
          </button>
        </section>

        <ExperimentArcade />

        <section className="gg-loop" aria-labelledby="gg-loop-heading">
          <div className="gg-section-heading">
            <p className="gg-kicker"><Share2 size={16} /> The audience growth engine</p>
            <h2 id="gg-loop-heading">Every experiment becomes content.</h2>
            <p>A simulator should not end when the user closes the tab. It should produce the next video, challenge, lesson and research trail.</p>
          </div>
          <div className="gg-loop-grid">
            {LOOP.map((item) => (
              <article key={item.number}>
                <span>{item.number}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
          <div className="gg-output-ribbon" aria-label="Generated outputs">
            <span>One run creates</span>
            <strong>Interactive link</strong>
            <strong>Visual loop</strong>
            <strong>Score challenge</strong>
            <strong>Lesson hook</strong>
            <strong>Research state</strong>
          </div>
        </section>

        <section id="labs" className="gg-labs" aria-labelledby="gg-labs-heading">
          <div className="gg-section-heading gg-section-heading-wide">
            <div>
              <p className="gg-kicker"><FlaskConical size={16} /> Foundry experiments</p>
              <h2 id="gg-labs-heading">Come for the spectacle. Stay for the instrument.</h2>
            </div>
            <p>Each lab starts as a visual game, then opens into equations, assumptions, reproducible states and exportable evidence.</p>
          </div>
          <div className="gg-lab-grid">
            {LABS.map((lab, index) => {
              const Icon = lab.icon;
              return (
                <article key={lab.id} className={`gg-lab-card gg-lab-card-${(index % 4) + 1}`}>
                  <div className="gg-lab-card-art" aria-hidden="true">
                    <Icon size={34} />
                    <span /><span /><span />
                  </div>
                  <div className="gg-lab-card-copy">
                    <p>{lab.eyebrow}</p>
                    <h3>{lab.title}</h3>
                    <span>{lab.description}</span>
                    <button type="button" onClick={() => openLab(lab.id)}>{lab.action} <ArrowRight size={15} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="gg-depth" aria-labelledby="gg-depth-heading">
          <div className="gg-depth-visual" aria-hidden="true">
            <div className="gg-depth-ring gg-depth-ring-one" />
            <div className="gg-depth-ring gg-depth-ring-two" />
            <div className="gg-depth-core"><Layers3 size={38} /></div>
            <span className="gg-depth-node gg-depth-node-one">Play</span>
            <span className="gg-depth-node gg-depth-node-two">Model</span>
            <span className="gg-depth-node gg-depth-node-three">Verify</span>
            <span className="gg-depth-node gg-depth-node-four">Publish</span>
          </div>
          <div className="gg-depth-copy">
            <p className="gg-kicker"><Layers3 size={16} /> Two depths, one experience</p>
            <h2 id="gg-depth-heading">Entertainment on the surface. Research underneath.</h2>
            <p>
              Most simulation sites stop at the visual. GaugeGap preserves the model, parameters, initial condition,
              assumptions and claim boundary so the same experience can grow into a real research instrument.
            </p>
            <ul>
              <li><CheckCircle2 size={17} /> Every shared run preserves its exact state.</li>
              <li><CheckCircle2 size={17} /> Research mode exposes equations and limitations.</li>
              <li><CheckCircle2 size={17} /> BrainSNN turns discoveries into clear, responsible publishing.</li>
            </ul>
            <div className="gg-depth-actions">
              <Button variant="primary" onClick={() => onNavigate?.('research')}>Open research mode <Microscope size={16} /></Button>
              <Button variant="ghost" onClick={() => onStart?.(CONTENT_SAMPLE)}>Test the publishing engine <WandSparkles size={16} /></Button>
            </div>
          </div>
        </section>

        <section className="gg-final-cta" aria-labelledby="gg-final-heading">
          <div className="gg-final-glow" />
          <p className="gg-kicker"><Sparkles size={16} /> Four worlds are already running</p>
          <h2 id="gg-final-heading">Pick a system. Break its rules. Share what appears.</h2>
          <p>The next person should arrive through your challenge—not through another explanation page.</p>
          <Button variant="primary" onClick={scrollToPlayground}>Enter the science arcade <ArrowRight size={17} /></Button>
        </section>
      </main>

      <footer className="gg-footer">
        <div>
          <span className="gg-brand-mark">G</span>
          <p><strong>GaugeGap Foundry</strong><small>Playable science and publishing infrastructure by BrainSNN.</small></p>
        </div>
        <nav>
          <button type="button" onClick={scrollToPlayground}>Arcade</button>
          <button type="button" onClick={() => onNavigate?.('research')}>Research</button>
          <button type="button" onClick={() => onStart?.('')}>BrainSNN scanner</button>
          <button type="button" onClick={() => onOpenReconstruct?.()}>Reconstruct</button>
        </nav>
        <p className="gg-footer-note">Simulations are educational numerical models, not proof of physical claims. Exact assumptions and limitations belong with every research release.</p>
        <p className="gg-footer-legal">© {new Date().getFullYear()} GaugeGap Foundry · BrainSNN.com</p>
      </footer>
    </div>
  );
}
