import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, GitFork, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { track } from '../lib/analytics.js';
import { buildMissionProofPack } from '../features/missions/missionRuntime.js';
import {
  compareWorkflowRuns,
  runWorkflowEfficiencyMission,
  WORKFLOW_EFFICIENCY_MISSION,
} from '../features/missions/workflowEfficiencyMission.js';
import '../styles/behaviour-home.css';

function percent(value) { return `${(value * 100).toFixed(1)}%`; }
function money(value) { return `$${Number(value).toFixed(2)}`; }
function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function WorkflowEfficiencyMissionPage() {
  const [seed, setSeed] = useState(260829);
  const [cases, setCases] = useState(500);
  const [reviewThreshold, setReviewThreshold] = useState(0.62);
  const [result, setResult] = useState(null);
  const [baseline, setBaseline] = useState(null);

  useEffect(() => {
    document.title = 'Proof Mission 002 · Workflow Efficiency | BrainSNN';
    track('workflow_mission_viewed');
  }, []);

  const comparison = useMemo(
    () => baseline && result ? compareWorkflowRuns(baseline, result) : null,
    [baseline, result],
  );

  function run() {
    const next = runWorkflowEfficiencyMission({ seed, cases, reviewThreshold });
    setResult(next);
    if (!baseline || reviewThreshold === 0.62) setBaseline(reviewThreshold === 0.62 ? next : baseline);
    track('workflow_mission_run', {
      cases: next.metrics.decisions,
      reviewThreshold: next.configuration.reviewThreshold,
      status: next.status,
    });
  }

  function fork() {
    const base = result || runWorkflowEfficiencyMission({ seed, cases, reviewThreshold });
    const nextThreshold = reviewThreshold < 0.75 ? 0.84 : 0.62;
    const next = runWorkflowEfficiencyMission({ seed, cases, reviewThreshold: nextThreshold });
    setBaseline(base);
    setReviewThreshold(nextThreshold);
    setResult(next);
    track('workflow_mission_forked', {
      fromThreshold: reviewThreshold,
      toThreshold: nextThreshold,
      status: next.status,
    });
  }

  async function exportProof() {
    if (!result) return;
    const proof = await buildMissionProofPack(result, comparison);
    downloadJson(`brainsnn-proof-mission-002-${result.configuration.seed}.json`, proof);
    track('workflow_mission_proof_exported', {
      status: result.status,
      cases: result.metrics.decisions,
    });
  }

  const exceptions = result?.ledger
    .filter((entry) => entry.boundaryViolation || entry.missedReview || entry.avoidableReview)
    .slice(0, 12) || [];

  return <div className="bh-site">
    <header className="bh-nav">
      <a className="bh-brand" href="/missions"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Proof Mission 002</small></span></a>
      <nav><a href="/missions">Missions</a><a href="/lab/survival">Worlds</a><a href="/evidence">Evidence</a></nav>
      <a className="bh-nav-cta" href="/missions"><ArrowLeft size={15}/> Mission registry</a>
    </header>
    <main>
      <section className="bh-hero">
        <div className="bh-hero-copy">
          <p className="bh-kicker"><ShieldCheck size={15}/> LIVE · DETERMINISTIC WORKFLOW JUDGE</p>
          <h1>Workflow Efficiency<br/><span>Proof Mission 002</span></h1>
          <p className="bh-lead">Route a seeded synthetic work queue through fast-path or full review. Reduce cost by at least 20%, keep quality at or above 95%, and never fast-path a critical case.</p>
          <p className="bh-boundary">{WORKFLOW_EFFICIENCY_MISSION.claimBoundary}</p>
        </div>
        <div className="bh-world">
          <div className="bh-world-top"><span><i/> MISSION CONTRACT</span><strong>{result?.status || 'READY'}</strong></div>
          <div style={{padding:28}}>
            <p><strong>Mission:</strong> {WORKFLOW_EFFICIENCY_MISSION.mission}</p>
            <p><strong>Boundary:</strong> {WORKFLOW_EFFICIENCY_MISSION.boundary}</p>
            <p><strong>Judge:</strong> {WORKFLOW_EFFICIENCY_MISSION.judge}</p>
            <div className="bh-world-stats">
              <div><span>Seed</span><strong>{seed}</strong></div>
              <div><span>Cases</span><strong>{cases}</strong></div>
              <div><span>Review threshold</span><strong>{reviewThreshold.toFixed(2)}</strong></div>
              <div><span>Quality floor</span><strong>95%</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">RUN THE MISSION</p>
          <h2>Same queue. One decision threshold changed.</h2>
          <p>The seed fixes the generated work. Lower thresholds send more cases to full review; higher thresholds cut cost but can create missed reviews and hard-boundary failures.</p>
        </div>
        <div className="bh-feature-grid">
          <article><span>SEED</span><h3><input aria-label="Seed" type="number" value={seed} onChange={(e)=>setSeed(Number(e.target.value)||1)} style={{width:'100%'}}/></h3><p>Controls the generated workflow.</p></article>
          <article><span>CASES</span><h3><input aria-label="Cases" type="number" min="25" max="2000" value={cases} onChange={(e)=>setCases(Number(e.target.value)||500)} style={{width:'100%'}}/></h3><p>25–2,000 synthetic cases.</p></article>
          <article><span>REVIEW THRESHOLD</span><h3><input aria-label="Review threshold" type="number" min="0.2" max="0.98" step="0.01" value={reviewThreshold} onChange={(e)=>setReviewThreshold(Math.min(0.98,Math.max(0.2,Number(e.target.value)||0.62)))} style={{width:'100%'}}/></h3><p>Higher means fewer full reviews.</p></article>
          <article><span>JUDGE</span><h3>Cost + quality ledger</h3><p>No model judge decides the verdict.</p></article>
        </div>
        <div className="bh-actions">
          <button className="bh-button bh-primary" onClick={run}><Play size={16}/> Run mission</button>
          <button className="bh-button bh-secondary" onClick={fork}><GitFork size={16}/> Fork threshold</button>
          {result && <button className="bh-button bh-secondary" onClick={exportProof}><Download size={16}/> Export ProofPack</button>}
          <button className="bh-button bh-secondary" onClick={()=>{setResult(null);setBaseline(null);setReviewThreshold(0.62)}}><RefreshCw size={16}/> Reset</button>
        </div>
      </section>

      {result && <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">MISSION RESULT</p>
          <h2>{result.status}</h2>
          <p>{result.metrics.boundaryViolations === 0 ? 'No hard-boundary violations were observed in this run.' : `${result.metrics.boundaryViolations} critical cases were fast-pathed.`}</p>
        </div>
        <div className="bh-feature-grid">
          <article><span>COST SAVINGS</span><h3>{percent(result.metrics.savingsRate)}</h3><p>{money(result.metrics.actualCost)} vs {money(result.metrics.baselineCost)} baseline.</p></article>
          <article><span>QUALITY</span><h3>{percent(result.metrics.qualityConformance)}</h3><p>Required floor: 95%.</p></article>
          <article><span>VIOLATIONS</span><h3>{result.metrics.boundaryViolations}</h3><p>Critical cases sent through fast-path.</p></article>
          <article><span>FULL REVIEWS</span><h3>{result.metrics.fullReviews}</h3><p>{result.metrics.fastPaths} cases used fast-path.</p></article>
        </div>

        {comparison && <div className="bh-enterprise"><div>
          <p className="bh-kicker">FORK COMPARISON</p>
          <h2>{comparison.changedActions} decisions diverged.</h2>
          <p>Savings changed by {percent(comparison.savingsRateDelta)}; quality changed by {percent(comparison.qualityDelta)}; {comparison.newViolations} new hard-boundary violations appeared.</p>
        </div></div>}

        <div className="bh-products">
          <article className="bh-product bh-product-primary">
            <p className="bh-kicker">EVIDENCE TRACE</p>
            <h2>{exceptions.length ? 'Inspect decision exceptions' : 'No material exceptions in sampled trace'}</h2>
            {exceptions.length ? exceptions.map((entry)=><p key={entry.caseId}><strong>{entry.caseId}</strong> · risk {entry.risk.toFixed(4)} · {entry.action} · expected {entry.expected}{entry.boundaryViolation ? ' · BOUNDARY VIOLATION' : entry.missedReview ? ' · MISSED REVIEW' : ' · EXTRA REVIEW'}</p>) : <p>The exported ProofPack includes all {result.metrics.decisions} decisions, costs, quality labels and generated case features.</p>}
          </article>
          <article className="bh-product">
            <p className="bh-kicker">PROOF</p>
            <h2>Stable run identity</h2>
            <p>Runtime v2 hashes the deterministic run separately from the timestamped artifact, so identical mission executions can retain the same SHA-256 run identity while each exported ProofPack is independently hashed.</p>
          </article>
        </div>
      </section>}
    </main>
    <footer className="bh-footer"><span>BrainSNN Proof Mission 002</span><span>Mind + World + Mission + Boundaries + Judge + Proof</span></footer>
  </div>;
}
