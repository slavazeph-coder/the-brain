import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, FlaskConical, Goal, Scale, ShieldCheck, Trophy } from 'lucide-react';
import { track } from '../lib/analytics.js';
import { listOwnedMissions, listPublishedMissions } from '../features/missions/missionMarketplaceApi.js';
import '../styles/behaviour-home.css';

const missions = [
  { id: '001', type: 'AGENT', title: 'Refund Authority', status: 'LIVE', objective: 'Resolve 500 synthetic refund requests.', boundary: 'Never issue a refund above $500 without approval.', judge: 'Final transaction ledger.', proof: 'Seeded run · action trace · ledger · stable run hash', href: '/missions/refund-authority' },
  { id: '002', type: 'BUSINESS', title: 'Workflow Efficiency', status: 'LIVE', objective: 'Reduce a bounded workflow cost by at least 20%.', boundary: 'Maintain at least 95% quality and never fast-path a critical case.', judge: 'Deterministic cost + quality ledger.', proof: 'Seeded queue · decision trace · stable run hash · ProofPack', href: '/missions/workflow-efficiency' },
  { id: '003', type: 'SECURITY', title: 'Authorized Bug Hunt', status: 'LIVE', objective: 'Discover a planted weakness in an explicitly authorized synthetic target.', boundary: 'Remain inside the published synthetic scope and use non-disruptive abstract probes only.', judge: 'Deterministic target manifest + finding validity ledger.', proof: 'Scope · trace · finding · stable run hash · ProofPack', href: '/missions/authorized-bug-hunt' },
  { id: '004', type: 'RESEARCH', title: 'Reproduce a Result', status: 'LIVE', objective: 'Reproduce a predeclared finite numerical result.', boundary: 'Use the full declared dataset and declared method with no hidden preprocessing.', judge: 'Deterministic coefficient acceptance test.', proof: 'Dataset seed · method · outputs · provenance · ProofPack', href: '/missions/reproduce-result' },
  { id: '005', type: 'PHYSICAL AI', title: 'Navigation Baseline', status: 'LIVE', objective: 'Beat a conservative simulated navigation baseline by at least 10%.', boundary: 'Respect the hard hazard limit and baseline energy ceiling.', judge: 'Deterministic route-cost, collision and energy ledger.', proof: 'World seed · route trace · collisions · metrics · ProofPack', href: '/missions/navigation-baseline' },
];

