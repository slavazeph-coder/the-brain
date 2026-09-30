import React, { useEffect } from 'react';
import { ArrowRight, FileText, GitCompareArrows, Trophy } from 'lucide-react';
import { track } from '../lib/analytics.js';
import { PokeBrain } from '../features/toys/poke/PokeBrain.jsx';
import { BhFooter, BhNav, BrainsnnStrip, MoreToys } from '../features/toys/ToyChrome.jsx';
import '../styles/behaviour-home.css';

const TOOLS = [
  { icon: FileText, label: 'Analyze', title: 'Find the signal.', description: 'Bring a draft, page or screen recording. See what deserves a closer look.', href: '/app', action: 'Analyze content' },
  { icon: GitCompareArrows, label: 'Compare', title: 'Test the change.', description: 'Put two drafts side by side. Inspect what changed and keep the evidence.', href: '/engine', action: 'Compare drafts' },
  { icon: Trophy, label: 'Missions', title: 'Give it a goal.', description: 'Explore bounded tasks with clear rules, a judge and recorded attempts.', href: '/missions', action: 'Run a mission' },
];

// Toys are the front door; the Sapient Playground workspace is one scroll
// below, unchanged. The page keeps the restored cyan/violet identity.
export function BehaviourHome() {
  useEffect(() => { document.title = 'BrainSNN | Sapient Playground'; track('behaviour_home_viewed'); }, []);
  return <div className="bh-site bh-home-simple">
    <a className="bh-skip" href="#bh-main">Skip to content</a>
    <BhNav />
    <main id="bh-main">
      <PokeBrain />
      <MoreToys currentId="poke" />
      <section className="bh-tools-section" id="tools" aria-labelledby="bh-tools-title">
        <div className="bh-section-copy bh-tools-head">
          <p className="bh-kicker">THE SAPIENT PLAYGROUND</p>
          <h2 id="bh-tools-title">Build a mind. Give it a world. <span>Give it a mission.</span></h2>
          <p>Analyze a draft, compare a change, or explore a world. Turn an idea into something you can test.</p>
          <a className="bh-button bh-secondary" href="/arcade">Explore worlds <ArrowRight size={16} aria-hidden="true"/></a>
        </div>
        <div className="bh-products">
          {TOOLS.map(({ icon: Icon, label, title, description, href, action }, index) => <article className={`bh-product ${index === 0 ? 'bh-product-primary' : ''}`} key={href}>
            <p className="bh-kicker"><Icon size={16} aria-hidden="true"/>{label}</p><h3>{title}</h3><p>{description}</p><a href={href}>{action} <ArrowRight size={16} aria-hidden="true"/></a>
          </article>)}
        </div>
      </section>
      <section className="bh-evidence-note" aria-labelledby="bh-evidence-title"><div><p className="bh-kicker">OPEN TO INSPECTION</p><h2 id="bh-evidence-title">The evidence stays in view.</h2><p>Scores are signals. Explore the benchmark and its limits before deciding what a result means.</p></div><a className="bh-button bh-secondary" href="/evidence">Inspect evidence <ArrowRight size={16} aria-hidden="true"/></a></section>
      <BrainsnnStrip />
    </main>
    <BhFooter />
  </div>;
}
