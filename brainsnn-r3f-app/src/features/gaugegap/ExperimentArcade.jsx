import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Dna, Gauge, Shuffle, Sparkles, Waves } from 'lucide-react';
import { AttractorPlayground } from './AttractorPlayground.jsx';
import { FireflySyncLab, ReactionDiffusionLab, WaveInterferenceLab } from './CollectivePlaygrounds.jsx';
import '../../styles/arcade.css';

const EXPERIMENTS = [
  {
    id: 'attractor',
    number: '001',
    title: 'Butterfly Effect',
    short: 'Shape chaos',
    description: 'Tune a Lorenz system until order and turbulence balance on the same orbit.',
    icon: Gauge,
    accent: 'cyan',
    mechanic: 'Tune',
  },
  {
    id: 'fireflies',
    number: '002',
    title: 'Firefly Sync',
    short: 'Create collective rhythm',
    description: 'Give hundreds of independent clocks one weak connection and watch a shared pulse emerge.',
    icon: Sparkles,
    accent: 'lime',
    mechanic: 'Synchronize',
  },
  {
    id: 'waves',
    number: '003',
    title: 'Wave Eraser',
    short: 'Find perfect silence',
    description: 'Move through two overlapping waves and hunt for the places where energy disappears.',
    icon: Waves,
    accent: 'violet',
    mechanic: 'Explore',
  },
  {
    id: 'reaction',
    number: '004',
    title: 'Living Chemistry',
    short: 'Draw a new species',
    description: 'Paint two virtual chemicals and grow coral, cells, worms and mazes from local reactions.',
    icon: Dna,
    accent: 'pink',
    mechanic: 'Create',
  },
];

function initialExperiment() {
  if (typeof window === 'undefined') return 'attractor';
  const requested = new URLSearchParams(window.location.search).get('lab');
  return EXPERIMENTS.some((experiment) => experiment.id === requested) ? requested : 'attractor';
}

export function ExperimentArcade() {
  const [active, setActive] = useState(initialExperiment);
  const activeExperiment = useMemo(() => EXPERIMENTS.find((experiment) => experiment.id === active) || EXPERIMENTS[0], [active]);

  useEffect(() => {
    function selectFromEvent(event) {
      const next = event.detail?.lab;
      if (EXPERIMENTS.some((experiment) => experiment.id === next)) setActive(next);
    }
    window.addEventListener('gaugegap:lab', selectFromEvent);
    return () => window.removeEventListener('gaugegap:lab', selectFromEvent);
  }, []);

  function selectExperiment(id, scroll = true) {
    setActive(id);
    const url = new URL(window.location.href);
    url.searchParams.set('lab', id);
    if (id !== 'attractor') url.searchParams.delete('run');
    url.searchParams.delete('state');
    url.hash = 'playground';
    window.history.replaceState({}, '', url);
    if (scroll) {
      window.requestAnimationFrame(() => document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  function surpriseMe() {
    const available = EXPERIMENTS.filter((experiment) => experiment.id !== active);
    selectExperiment(available[Math.floor(Math.random() * available.length)].id);
  }

  return (
    <section id="playground" className="gg-arcade" aria-labelledby="gg-arcade-title">
      <div className="gg-arcade-intro">
        <div>
          <p className="gg-kicker"><Activity size={16} /> GaugeGap science arcade</p>
          <h2 id="gg-arcade-title">Four experiments. Four different ways to play.</h2>
          <p>Tune chaos, synchronize a crowd, erase a wave or draw living chemistry. Every lab starts in seconds and hides the real model one layer underneath.</p>
        </div>
        <button type="button" className="gg-surprise-button" onClick={surpriseMe}><Shuffle size={16} /> Surprise me</button>
      </div>

      <div className="gg-arcade-selector" role="tablist" aria-label="Playable experiments">
        {EXPERIMENTS.map((experiment) => {
          const Icon = experiment.icon;
          const selected = experiment.id === active;
          return (
            <button
              key={experiment.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`gg-arcade-card gg-arcade-card-${experiment.accent} ${selected ? 'active' : ''}`}
              onClick={() => selectExperiment(experiment.id, false)}
            >
              <span className="gg-arcade-card-number">{experiment.number}</span>
              <span className="gg-arcade-card-icon"><Icon size={22} /></span>
              <strong>{experiment.title}</strong>
              <small>{experiment.short}</small>
              <p>{experiment.description}</p>
              <em>{experiment.mechanic}</em>
            </button>
          );
        })}
      </div>

      <div className="gg-arcade-stage" data-experiment={activeExperiment.id}>
        <div className="gg-arcade-stage-topline">
          <span><i /> Experiment {activeExperiment.number} loaded</span>
          <strong>{activeExperiment.title}</strong>
        </div>
        {active === 'attractor' ? <AttractorPlayground /> : null}
        {active === 'fireflies' ? <FireflySyncLab /> : null}
        {active === 'waves' ? <WaveInterferenceLab /> : null}
        {active === 'reaction' ? <ReactionDiffusionLab /> : null}
      </div>

      <div className="gg-arcade-lesson">
        <span>What we borrowed from the best interactive-science sites</span>
        <strong>Immediate motion</strong>
        <strong>Recognizable presets</strong>
        <strong>One clear challenge</strong>
        <strong>Different interaction styles</strong>
        <strong>A shareable result</strong>
      </div>
    </section>
  );
}
