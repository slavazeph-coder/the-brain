import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Bug, Car, CircleDot, Dna, Gauge, Grid3X3, Leaf, Orbit, Shield, Shuffle, Sparkles, Waves, Wind } from 'lucide-react';
import { AttractorPlayground } from './AttractorPlayground.jsx';
import { FireflySyncLab, ReactionDiffusionLab, WaveInterferenceLab } from './CollectivePlaygrounds.jsx';
import { FlockMindLab, OutbreakZeroLab } from './AgentPlaygrounds.jsx';
import { ChaosTwinsLab, GravityForgeLab } from './PhysicsPlaygrounds.jsx';
import { AntTrailLab, TrafficTamerLab } from './PlayfulPlaygrounds.jsx';
import { EcosystemBalanceLab, LifePainterLab } from './WorldPlaygrounds.jsx';
import { ArcadeProgress, useArcadeProgress } from './ArcadeProgress.jsx';
import '../../styles/arcade.css';
import '../../styles/deep-arcade.css';
import '../../styles/fun-arcade.css';

const EXPERIMENTS = [
  { id: 'attractor', number: '001', title: 'Butterfly Effect', short: 'Shape chaos', description: 'Tune a Lorenz system until order and turbulence balance on the same orbit.', icon: Gauge, accent: 'cyan', mechanic: 'Tune' },
  { id: 'fireflies', number: '002', title: 'Firefly Sync', short: 'Create collective rhythm', description: 'Give hundreds of independent clocks one weak connection and watch a shared pulse emerge.', icon: Sparkles, accent: 'lime', mechanic: 'Synchronize' },
  { id: 'waves', number: '003', title: 'Wave Eraser', short: 'Find perfect silence', description: 'Move through two overlapping waves and hunt for the places where energy disappears.', icon: Waves, accent: 'violet', mechanic: 'Explore' },
  { id: 'reaction', number: '004', title: 'Living Chemistry', short: 'Draw a new species', description: 'Paint two virtual chemicals and grow coral, cells, worms and mazes from local reactions.', icon: Dna, accent: 'pink', mechanic: 'Create' },
  { id: 'gravity', number: '005', title: 'Gravity Forge', short: 'Build a solar system', description: 'Launch planets into a live n-body field and see whether your orbital architecture survives.', icon: Orbit, accent: 'amber', mechanic: 'Construct' },
  { id: 'flock', number: '006', title: 'Flock Mind', short: 'Steer emergence', description: 'Act as predator or beacon while leaderless agents coordinate through only local rules.', icon: Wind, accent: 'blue', mechanic: 'Influence' },
  { id: 'outbreak', number: '007', title: 'Outbreak Zero', short: 'Contain the network', description: 'Choose patient zero, spend twelve vaccines and break the transmission graph before it turns red.', icon: Shield, accent: 'red', mechanic: 'Intervene' },
  { id: 'pendulum', number: '008', title: 'Chaos Twins', short: 'Race two futures', description: 'Start two double pendulums almost identically and measure how quickly their futures separate.', icon: CircleDot, accent: 'orange', mechanic: 'Predict' },
  { id: 'ants', number: '009', title: 'Ant Trail Architect', short: 'Design without a planner', description: 'Place food and barriers while a leaderless colony discovers and reinforces efficient routes.', icon: Bug, accent: 'mint', mechanic: 'Route' },
  { id: 'traffic', number: '010', title: 'Traffic Tamer', short: 'Beat the intersection', description: 'Control signal phases under rising demand and keep every queue from becoming a citywide jam.', icon: Car, accent: 'yellow', mechanic: 'Control' },
  { id: 'life', number: '011', title: 'Life Painter', short: 'Paint computation', description: 'Draw living cells and let four tiny rules transform them into moving, evolving machines.', icon: Grid3X3, accent: 'teal', mechanic: 'Invent' },
  { id: 'ecosystem', number: '012', title: 'Ecosystem Keeper', short: 'Balance a living world', description: 'Add energy, prey or predators and keep the entire food web alive through delayed feedback.', icon: Leaf, accent: 'green', mechanic: 'Balance' },
];

function initialExperiment() {
  if (typeof window === 'undefined') return 'attractor';
  const requested = new URLSearchParams(window.location.search).get('lab');
  return EXPERIMENTS.some((experiment) => experiment.id === requested) ? requested : 'attractor';
}

export function ExperimentArcade() {
  const [active, setActive] = useState(initialExperiment);
  const activeExperiment = useMemo(() => EXPERIMENTS.find((experiment) => experiment.id === active) || EXPERIMENTS[0], [active]);
  const { progress, recordVisit, dailyLab, level, levelProgress, achievements } = useArcadeProgress(EXPERIMENTS);

  useEffect(() => { recordVisit(active); }, [active, recordVisit]);

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
    if (scroll) window.requestAnimationFrame(() => document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
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
          <h2 id="gg-arcade-title">Twelve experiments. Twelve ways to play with reality.</h2>
          <p>Tune, synchronize, explore, draw, construct, influence, intervene, predict, route, control, invent and balance. The library now behaves like an arcade—not a catalogue of charts.</p>
        </div>
        <button type="button" className="gg-surprise-button" onClick={surpriseMe}><Shuffle size={16} /> Surprise me</button>
      </div>

      <ArcadeProgress progress={progress} level={level} levelProgress={levelProgress} achievements={achievements} dailyLab={dailyLab} onOpenDaily={() => selectExperiment(dailyLab.id)} />

      <div className="gg-arcade-selector" role="tablist" aria-label="Playable experiments">
        {EXPERIMENTS.map((experiment) => {
          const Icon = experiment.icon;
          const selected = experiment.id === active;
          const visited = progress.visited.includes(experiment.id);
          return (
            <button key={experiment.id} type="button" role="tab" aria-selected={selected} className={`gg-arcade-card gg-arcade-card-${experiment.accent} ${selected ? 'active' : ''} ${visited ? 'visited' : ''}`} onClick={() => selectExperiment(experiment.id, false)}>
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

      <div className="gg-arcade-stage" data-experiment={activeExperiment.id}>
        <div className="gg-arcade-stage-topline"><span><i /> Experiment {activeExperiment.number} loaded</span><strong>{activeExperiment.title}</strong></div>
        {active === 'attractor' ? <AttractorPlayground /> : null}
        {active === 'fireflies' ? <FireflySyncLab /> : null}
        {active === 'waves' ? <WaveInterferenceLab /> : null}
        {active === 'reaction' ? <ReactionDiffusionLab /> : null}
        {active === 'gravity' ? <GravityForgeLab /> : null}
        {active === 'flock' ? <FlockMindLab /> : null}
        {active === 'outbreak' ? <OutbreakZeroLab /> : null}
        {active === 'pendulum' ? <ChaosTwinsLab /> : null}
        {active === 'ants' ? <AntTrailLab /> : null}
        {active === 'traffic' ? <TrafficTamerLab /> : null}
        {active === 'life' ? <LifePainterLab /> : null}
        {active === 'ecosystem' ? <EcosystemBalanceLab /> : null}
      </div>

      <div className="gg-arcade-lesson">
        <span>The retention layer now adds</span>
        <strong>Daily missions</strong><strong>XP and levels</strong><strong>Visit streaks</strong><strong>Achievements</strong><strong>Twelve tactile mechanics</strong>
      </div>
    </section>
  );
}
