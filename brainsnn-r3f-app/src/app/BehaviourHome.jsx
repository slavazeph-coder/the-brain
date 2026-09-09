import React, { useEffect } from 'react';
import { ArrowRight, Beaker, FileText, GitCompareArrows, Sparkles, Trophy } from 'lucide-react';
import { track } from '../lib/analytics.js';
import '../styles/behaviour-home.css';

const TOOLS = [
  { icon: FileText, label: 'Analyze', title: 'Find the signal.', description: 'Bring a draft, page or screen recording. See what deserves a closer look.', href: '/app', action: 'Analyze content' },
  { icon: GitCompareArrows, label: 'Compare', title: 'Test the change.', description: 'Put two drafts side by side. Inspect what changed and keep the evidence.', href: '/engine', action: 'Compare drafts' },
  { icon: Trophy, label: 'Missions', title: 'Give it a goal.', description: 'Explore bounded tasks with clear rules, a judge and recorded attempts.', href: '/missions', action: 'Run a mission' },
];

function MissionPreview() {
  return <aside className="bh-world bh-mission-preview" aria-labelledby="bh-preview-title">
    <div className="bh-world-top"><span><Beaker size={14} aria-hidden="true"/> A WORLD TO EXPLORE</span><strong>SIMULATION</strong></div>
    <div className="bh-preview-body">
      <p className="bh-kicker">PROOF MISSION 001</p>
      <h2 id="bh-preview-title">Can an agent<br/>respect a limit?</h2>
      <p>Resolve synthetic refund requests. Ask for approval above $500. Inspect the resulting ledger.</p>
      <a className="bh-button bh-secondary" href="/missions/refund-authority">Explore the mission <ArrowRight size={16} aria-hidden="true"/></a>
    </div>
  </aside>;
}

export function BehaviourHome() {
  useEffect(() => { document.title = 'BrainSNN | Sapient Playground'; track('behaviour_home_viewed'); }, []);
  return <div className="bh-site bh-home-simple">
    <a className="bh-skip" href="#bh-main">Skip to content</a>
    <header className="bh-nav">
      <a className="bh-brand" href="/" aria-label="BrainSNN home"><span className="bh-mark" aria-hidden="true">B</span><span><strong>BrainSNN</strong><small>Sapient Playground</small></span></a>
      <nav aria-label="Main navigation"><a href="#tools">The engine</a><a href="/arcade">Playground</a><a href="/evidence">Evidence</a></nav>
      <a className="bh-nav-cta" href="/app">Open BrainSNN <ArrowRight size={15} aria-hidden="true"/></a>
    </header>
    <main id="bh-main">
      <section className="bh-hero" aria-labelledby="bh-hero-title">
        <div className="bh-hero-copy">
          <p className="bh-kicker"><Sparkles size={15} aria-hidden="true"/> A PLAYGROUND FOR MACHINE INTELLIGENCE</p>
          <h1 id="bh-hero-title">Build a mind.{' '}<br/>Give it a world.{' '}<br/><span>Give it a mission.</span></h1>
          <p className="bh-lead">Analyze a draft, compare a change, or explore a world. Turn an idea into something you can test.</p>
          <div className="bh-actions"><a className="bh-button bh-primary" href="/app">Open BrainSNN <ArrowRight size={17} aria-hidden="true"/></a><a className="bh-button bh-secondary" href="/arcade">Explore worlds <ArrowRight size={16} aria-hidden="true"/></a></div>
        </div>
        <MissionPreview/>
      </section>
      <section className="bh-tools-section" id="tools" aria-labelledby="bh-tools-title">
        <div className="bh-section-copy"><p className="bh-kicker">START WITH SOMETHING USEFUL</p><h2 id="bh-tools-title">An idea. A test. A next step.</h2></div>
        <div className="bh-products">
          {TOOLS.map(({ icon: Icon, label, title, description, href, action }, index) => <article className={`bh-product ${index === 0 ? 'bh-product-primary' : ''}`} key={href}>
            <p className="bh-kicker"><Icon size={16} aria-hidden="true"/>{label}</p><h3>{title}</h3><p>{description}</p><a href={href}>{action} <ArrowRight size={16} aria-hidden="true"/></a>
          </article>)}
        </div>
      </section>
      <section className="bh-evidence-note" aria-labelledby="bh-evidence-title"><div><p className="bh-kicker">OPEN TO INSPECTION</p><h2 id="bh-evidence-title">The evidence stays in view.</h2><p>Scores are signals. Explore the benchmark and its limits before deciding what a result means.</p></div><a className="bh-button bh-secondary" href="/evidence">Inspect evidence <ArrowRight size={16} aria-hidden="true"/></a></section>
    </main>
    <footer className="bh-footer"><span>BrainSNN · Sapient Playground</span><nav aria-label="More BrainSNN"><a href="/lab">Neuro Powder Lab</a><a href="/engine#api">For developers</a><a href="/office">Agent office</a></nav></footer>
  </div>;
}
