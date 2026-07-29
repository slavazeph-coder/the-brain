import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Brain, BrainCircuit, Bug, Car, CircleDot, Dna, Gauge, Grid3X3, Leaf, Orbit, Shield, Shuffle, Sparkles, Waves, Wind } from 'lucide-react';
import { ArcadeProgress, useArcadeProgress } from './ArcadeProgress.jsx';
import { track } from '../../lib/analytics.js';
import '../../styles/arcade.css';
import '../../styles/deep-arcade.css';
import '../../styles/fun-arcade.css';

function lazyNamed(loader, exportName) {
  return lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const LAB_COMPONENTS = {
  attractor: lazyNamed(() => import('./AttractorPlayground.jsx'), 'AttractorPlayground'),
  fireflies: lazyNamed(() => import('./CollectivePlaygrounds.jsx'), 'FireflySyncLab'),
  waves: lazyNamed(() => import('./CollectivePlaygrounds.jsx'), 'WaveInterferenceLab'),
  reaction: lazyNamed(() => import('./CollectivePlaygrounds.jsx'), 'ReactionDiffusionLab'),
  gravity: lazyNamed(() => import('./PhysicsPlaygrounds.jsx'), 'GravityForgeLab'),
  flock: lazyNamed(() => import('./AgentPlaygrounds.jsx'), 'FlockMindLab'),
  outbreak: lazyNamed(() => import('./AgentPlaygrounds.jsx'), 'OutbreakZeroLab'),
  pendulum: lazyNamed(() => import('./PhysicsPlaygrounds.jsx'), 'ChaosTwinsLab'),
  ants: lazyNamed(() => import('./PlayfulPlaygrounds.jsx'), 'AntTrailLab'),
  traffic: lazyNamed(() => import('./PlayfulPlaygrounds.jsx'), 'TrafficTamerLab'),
  life: lazyNamed(() => import('./WorldPlaygrounds.jsx'), 'LifePainterLab'),
  ecosystem: lazyNamed(() => import('./WorldPlaygrounds.jsx'), 'EcosystemBalanceLab'),
  content: lazyNamed(() => import('./ContentReactionLab.jsx'), 'ContentReactionLab'),
  braingame: lazyNamed(() => import('./BrainGameLab.jsx'), 'BrainGameLab'),
};

const EXPERIMENTS = [
  { id: 'attractor', number: '001', title: 'Butterfly Effect', short: 'Shape chaos', description: 'Tune a Lorenz system until order and turbulence balance on the same orbit.', icon: Gauge, accent: 'cyan', mechanic: 'Tune', category: 'physics', featured: true },
  { id: 'fireflies', number: '002', title: 'Firefly Sync', short: 'Create collective rhythm', description: 'Give hundreds of independent clocks one weak connection and watch a shared pulse emerge.', icon: Sparkles, accent: 'lime', mechanic: 'Synchronize', category: 'systems', featured: true },
  { id: 'waves', number: '003', title: 'Wave Eraser', short: 'Find perfect silence', description: 'Move through two overlapping waves and hunt for the places where energy disappears.', icon: Waves, accent: 'violet', mechanic: 'Explore', category: 'physics' },
  { id: 'reaction', number: '004', title: 'Living Chemistry', short: 'Draw a new species', description: 'Paint two virtual chemicals and grow coral, cells, worms and mazes from local reactions.', icon: Dna, accent: 'pink', mechanic: 'Create', category: 'life' },
  { id: 'gravity', number: '005', title: 'Gravity Forge', short: 'Build a solar system', description: 'Launch planets into a live n-body field and see whether your orbital architecture survives.', icon: Orbit, accent: 'amber', mechanic: 'Construct', category: 'physics' },
  { id: 'flock', number: '006', title: 'Flock Mind', short: 'Steer emergence', description: 'Act as predator or beacon while leaderless agents coordinate through only local rules.', icon: Wind, accent: 'blue', mechanic: 'Influence', category: 'systems' },
  { id: 'outbreak', number: '007', title: 'Outbreak Zero', short: 'Contain the network', description: 'Choose patient zero, spend twelve vaccines and break the transmission graph before it turns red.', icon: Shield, accent: 'red', mechanic: 'Intervene', category: 'society' },
  { id: 'pendulum', number: '008', title: 'Chaos Twins', short: 'Race two futures', description: 'Start two double pendulums almost identically and measure how quickly their futures separate.', icon: CircleDot, accent: 'orange', mechanic: 'Predict', category: 'physics' },
  { id: 'ants', number: '009', title: 'Ant Trail Architect', short: 'Design without a planner', description: 'Place food and barriers while a leaderless colony discovers and reinforces efficient routes.', icon: Bug, accent: 'mint', mechanic: 'Route', category: 'life', featured: true },
  { id: 'traffic', number: '010', title: 'Traffic Tamer', short: 'Beat the intersection', description: 'Control signal phases under rising demand and keep every queue from becoming a citywide jam.', icon: Car, accent: 'yellow', mechanic: 'Control', category: 'society', featured: true },
  { id: 'life', number: '011', title: 'Life Painter', short: 'Paint computation', description: 'Draw living cells and let four tiny rules transform them into moving, evolving machines.', icon: Grid3X3, accent: 'teal', mechanic: 'Invent', category: 'systems' },
  { id: 'ecosystem', number: '012', title: 'Ecosystem Keeper', short: 'Balance a living world', description: 'Add energy, prey or predators and keep the entire food web alive through delayed feedback.', icon: Leaf, accent: 'green', mechanic: 'Balance', category: 'life' },
  { id: 'content', number: '013', title: 'Mind-Hack Autopsy', short: 'Scan viral content', description: 'Paste an ad, tweet or email and watch a live brain react — attention, trust, emotional charge and manipulation risk.', icon: BrainCircuit, accent: 'violet', mechanic: 'Decode', category: 'society', featured: true },
  { id: 'braingame', number: '014', title: 'Defend the Brain', short: 'Hold the loop', description: 'Pressure ramps into the threat loop. Cut, lesion or stimulate to keep judgment online before the gate is taken.', icon: Brain, accent: 'red', mechanic: 'Defend', category: 'systems', featured: true },
];

const FILTERS = [
  { id: 'featured', label: 'Start here' },
  { id: 'all', label: 'All 14' },
  { id: 'physics', label: 'Physics' },
  { id: 'life', label: 'Life' },
  { id: 'systems', label: 'Complex systems' },
  { id: 'society', label: 'Society' },
];

function initialExperiment() {
  if (typeof window === 'undefined') return 'attractor';
  const requested = new URLSearchParams(window.location.search).get('lab');
  return EXPERIMENTS.some((experiment) => experiment.id === requested) ? requested : 'attractor';
}

function initialFilter() {
  if (typeof window === 'undefined') return 'featured';
  const query = new URLSearchParams(window.location.search);
  const requested = query.get('group');
  if (FILTERS.some((filter) => filter.id === requested)) return requested;
  return query.get('lab') ? 'all' : 'featured';
}

function LabLoading({ title }) {
  return (
    <div className="gg-lab-loading" role="status" aria-live="polite">
      <span />
      <strong>Loading {title}</strong>
      <small>Only the selected experiment is being loaded.</small>
    </div>
  );
}

export function ExperimentArcade({ onOpenScanner }) {
  const [active, setActive] = useState(initialExperiment);
  const [filter, setFilter] = useState(initialFilter);
  const cardRefs = useRef(new Map());
  const activeExperiment = useMemo(() => EXPERIMENTS.find((experiment) => experiment.id === active) || EXPERIMENTS[0], [active]);
  const visibleExperiments = useMemo(() => {
    if (filter === 'all') return EXPERIMENTS;
    if (filter === 'featured') return EXPERIMENTS.filter((experiment) => experiment.featured);
    return EXPERIMENTS.filter((experiment) => experiment.category === filter);
  }, [filter]);
  const { progress, recordVisit, dailyLab, level, levelProgress, achievements } = useArcadeProgress(EXPERIMENTS);
  const ActiveLab = LAB_COMPONENTS[active] || LAB_COMPONENTS.attractor;

  useEffect(() => { recordVisit(active); }, [active, recordVisit]);

  useEffect(() => {
    function selectFromEvent(event) {
      const next = event.detail?.lab;
      if (EXPERIMENTS.some((experiment) => experiment.id === next)) {
        setFilter('all');
        setActive(next);
      }
    }
    window.addEventListener('gaugegap:lab', selectFromEvent);
    return () => window.removeEventListener('gaugegap:lab', selectFromEvent);
  }, []);

  function selectExperiment(id, scroll = true) {
    const experiment = EXPERIMENTS.find((entry) => entry.id === id);
    setActive(id);
    track('gaugegap_lab_selected', { labId: id, category: experiment?.category || 'unknown' });
    const url = new URL(window.location.href);
    url.searchParams.set('lab', id);
    url.searchParams.set('group', filter);
    if (id !== 'attractor') url.searchParams.delete('run');
    url.searchParams.delete('state');
    url.hash = 'playground';
    window.history.replaceState({}, '', url);
    if (scroll) window.requestAnimationFrame(() => document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function chooseFilter(nextFilter) {
    setFilter(nextFilter);
    track('gaugegap_filter_selected', { filter: nextFilter });
    const nextVisible = nextFilter === 'all'
      ? EXPERIMENTS
      : nextFilter === 'featured'
        ? EXPERIMENTS.filter((experiment) => experiment.featured)
        : EXPERIMENTS.filter((experiment) => experiment.category === nextFilter);
    if (!nextVisible.some((experiment) => experiment.id === active) && nextVisible[0]) setActive(nextVisible[0].id);
    const url = new URL(window.location.href);
    url.searchParams.set('group', nextFilter);
    window.history.replaceState({}, '', url);
  }

  function surpriseMe() {
    const available = EXPERIMENTS.filter((experiment) => experiment.id !== active);
    setFilter('all');
    const next = available[Math.floor(Math.random() * available.length)];
    track('gaugegap_surprise_clicked', { labId: next.id });
    selectExperiment(next.id);
  }

  function handleCardKeyDown(event, id) {
    const currentIndex = visibleExperiments.findIndex((experiment) => experiment.id === id);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % visibleExperiments.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + visibleExperiments.length) % visibleExperiments.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = visibleExperiments.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const next = visibleExperiments[nextIndex];
    selectExperiment(next.id, false);
    window.requestAnimationFrame(() => cardRefs.current.get(next.id)?.focus());
  }

  return (
    <section id="playground" className="gg-arcade" aria-labelledby="gg-arcade-title">
      <div className="gg-arcade-intro">
        <div>
          <p className="gg-kicker"><Activity size={16} /> GaugeGap science arcade</p>
          <h2 id="gg-arcade-title">Start with six. Explore all fourteen when you are ready.</h2>
          <p>The stranger-friendly route shows the strongest first experiences. Filters reveal the full library without making the first visit feel like a wall of choices.</p>
        </div>
        <button type="button" className="gg-surprise-button" onClick={surpriseMe}><Shuffle size={16} /> Surprise me</button>
      </div>

      <ArcadeProgress progress={progress} level={level} levelProgress={levelProgress} achievements={achievements} dailyLab={dailyLab} onOpenDaily={() => { setFilter('all'); selectExperiment(dailyLab.id); }} />

      <div className="gg-arcade-filters" aria-label="Filter experiments">
        {FILTERS.map((entry) => (
          <button key={entry.id} type="button" className={filter === entry.id ? 'active' : ''} aria-pressed={filter === entry.id} onClick={() => chooseFilter(entry.id)}>{entry.label}</button>
        ))}
        <span>{visibleExperiments.length} shown</span>
      </div>

      <div className="gg-arcade-selector" role="tablist" aria-label="Playable experiments">
        {visibleExperiments.map((experiment) => {
          const Icon = experiment.icon;
          const selected = experiment.id === active;
          const visited = progress.visited.includes(experiment.id);
          return (
            <button
              key={experiment.id}
              ref={(node) => { if (node) cardRefs.current.set(experiment.id, node); else cardRefs.current.delete(experiment.id); }}
              type="button"
              role="tab"
              tabIndex={selected ? 0 : -1}
              aria-selected={selected}
              aria-controls="gg-active-lab"
              className={`gg-arcade-card gg-arcade-card-${experiment.accent} ${selected ? 'active' : ''} ${visited ? 'visited' : ''}`}
              onClick={() => selectExperiment(experiment.id, false)}
              onKeyDown={(event) => handleCardKeyDown(event, experiment.id)}
            >
              <span className="gg-arcade-card-number">{experiment.number}</span>
              <span className="gg-arcade-card-icon"><Icon size={22} /></span>
              <strong>{experiment.title}</strong>
              <small>{experiment.short}</small>
              <p>{experiment.description}</p>
              <em>{visited ? 'Explored' : experiment.mechanic}</em>
            </button>
          );
        })}
      </div>

      <div id="gg-active-lab" role="tabpanel" className="gg-arcade-stage" data-experiment={activeExperiment.id} aria-label={`${activeExperiment.title} experiment`}>
        <div className="gg-arcade-stage-topline"><span><i /> Experiment {activeExperiment.number} loaded</span><strong>{activeExperiment.title}</strong></div>
        <Suspense fallback={<LabLoading title={activeExperiment.title} />}>
          <ActiveLab {...(active === 'content' ? { onOpenScanner } : {})} />
        </Suspense>
      </div>

      <div className="gg-arcade-lesson">
        <span>Designed for a first-time visitor</span>
        <strong>Four recommended starts</strong><strong>Topic filters</strong><strong>Keyboard navigation</strong><strong>On-demand loading</strong><strong>Shareable challenges</strong>
      </div>
    </section>
  );
}
