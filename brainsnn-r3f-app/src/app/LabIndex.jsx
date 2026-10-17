import React from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
const EXPERIMENTS = [
  ['/play', 'Sapient Playground', 'Poke, drag and shake the jelly brain simulation.'],
  ['/lab/powder', 'Neuro Powder Lab', 'Draw circuits and explore a falling-sand world.'],
  ['/arcade', 'Arcade', 'Explore interactive physics, living systems and content experiments.'],
  ['/toys/fool-the-detector', 'Fool the Detector', 'Try to slip persuasive wording past the detector.'],
  ['/toys/draft-duel', 'Draft Duel', 'Compare the cues in two short drafts.'],
  ['/toys/defend-the-brain', 'Defend the Brain', 'Play a defense game driven by cues in your text.'],
  ['/coherence', 'Video research', 'Inspect a fixed correction pass, its baselines and failed quality gates.'],
  ['/lab/survival', 'Survival world', 'Explore a finite synthetic world and its recorded outcomes.'],
];
export function LabIndex() {
  return <div className="bh-site"><PublicNav active="lab" /><main className="lab-index">
    <p className="bh-kicker">Experiments</p><h1>Lab</h1><p>A place to play with the mechanisms. These experiments describe their simulated conditions.</p>
    <div className="lab-cards">{EXPERIMENTS.map(([href, title, description]) => <a className="lab-card" key={href} href={href}><h2>{title}</h2><p>{description}</p><span>Open experiment →</span></a>)}</div>
  </main><PublicFooter /></div>;
}
