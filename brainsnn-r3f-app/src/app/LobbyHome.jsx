// The front door is the loop, not the toy. The jelly brain stays at /play.
// The proof line is computed with the evidence page, so it cannot drift from it.
import React, { useEffect, useMemo } from 'react';
import { PublicNav, PublicFooter } from './PublicNav.jsx';
import { ArrowRight } from 'lucide-react';
import { track } from '../lib/analytics.js';
import { buildHoldoutReport } from '../lib/holdoutReport.js';
import '../styles/behaviour-home.css';

export function LobbyHome() {
  const report = useMemo(() => buildHoldoutReport(), []);

  useEffect(() => {
    document.title = 'BrainSNN | See the moment it breaks';
    track('lobby_home_viewed');
  }, []);

  return (
    <div className="bh-site bh-home-simple bh-lobby">
      <a className="bh-skip" href="#lobby-main">Skip to content</a>
      <PublicNav />
      <main id="lobby-main">
        <section className="bh-hero bh-lobby-hero" aria-labelledby="lobby-title">
          <div className="bh-hero-copy">
            <p className="bh-kicker">A mission or a draft</p>
            <h1 id="lobby-title">See the moment <span>it breaks.</span></h1>
            <p className="bh-lead">Change one thing in a robot mission or a draft. Both runs stay.</p>
            <div className="bh-actions">
              <a className="bh-button bh-primary" href="/arena/">Enter Arena <ArrowRight size={16} aria-hidden="true" /></a>
              <a className="bh-button bh-secondary" href="/office">Open Review <ArrowRight size={16} aria-hidden="true" /></a>
            </div>
            <p className="bh-boundary">
              <a href="/evidence">
                {report.outOfSample.rho} rank agreement on {report.outOfSample.n} unseen passages. {report.falseAlarmCount} false alarms, listed.
              </a>
            </p>
          </div>
          <a className="bh-world bh-lobby-slice" href="/arena/">
            <div className="bh-world-top"><span><i /> Sort three blocks</span><span>Paused · local practice — not a model score</span></div>
            <div className="bh-world-field">
              <img src="/arena/assets/robots/panda.png" alt="" width="250" height="250" />
            </div>
            <p className="bh-lobby-caption">Sort three blocks. Enter Arena, run the mission, then change one thing.</p>
          </a>
        </section>
        <section className="bh-evidence-note" aria-labelledby="lobby-evidence-title">
          <div>
            <p className="bh-kicker">Open to inspection</p>
            <h2 id="lobby-evidence-title">The score stays next to its misses.</h2>
            <p>Review a passage, compare drafts, split a claim or inspect video cues. Follow each finding back to its source.</p>
          </div>
          <a className="bh-button bh-secondary" href="/evidence">Inspect evidence <ArrowRight size={16} aria-hidden="true" /></a>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
