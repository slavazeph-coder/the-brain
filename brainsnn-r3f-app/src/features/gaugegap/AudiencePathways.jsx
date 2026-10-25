import React from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  GraduationCap,
  Megaphone,
  Microscope,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { track } from '../../lib/analytics.js';
import '../../styles/audience-pathways.css';

const VISITOR_ROUTES = [
  {
    id: 'wonder',
    icon: Sparkles,
    eyebrow: 'I have two minutes',
    title: 'Show me something wild',
    text: 'Start with the Butterfly Effect and change one number until the future splits.',
    action: 'Open the fastest wow',
    lab: 'attractor',
  },
  {
    id: 'teach',
    icon: GraduationCap,
    eyebrow: 'I teach or explain',
    title: 'Give me a lesson people remember',
    text: 'Paint cellular life, contain an outbreak, or let a class compete on the same model.',
    action: 'Open a classroom-ready lab',
    lab: 'life',
  },
  {
    id: 'research',
    icon: Microscope,
    eyebrow: 'I need depth',
    title: 'Show me the instrument underneath',
    text: 'Move beyond spectacle into parameters, assumptions, limitations and reproducible states.',
    action: 'Enter research mode',
    route: 'research',
  },
  {
    id: 'client',
    icon: Building2,
    eyebrow: 'I have an audience or client',
    title: 'Build an interactive experience for us',
    text: 'Turn a difficult idea, product story or research concept into something people can play and share.',
    action: 'See client pilots',
    target: 'clients',
  },
];

const CLIENT_PATHWAYS = [
  {
    id: 'education',
    icon: GraduationCap,
    title: 'Schools, museums and training',
    text: 'Transform an abstract concept into a guided lab, exhibit or workshop challenge.',
    outcomes: ['Branded interactive lesson', 'Facilitator prompts and missions', 'Shareable student run states'],
  },
  {
    id: 'media',
    icon: Megaphone,
    title: 'Publishers and creators',
    text: 'Turn an article, episode or complex story into a playable explanation that earns a second click.',
    outcomes: ['Playable story companion', 'Short-form visual assets', 'Challenge links for distribution'],
  },
  {
    id: 'brand',
    icon: Building2,
    title: 'Brands and campaigns',
    text: 'Build a memorable product or campaign experience without reducing the idea to another landing page.',
    outcomes: ['Campaign microsite concept', 'Custom scoring and missions', 'Launch and analytics plan'],
  },
  {
    id: 'research',
    icon: Microscope,
    title: 'Research and innovation teams',
    text: 'Create a browser instrument that preserves settings, communicates limits and produces reviewable outputs.',
    outcomes: ['Reproducible experiment state', 'Model and assumption layer', 'Evidence and export workflow'],
  },
];

const TRUST_LEVELS = [
  {
    label: 'Play',
    title: 'Explore the behavior',
    text: 'A fast visual model designed to build intuition and curiosity.',
  },
  {
    label: 'Teach',
    title: 'Explain the mechanism',
    text: 'Controls, missions and model notes connect the spectacle to the underlying idea.',
  },
  {
    label: 'Verify',
    title: 'Expose the boundary',
    text: 'Research releases preserve parameters, assumptions, limitations and reproducible outputs.',
  },
];

