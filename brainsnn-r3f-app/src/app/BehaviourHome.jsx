import React, { useEffect } from 'react';
import { ArrowRight, Beaker, BrainCircuit, GitFork, Play, ShieldCheck, Sparkles, Workflow } from 'lucide-react';
import { track } from '../lib/analytics.js';
import '../styles/behaviour-home.css';

const SURVIVAL_PATH = '/lab/survival';

function go(path, eventName) {
  track(eventName, { path });
  window.location.assign(path);
}

function WorldPreview() {
  const agents = [
    ['Aster', 72, 19], ['Beryl', 48, 31], ['Cato', 78, 47], ['Dara', 57, 68], ['Elio', 31, 75],
    ['Faye', 18, 52], ['Galen', 27, 28], ['Hana', 48, 55], ['Ivo', 68, 72], ['Juno', 57, 20],
  ];
  return (
    <div className="bh-world" aria-label="Preview of Survival World">
      <div className="bh-world-top"><span><i /> LIVE EXPERIMENT</span><strong>WORLD 001 · DAY 18 / 30</strong></div>
      <div className="bh-world-field">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <path d="M72 19 L57 20 L48 31 L27 28 L18 52 L31 75 L57 68 L68 72 L78 47 L48 55 Z" />
          <path d="M48 31 L48 55 L57 68 M78 47 L57 68 M27 28 L48 55 M72 19 L78 47" />
        </svg>
        {agents.map(([name, x, y], index) => (
          <span key={name} className={`bh-agent bh-agent-${index + 1}`} style={{ left: `${x}%`, top: `${y}%` }}>
            <b>{name.slice(0, 1)}</b><em>{name}</em>
          </span>
        ))}
        <div className="bh-fork-line"><GitFork size={15} /><span>Fork available at any day</span></div>
      </div>
      <div className="bh-world-stats">
        <div><span>Survival</span><strong>80%</strong></div>
        <div><span>Cooperation</span><strong>41%</strong></div>
        <div><span>Violations</span><strong>7</strong></div>
        <div><span>Inequality</span><strong>0.28</strong></div>
      </div>
    </div>
  );
}

export function BehaviourHome() {
  useEffect(() => {
    document.title = 'BrainSNN | Experiments on Machine Behaviour';
    track('behaviour_home_viewed');
  }, []);

  return (
    <div className="bh-site">
      <header className="bh-nav">
        <a className="bh-brand" href="/" aria-label="BrainSNN home"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Behaviour Lab</small></span></a>
        <nav aria-label="Primary navigation">
          <a href={SURVIVAL_PATH}>Lab</a>
          <a href="/arcade">Worlds</a>
          <a href="/evidence">Evidence</a>
          <a href="/app">Creative Engine</a>
        </nav>
        <button type="button" className="bh-nav-cta" onClick={() => go(SURVIVAL_PATH, 'behaviour_nav_run_clicked')}>Run experiment <ArrowRight size={15} /></button>
      </header>

      <main>
        <section className="bh-hero">
          <div className="bh-hero-copy">
            <p className="bh-kicker"><Sparkles size={15} /> Reproducible experiments on machine behaviour</p>
            <h1>Build a mind.<br />Give it a world.<br /><span>Change one thing.</span></h1>
            <p className="bh-lead">BrainSNN lets you run autonomous systems through controlled simulated worlds, replay the same conditions, fork one variable and inspect exactly where behaviour changes.</p>
            <div className="bh-actions">
              <button type="button" className="bh-button bh-primary" onClick={() => go(SURVIVAL_PATH, 'behaviour_hero_run_clicked')}><Play size={17} /> Run Survival World</button>
              <a className="bh-button bh-secondary" href="/arcade">Explore public worlds <ArrowRight size={16} /></a>
            </div>
            <p className="bh-boundary">Finite simulation, reproducible evidence and explicit claim boundaries. Results describe tested conditions — not universal AI safety or guaranteed real-world behaviour.</p>
          </div>
          <WorldPreview />
        </section>

        <section className="bh-thesis" aria-label="BrainSNN method">
          <div><BrainCircuit size={19} /><span>MIND</span><strong>Model · prompt · memory · tools</strong></div>
          <ArrowRight className="bh-thesis-arrow" size={18} />
          <div><Workflow size={19} /><span>WORLD</span><strong>Rules · resources · actors · events</strong></div>
          <ArrowRight className="bh-thesis-arrow" size={18} />
          <div><GitFork size={19} /><span>INTERVENTION</span><strong>Change one variable · rerun</strong></div>
          <ArrowRight className="bh-thesis-arrow" size={18} />
          <div><ShieldCheck size={19} /><span>EVIDENCE</span><strong>Trace · metrics · ProofPack</strong></div>
        </section>

        <section className="bh-section" id="start">
          <div className="bh-section-copy"><p className="bh-kicker">START WITH ONE WORLD</p><h2>Survival World is live.</h2><p>Ten synthetic agents share a scarce environment for thirty days. Change scarcity, cooperation incentives, trust memory or communication. Then fork the same seeded universe and measure the divergence.</p></div>
          <div className="bh-feature-grid">
            <article><span>01</span><h3>Run</h3><p>Generate the same finite world from a deterministic seed.</p></article>
            <article><span>02</span><h3>Observe</h3><p>Inspect actions, resources, trust, violations and survival through time.</p></article>
            <article><span>03</span><h3>Fork</h3><p>Keep history fixed, change one condition and replay the future.</p></article>
            <article><span>04</span><h3>Prove</h3><p>Export a GaugeGap ProofPack with the configuration, trace and content hash.</p></article>
          </div>
          <button type="button" className="bh-button bh-primary" onClick={() => go(SURVIVAL_PATH, 'behaviour_mid_run_clicked')}>Open Survival World <ArrowRight size={16} /></button>
        </section>

        <section className="bh-products">
          <article className="bh-product bh-product-primary"><p className="bh-kicker"><Beaker size={14} /> PUBLIC LAB</p><h2>Experiment on behaviour.</h2><p>Worlds, forks and reproducible observations people can run themselves.</p><a href={SURVIVAL_PATH}>Enter Behaviour Lab <ArrowRight size={16} /></a></article>
          <article className="bh-product"><p className="bh-kicker">EXISTING ENGINE</p><h2>Creative Decision Lab</h2><p>The current text, page and media analysis tools remain available as one specialized BrainSNN experiment surface.</p><a href="/app">Open Creative Engine <ArrowRight size={16} /></a></article>
          <article className="bh-product"><p className="bh-kicker">GAUGEGAP</p><h2>Evidence underneath.</h2><p>Seeds, replay, provenance, hashes and explicit boundaries turn a simulation into an inspectable artifact.</p><a href="/arcade">Explore the Foundry <ArrowRight size={16} /></a></article>
        </section>

        <section className="bh-enterprise">
          <div><p className="bh-kicker">XIO REALITY LAB</p><h2>Test how your AI behaves before the real world does it for you.</h2><p>Production-agent work extends the same experiment → intervention → replay → evidence loop to real tools, permissions, policies and failure conditions.</p></div>
          <a className="bh-button bh-primary" href="https://www.xioai.co/" target="_blank" rel="noreferrer">Test a production agent <ArrowRight size={16} /></a>
        </section>
      </main>

      <footer className="bh-footer"><span>BrainSNN · experiments on machine behaviour</span><span>BrainSNN creates the experiment · GaugeGap records the evidence · XIO applies it to production systems.</span></footer>
    </div>
  );
}