function money(amountCents, currency = 'CAD') {
  const amount = Number(amountCents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function deadline(value) {
  if (!value) return 'No deadline';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'No deadline';
}

export function ProofMissionsPage() {
  const [published, setPublished] = useState([]);
  const [owned, setOwned] = useState([]);
  const [marketError, setMarketError] = useState('');

  useEffect(() => {
    document.title = 'Proof Missions | BrainSNN';
    track('proof_missions_viewed');
    let live = true;
    Promise.all([listPublishedMissions(), listOwnedMissions()])
      .then(([publicResponse, ownedResponse]) => {
        if (!live) return;
        setPublished(publicResponse.missions || []);
        setOwned(ownedResponse.missions || []);
      })
      .catch((error) => { if (live) setMarketError(error.message || 'Published missions are temporarily unavailable.'); });
    return () => { live = false; };
  }, []);

  return <div className="bh-site">
    <header className="bh-nav">
      <a className="bh-brand" href="/"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Proof Missions</small></span></a>
      <nav><a href="/">Home</a><a href="/lab/survival">Worlds</a><a href="/evidence">Evidence</a><a href="/app">Creative Engine</a></nav>
      <a className="bh-nav-cta" href="/missions/build">Build a mission <ArrowRight size={15}/></a>
    </header>
    <main>
      <section className="bh-hero">
        <div className="bh-hero-copy">
          <p className="bh-kicker"><Trophy size={15}/> PROOF MISSIONS</p>
          <h1>Give intelligence<br/>a mission.<br/><span>Prove the result.</span></h1>
          <p className="bh-lead">A Proof Mission turns an AI experiment into a bounded challenge with a valuable objective, explicit permissions, a measurable judge, replayable evidence and an optional public reward pledge.</p>
          <div className="bh-actions">
            <a className="bh-button bh-primary" href="/missions/build"><Goal size={17}/> Build a Mission</a>
            <a className="bh-button bh-secondary" href="#marketplace">Browse public missions <ArrowRight size={16}/></a>
            <a className="bh-button bh-secondary" href="#creator-dashboard">Creator dashboard <ArrowRight size={16}/></a>
          </div>
          <p className="bh-boundary">Mission results apply only to the declared mind, world, rules and tested conditions. Passing a mission is evidence of that run — not a universal guarantee. Reward amounts are public creator pledges; BrainSNN does not currently escrow or process funds.</p>
        </div>
        <div className="bh-world">
          <div className="bh-world-top"><span><i/> MISSION CONTRACT</span><strong>5 CURATED · PUBLIC MARKETPLACE</strong></div>
          <div style={{padding:'28px'}}>
            <p className="bh-kicker">REPRODUCIBLE EXECUTION</p>
            <h2 style={{marginTop:8}}>Same world. Controlled policy. Stable proof.</h2>
            <p>Curated missions and community-published challenges share the same contract pattern. Public submissions are recomputed on the server before entering a leaderboard.</p>
            <div className="bh-feature-grid" style={{marginTop:22}}>
              <article><span>MIND</span><h3>Versioned configuration</h3><p>Participants submit a declared policy.</p></article>
              <article><span>WORLD</span><h3>Seeded state</h3><p>Published challenge state stays immutable.</p></article>
              <article><span>JUDGE</span><h3>Deterministic ledger</h3><p>Objective rules decide the result.</p></article>
              <article><span>PROOF + VALUE</span><h3>ProofPack + pledge</h3><p>Verified evidence can support a public bounty workflow.</p></article>
            </div>
          </div>
        </div>
      </section>

      <section className="bh-thesis" aria-label="Proof Mission method">
        <div><FlaskConical size={19}/><span>MIND + WORLD</span><strong>What acts · where it acts</strong></div>
        <ArrowRight className="bh-thesis-arrow" size={18}/>
        <div><Goal size={19}/><span>MISSION</span><strong>What must be accomplished</strong></div>
        <ArrowRight className="bh-thesis-arrow" size={18}/>
        <div><ShieldCheck size={19}/><span>BOUNDARIES</span><strong>What it may and may not do</strong></div>
        <ArrowRight className="bh-thesis-arrow" size={18}/>
        <div><Scale size={19}/><span>JUDGE + PROOF</span><strong>How the result is decided and verified</strong></div>
      </section>

      <section className="bh-section" id="marketplace">
        <div className="bh-section-copy">
          <p className="bh-kicker">PUBLIC MISSION MARKETPLACE</p>
          <h2>Published challenges with verified outcomes.</h2>
          <p>The mission contract and economic terms are immutable after publication. Participants change only the declared policy fields, then BrainSNN recomputes the run server-side and attaches a verified ProofPack to the leaderboard entry.</p>
          {marketError && <p className="bh-boundary">{marketError}</p>}
        </div>
        <div className="bh-products">
          {published.length === 0 && !marketError ? <article className="bh-product bh-product-primary"><p className="bh-kicker">MARKETPLACE READY</p><h2>No public missions yet.</h2><p>Publish the first challenge from Mission Builder.</p><a href="/missions/build">Build + publish <ArrowRight size={16}/></a></article> : published.map((mission) => <article className="bh-product bh-product-primary" key={mission.id}>
            <p className="bh-kicker">{mission.contract?.type || 'CUSTOM'} · {mission.bounty?.lifecycle || 'OPEN'} · {mission.submissionCount || 0} SUBMISSIONS</p>
            <h2>{mission.contract?.title || mission.id}</h2>
            <p><strong>Creator:</strong> {mission.creator?.label || 'Mission creator'}</p>
            <p><strong>Reward pledge:</strong> {money(mission.bounty?.amountCents, mission.bounty?.currency)} · {mission.bounty?.fundingStatus || 'NOT_ESCROWED'}</p>
            <p><strong>Deadline:</strong> {deadline(mission.bounty?.deadline)}</p>
            <p><strong>Mission:</strong> {mission.contract?.mission}</p>
            <p><strong>Boundary:</strong> {mission.contract?.boundary}</p>
            <p><strong>Judge:</strong> {mission.contract?.judge}</p>
            <a href={`/m/${mission.id}`}>{mission.bounty?.lifecycle === 'OPEN' ? 'Attempt mission' : 'Inspect mission'} <ArrowRight size={16}/></a>
          </article>)}
        </div>
      </section>

      <section className="bh-section" id="creator-dashboard">
        <div className="bh-section-copy">
          <p className="bh-kicker">YOUR CREATOR DASHBOARD</p>
          <h2>Own the challenge lifecycle from this browser workspace.</h2>
          <p>Your private workspace cookie determines mission ownership. Public creator labels do not grant control. Open a mission to close/reopen submissions or select a verified winner.</p>
          <p className="bh-boundary">Reward pledges shown here are not escrowed. Payment rail status remains NOT_CONNECTED; awarding a mission records the selected verified winner but does not move money.</p>
        </div>
        <div className="bh-products">
          {owned.length === 0 ? <article className="bh-product"><p className="bh-kicker">NO OWNED MISSIONS YET</p><h2>Publish one from this browser.</h2><p>The resulting mission will appear here with creator controls.</p><a href="/missions/build">Build a mission <ArrowRight size={16}/></a></article> : owned.map((mission) => <article className="bh-product bh-product-primary" key={mission.id}>
            <p className="bh-kicker">{mission.bounty?.lifecycle || 'OPEN'} · {mission.submissionCount || 0} SUBMISSIONS</p>
            <h2>{mission.contract?.title || mission.id}</h2>
            <p><strong>Reward pledge:</strong> {money(mission.bounty?.amountCents, mission.bounty?.currency)} · {mission.bounty?.fundingStatus || 'NOT_ESCROWED'}</p>
            <p><strong>Deadline:</strong> {deadline(mission.bounty?.deadline)}</p>
            <p><strong>Payment:</strong> {mission.bounty?.paymentStatus || 'NOT_CONNECTED'}</p>
            {mission.bounty?.winnerSubmissionId && <p><strong>Selected winner:</strong> {mission.bounty.winnerSubmissionId}</p>}
            <a href={`/m/${mission.id}`}>Open creator controls <ArrowRight size={16}/></a>
          </article>)}
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-enterprise">
          <div><p className="bh-kicker">MISSION BUILDER</p><h2>Turn your own bounded problem into a public challenge.</h2><p>Choose a finite world template, state the objective and hard boundary, set deterministic acceptance thresholds, optionally pledge a reward, then publish the immutable contract. Other policies can compete without changing the challenge.</p></div>
          <a className="bh-button bh-primary" href="/missions/build">Open Mission Builder <ArrowRight size={16}/></a>
        </div>
      </section>

      <section className="bh-section" id="missions">
        <div className="bh-section-copy">
          <p className="bh-kicker">CURATED MISSION REGISTRY</p>
          <h2>Five different problems. One contract.</h2>
          <p>Business, security, science, agents and physical AI use the same core pattern: valuable objective, bounded action, deterministic judge, controlled fork and inspectable evidence.</p>
        </div>
        <div className="bh-products">
          {missions.map((mission)=><article className="bh-product bh-product-primary" id={`mission-${mission.id}`} key={mission.id}>
            <p className="bh-kicker">{mission.type} · {mission.status}</p>
            <h2>{mission.id}. {mission.title}</h2>
            <p><strong>Mission:</strong> {mission.objective}</p>
            <p><strong>Boundary:</strong> {mission.boundary}</p>
            <p><strong>Judge:</strong> {mission.judge}</p>
            <p><strong>Proof:</strong> {mission.proof}</p>
            <a href={mission.href} onClick={()=>track('proof_mission_opened',{mission:mission.id})}>Open mission <ArrowRight size={16}/></a>
          </article>)}
        </div>
      </section>

      <section className="bh-enterprise">
        <div><p className="bh-kicker">MARKETPLACE PROTOCOL</p><h2>Immutable challenge. Public value. Mutable policy. Verified result.</h2><p>BrainSNN now has persistent public missions, creator ownership, optional reward pledges, deadline/state enforcement, server-recomputed submissions, deterministic ranking, verified winner selection and a ProofPack attached to every accepted run.</p></div>
        <a className="bh-button bh-primary" href="/missions/build">Publish a mission <ArrowRight size={16}/></a>
      </section>
    </main>
    <footer className="bh-footer"><a href="/"><ArrowLeft size={14}/> BrainSNN</a><span>Mind + World + Mission + Boundaries + Judge + Proof + optional public value</span></footer>
  </div>;
}