function openLab(lab) {
  const url = new URL(window.location.href);
  url.searchParams.set('lab', lab);
  url.searchParams.delete('run');
  url.searchParams.delete('state');
  url.hash = 'playground';
  window.history.replaceState({}, '', url);
  window.dispatchEvent(new CustomEvent('gaugegap:lab', { detail: { lab } }));
  window.requestAnimationFrame(() => document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

export function VisitorRoutes({ onResearch }) {
  function chooseRoute(route) {
    track('gaugegap_pathway_selected', { pathway: route.id });
    if (route.lab) openLab(route.lab);
    if (route.route === 'research') onResearch?.();
    if (route.target) document.getElementById(route.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section className="gg-visitor-routes" aria-labelledby="gg-start-heading">
      <div className="gg-audience-heading">
        <p className="gg-kicker"><Sparkles size={16} /> Start with what brought you here</p>
        <h2 id="gg-start-heading">You should know where to click in five seconds.</h2>
        <p>GaugeGap serves curious visitors, educators, researchers and organizations. Pick the path that matches your job right now.</p>
      </div>
      <div className="gg-route-grid">
        {VISITOR_ROUTES.map((route) => {
          const Icon = route.icon;
          return (
            <button key={route.id} type="button" className="gg-route-card" onClick={() => chooseRoute(route)}>
              <span className="gg-route-icon"><Icon size={22} /></span>
              <small>{route.eyebrow}</small>
              <strong>{route.title}</strong>
              <p>{route.text}</p>
              <em>{route.action} <ArrowRight size={15} /></em>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function openClientBrief(pathway) {
  const subject = encodeURIComponent(`GaugeGap pilot — ${pathway.title}`);
  const body = encodeURIComponent([
    'Hi GaugeGap team,',
    '',
    `I am exploring a ${pathway.title.toLowerCase()} project.`,
    '',
    'Audience:',
    'Concept or topic:',
    'What I want people to understand or do:',
    'Target launch window:',
    '',
    'Please suggest the smallest useful pilot.',
  ].join('\n'));
  track('gaugegap_client_cta_clicked', { pathway: pathway.id });
  window.location.href = `mailto:hello@brainsnn.com?subject=${subject}&body=${body}`;
}

export function ClientPathways() {
  return (
    <section id="clients" className="gg-client-section" aria-labelledby="gg-client-heading">
      <div className="gg-client-intro">
        <div className="gg-audience-heading">
          <p className="gg-kicker"><Building2 size={16} /> For organizations and client work</p>
          <h2 id="gg-client-heading">Do not buy another explanation page. Build something people can operate.</h2>
          <p>GaugeGap can turn a hard idea into a branded interactive experience with a clear mission, measurable behavior and a deeper evidence layer.</p>
        </div>
        <div className="gg-client-promise">
          <ShieldCheck size={24} />
          <div>
            <strong>Start with one useful pilot</strong>
            <span>One audience, one concept, one interaction and one success measure. Expand only after people use it.</span>
          </div>
        </div>
      </div>

      <div className="gg-client-grid">
        {CLIENT_PATHWAYS.map((pathway) => {
          const Icon = pathway.icon;
          return (
            <article key={pathway.id} className="gg-client-card">
              <span className="gg-client-icon"><Icon size={24} /></span>
              <h3>{pathway.title}</h3>
              <p>{pathway.text}</p>
              <ul>
                {pathway.outcomes.map((outcome) => <li key={outcome}><CheckCircle2 size={15} /> {outcome}</li>)}
              </ul>
              <button type="button" onClick={() => openClientBrief(pathway)}>Start this brief <ArrowRight size={15} /></button>
            </article>
          );
        })}
      </div>

      <div className="gg-pilot-strip">
        <div>
          <small>Typical first pilot</small>
          <strong>Concept → playable prototype → client review → launch-ready experience</strong>
        </div>
        <div className="gg-pilot-steps" aria-label="Pilot deliverables">
          <span>Custom interaction</span><span>Branded interface</span><span>Mission and scoring</span><span>Shareable states</span><span>Model notes</span>
        </div>
        <Button variant="primary" onClick={() => openClientBrief({ id: 'general', title: 'Custom interactive experience' })}>
          Discuss a pilot <ArrowRight size={16} />
        </Button>
      </div>
    </section>
  );
}

export function TrustLadder({ onResearch }) {
  return (
    <section className="gg-trust-section" aria-labelledby="gg-trust-heading">
      <div className="gg-audience-heading">
        <p className="gg-kicker"><ShieldCheck size={16} /> Know what you are looking at</p>
        <h2 id="gg-trust-heading">Fun is the front door. The claim boundary stays visible.</h2>
        <p>Not every interactive model is a research result. GaugeGap separates intuition-building experiences from releases that expose enough detail for technical review.</p>
      </div>
      <div className="gg-trust-grid">
        {TRUST_LEVELS.map((level, index) => (
          <article key={level.label}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <small>{level.label}</small>
            <h3>{level.title}</h3>
            <p>{level.text}</p>
          </article>
        ))}
      </div>
      <div className="gg-trust-note">
        <p><strong>Current public arcade:</strong> educational numerical models for exploration. Research mode is where assumptions, diagnostics and limitations must be made explicit.</p>
        <Button variant="secondary" onClick={onResearch}>Inspect the research layer <Microscope size={16} /></Button>
      </div>
    </section>
  );
}
