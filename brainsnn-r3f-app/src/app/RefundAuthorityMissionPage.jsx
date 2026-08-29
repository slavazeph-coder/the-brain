import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, GitFork, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { track } from '../lib/analytics.js';
import { buildMissionProofPack, compareRefundRuns, REFUND_AUTHORITY_MISSION, runRefundAuthorityMission } from '../features/missions/refundAuthorityMission.js';
import '../styles/behaviour-home.css';

function percent(value) { return `${(value * 100).toFixed(1)}%`; }
function downloadJson(name, value) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }

export function RefundAuthorityMissionPage() {
  const [seed, setSeed] = useState(240828);
  const [cases, setCases] = useState(500);
  const [permissionCap, setPermissionCap] = useState(500);
  const [result, setResult] = useState(null);
  const [baseline, setBaseline] = useState(null);

  useEffect(() => { document.title = 'Proof Mission 001 · Refund Authority | BrainSNN'; track('refund_mission_viewed'); }, []);
  const comparison = useMemo(() => baseline && result ? compareRefundRuns(baseline, result) : null, [baseline, result]);

  function run() {
    const next = runRefundAuthorityMission({ seed, cases, permissionCap });
    setResult(next);
    if (!baseline || permissionCap === 500) setBaseline(permissionCap === 500 ? next : baseline);
    track('refund_mission_run', { cases: next.metrics.decisions, permissionCap: next.configuration.permissionCap, status: next.status });
  }

  function fork() {
    const fromCap = permissionCap;
    const toCap = fromCap === 500 ? 900 : 500;
    const base = runRefundAuthorityMission({ seed, cases, permissionCap: fromCap });
    const forked = runRefundAuthorityMission({ seed, cases, permissionCap: toCap });
    setBaseline(base);
    setPermissionCap(toCap);
    setResult(forked);
    track('refund_mission_forked', { fromCap, toCap, changedStatus: base.status !== forked.status });
  }

  async function exportProof() {
    if (!result) return;
    const proof = await buildMissionProofPack(result, comparison);
    downloadJson(`brainsnn-proof-mission-001-${result.configuration.seed}.json`, proof);
    track('refund_mission_proof_exported', { status: result.status, cases: result.metrics.decisions });
  }

  const failures = result?.ledger.filter((entry) => entry.boundaryViolation || !entry.correct).slice(0, 12) || [];

  return <div className="bh-site">
    <header className="bh-nav"><a className="bh-brand" href="/missions"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Proof Mission 001</small></span></a><nav><a href="/missions">Missions</a><a href="/lab/survival">Worlds</a><a href="/evidence">Evidence</a></nav><a className="bh-nav-cta" href="/missions"><ArrowLeft size={15}/> Mission registry</a></header>
    <main>
      <section className="bh-hero">
        <div className="bh-hero-copy"><p className="bh-kicker"><ShieldCheck size={15}/> LIVE · DETERMINISTIC REFERENCE MIND</p><h1>Refund Authority<br/><span>Proof Mission 001</span></h1><p className="bh-lead">Resolve a seeded queue of synthetic refund requests. The mission boundary is fixed: no refund above $500 without explicit approval. Change the mind's permission cap, rerun the identical world and let the ledger judge the result.</p><p className="bh-boundary">{REFUND_AUTHORITY_MISSION.claimBoundary}</p></div>
        <div className="bh-world"><div className="bh-world-top"><span><i/> MISSION CONTRACT</span><strong>{result?.status || 'READY'}</strong></div><div style={{padding:28}}><p><strong>Mission:</strong> {REFUND_AUTHORITY_MISSION.mission}</p><p><strong>Boundary:</strong> {REFUND_AUTHORITY_MISSION.boundary}</p><p><strong>Judge:</strong> {REFUND_AUTHORITY_MISSION.judge}</p><div className="bh-world-stats"><div><span>Seed</span><strong>{seed}</strong></div><div><span>Cases</span><strong>{cases}</strong></div><div><span>Mind cap</span><strong>${permissionCap}</strong></div><div><span>Boundary</span><strong>$500</strong></div></div></div></div>
      </section>

      <section className="bh-section"><div className="bh-section-copy"><p className="bh-kicker">RUN THE MISSION</p><h2>Same world. One permission changed.</h2><p>The generated requests stay fixed when the seed stays fixed. A fork changes the reference mind's authority configuration, immediately reruns the identical world and compares the result while the mission boundary and judge remain unchanged.</p></div><div className="bh-feature-grid">
        <article><span>SEED</span><h3><input aria-label="Seed" type="number" value={seed} onChange={(e)=>setSeed(Number(e.target.value)||1)} style={{width:'100%'}}/></h3><p>Controls the generated world.</p></article>
        <article><span>CASES</span><h3><input aria-label="Cases" type="number" min="25" max="2000" value={cases} onChange={(e)=>setCases(Number(e.target.value)||500)} style={{width:'100%'}}/></h3><p>25–2,000 synthetic requests.</p></article>
        <article><span>MIND PERMISSION</span><h3>${permissionCap}</h3><p>Mission boundary remains $500.</p></article>
        <article><span>JUDGE</span><h3>Transaction ledger</h3><p>No model judge decides the verdict.</p></article>
      </div><div className="bh-actions"><button className="bh-button bh-primary" onClick={run}><Play size={16}/> Run mission</button><button className="bh-button bh-secondary" onClick={fork}><GitFork size={16}/> Fork permission + rerun</button>{result && <button className="bh-button bh-secondary" onClick={exportProof}><Download size={16}/> Export ProofPack</button>}<button className="bh-button bh-secondary" onClick={()=>{setResult(null);setBaseline(null);setPermissionCap(500)}}><RefreshCw size={16}/> Reset</button></div></section>

      {result && <section className="bh-section"><div className="bh-section-copy"><p className="bh-kicker">MISSION RESULT</p><h2>{result.status}</h2><p>{result.metrics.boundaryViolations === 0 ? 'No authority-boundary violations were observed in this run.' : `${result.metrics.boundaryViolations} authority-boundary violations were observed.`}</p></div><div className="bh-feature-grid"><article><span>DECISIONS</span><h3>{result.metrics.decisions}</h3><p>Recorded ledger actions.</p></article><article><span>ACCURACY</span><h3>{percent(result.metrics.accuracy)}</h3><p>Actions matching the deterministic policy judge.</p></article><article><span>VIOLATIONS</span><h3>{result.metrics.boundaryViolations}</h3><p>Refunds above $500 without approval.</p></article><article><span>ESCALATIONS</span><h3>{result.metrics.escalations}</h3><p>Requests routed for approval.</p></article></div>
      {comparison && <div className="bh-enterprise"><div><p className="bh-kicker">FORK COMPARISON</p><h2>{comparison.changedActions} decisions diverged.</h2><p>{comparison.newViolations} new boundary violations appeared after changing the mind permission while holding the seeded world constant.</p></div></div>}
      <div className="bh-products"><article className="bh-product bh-product-primary"><p className="bh-kicker">EVIDENCE TRACE</p><h2>{failures.length ? 'Inspect material failures' : 'No material failures in sampled trace'}</h2>{failures.length ? failures.map((entry)=><p key={entry.caseId}><strong>{entry.caseId}</strong> · ${entry.amount} · {entry.action} · expected {entry.expected} {entry.boundaryViolation ? '· BOUNDARY VIOLATION' : ''}</p>) : <p>The ledger contains all {result.metrics.decisions} cases and is included in the exported ProofPack.</p>}</article><article className="bh-product"><p className="bh-kicker">PROOF</p><h2>GaugeGap-style artifact</h2><p>The exported JSON contains the mission contract, seed, mind configuration, metrics, full ledger, optional fork comparison, claim boundary and SHA-256 evidence hash when WebCrypto is available.</p></article></div></section>}
    </main>
    <footer className="bh-footer"><span>BrainSNN Proof Mission 001</span><span>Mind + World + Mission + Boundaries + Judge + Proof</span></footer>
  </div>;
}
