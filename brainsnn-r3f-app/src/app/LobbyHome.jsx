import React, { useEffect } from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { ArrowRight } from 'lucide-react';
import { track } from '../lib/analytics.js';
import { PRICING_DEFAULTS, DEFAULT_RUNTIME_ESTIMATE, formatUSD } from '../lib/arenaPricing.js';
import '../styles/behaviour-home.css';

export function LobbyHome() {
  useEffect(() => {
    document.title = 'BrainSNN | Robot policy testing';
    track('lobby_home_viewed');
  }, []);

  return (
    <div className="bh-site bh-home-simple bh-lobby bh-robot-home" data-build-marker="robot-pricing-transparent-v1">
      <a className="bh-skip" href="#lobby-main">Skip to content</a>
      <PublicNav />
      <main id="lobby-main">
        <section className="bh-hero bh-lobby-hero" aria-labelledby="lobby-title">
          <div className="bh-hero-copy">
            <p className="bh-kicker">Robot policy testing</p>
            <h1 id="lobby-title">Test your robot.<br /><span>See where it fails.</span></h1>
            <p className="bh-lead">Pick a robot and a model. Try a challenge. Replay what happened.</p>
            <div className="bh-actions">
              <a className="bh-button bh-primary" href="/arena/">Try the robot arcade <ArrowRight size={16} aria-hidden="true" /></a>
              <a className="bh-button bh-secondary" href="/arena/#campaigns">See pricing <ArrowRight size={16} aria-hidden="true" /></a>
            </div>
            <a className="bh-price-preview" href="/arena/#campaigns">
              <span>{PRICING_DEFAULTS.episodes.toLocaleString('en-US')} test episodes</span>
              <strong>{formatUSD(DEFAULT_RUNTIME_ESTIMATE.runtimePriceUSD)}</strong>
              <span>Illustrative runtime price · view the breakdown <ArrowRight size={14} aria-hidden="true" /></span>
            </a>
            <p className="bh-boundary">Local scripted practice is open now. Hosted policy tests are not yet available.</p>
          </div>
          <a className="bh-world bh-lobby-slice" href="/arena/" aria-label="Open the robot arcade">
            <div className="bh-world-top"><span>Robot arcade</span><span>Local practice · no AI model running</span></div>
            <div className="bh-world-field">
              <img src="/arena/assets/robots/panda.png" alt="Franka Panda robot body preview" width="250" height="250" />
            </div>
            <p className="bh-lobby-caption">Choose a robot and model, explore the world, and inspect a run. Named policies need a matching worker.</p>
          </a>
        </section>
        <section className="bh-test-pack" aria-labelledby="test-pack-title">
          <div className="bh-pack-intro">
            <p className="bh-kicker">Transparent test budgets</p>
            <h2 id="test-pack-title">Plan 10 to 100,000 episodes.</h2>
            <p>One episode is one task attempt. Choose a count, see the runtime price assumptions, and plan the evidence you need.</p>
          </div>
          <ol className="bh-pack-steps">
            <li><span>01</span><div><h3>Fix the test</h3><p>Keep the policy, task conditions and checkpoint on record.</p></div></li>
            <li><span>02</span><div><h3>Keep every outcome</h3><p>Separate task successes, task misses and execution errors.</p></div></li>
            <li><span>03</span><div><h3>Inspect the evidence</h3><p>Replay camera frames and follow the action and state trace.</p></div></li>
          </ol>
          <div className="bh-pack-next"><p>The first execution kit covers ten Panda + π₀.₅ / LIBERO Spatial episodes. Larger counts are budget forecasts.</p><a className="bh-button bh-secondary" href="/arena/#campaigns">Estimate your test budget <ArrowRight size={16} aria-hidden="true" /></a></div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
