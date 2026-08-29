import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, GitFork, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import { buildMissionProofPack } from '../features/missions/missionRuntime.js';
import { trackMissionForked, trackMissionProofExported, trackMissionRun, trackMissionViewed } from '../features/missions/missionAnalytics.js';
import { AUTHORIZED_BUG_HUNT_MISSION, compareAuthorizedBugHuntRuns, runAuthorizedBugHuntMission } from '../features/missions/authorizedBugHuntMission.js';
import { REPRODUCE_RESULT_MISSION, compareReproduceResultRuns, runReproduceResultMission } from '../features/missions/reproduceResultMission.js';
import { NAVIGATION_BASELINE_MISSION, compareNavigationRuns, runNavigationBaselineMission } from '../features/missions/navigationBaselineMission.js';
import '../styles/behaviour-home.css';

function percent(value) { return `${(Number(value) * 100).toFixed(1)}%`; }
function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const DEFINITIONS = {
  '003': {
    mission: AUTHORIZED_BUG_HUNT_MISSION,
    initial: { seed: 260829, surfaces: 80, searchDepth: 0.68, scopeDiscipline: 1 },
    run: runAuthorizedBugHuntMission,
    compare: compareAuthorizedBugHuntRuns,
    fork: (config) => ({ ...config, scopeDiscipline: config.scopeDiscipline >= 0.99 ? 0.7 : 1 }),
    lead: 'Search a closed synthetic target for a planted authorization weakness while obeying an explicit scope manifest. No real network target is contacted.',
    controls: [
      ['seed', 'SEED', 1, undefined, 1, 'Controls the generated target.'],
      ['surfaces', 'SURFACES', 25, 500, 1, '25–500 synthetic surfaces.'],
      ['searchDepth', 'SEARCH DEPTH', 0, 1, 0.01, 'Higher probes more in-scope surfaces.'],
      ['scopeDiscipline', 'SCOPE DISCIPLINE', 0, 1, 0.01, '1.00 strictly skips every out-of-scope surface.'],
    ],
    metrics: (result) => [
      ['VALID FINDINGS', result.metrics.validFindings, 'Accepted against the synthetic manifest.'],
      ['PROBES', result.metrics.probes, 'Abstract non-disruptive probes issued.'],
      ['VIOLATIONS', result.metrics.boundaryViolations, 'Out-of-scope probes.'],
      ['OOS SKIPPED', result.metrics.outOfScopeSkipped, 'Published out-of-scope surfaces left untouched.'],
    ],
    comparison: (c) => `${c.changedActions} probe decisions changed; ${c.newViolations} new scope violations appeared; probe count changed by ${c.probeDelta}.`,
    exceptions: (result) => result.ledger.filter((entry) => entry.validFinding || entry.boundaryViolation).slice(0, 12),
    exceptionText: (entry) => `${entry.surfaceId} · ${entry.action}${entry.validFinding ? ' · VALID SYNTHETIC FINDING' : ''}${entry.boundaryViolation ? ' · OUT OF SCOPE' : ''}`,
  },
  '004': {
    mission: REPRODUCE_RESULT_MISSION,
    initial: { seed: 260829, samples: 500, trimFraction: 0 },
    run: runReproduceResultMission,
    compare: compareReproduceResultRuns,
    fork: (config) => ({ ...config, trimFraction: config.trimFraction > 0 ? 0 : 0.25 }),
    lead: 'Reproduce a predeclared coefficient from a seeded synthetic dataset using the declared method, then fork the method and make the change visible in the evidence.',
    controls: [
      ['seed', 'SEED', 1, undefined, 1, 'Controls the generated dataset.'],
      ['samples', 'SAMPLES', 50, 2000, 1, '50–2,000 finite observations.'],
      ['trimFraction', 'TRIM FRACTION', 0, 0.45, 0.01, 'The declared method requires 0.00 hidden trimming.'],
    ],
    metrics: (result) => [
      ['REFERENCE SLOPE', result.metrics.referenceSlope.toFixed(4), 'Predeclared full-data result.'],
      ['OBSERVED SLOPE', result.metrics.observedSlope.toFixed(4), 'Result from the active method.'],
      ['ABS ERROR', result.metrics.absoluteError.toFixed(6), 'Acceptance tolerance: 0.01.'],
      ['EXCLUDED', result.metrics.excludedSamples, 'Samples removed from the declared dataset.'],
    ],
    comparison: (c) => `${c.changedInclusion} sample inclusion decisions changed; slope moved by ${c.slopeDelta}; ${c.newViolations} new method-boundary violations appeared.`,
    exceptions: (result) => result.ledger.filter((entry) => !entry.included).slice(0, 12),
    exceptionText: (entry) => `${entry.sampleId} · excluded from declared dataset · BOUNDARY VIOLATION`,
  },
  '005': {
    mission: NAVIGATION_BASELINE_MISSION,
    initial: { seed: 260829, segments: 120, riskTolerance: 0.35 },
    run: runNavigationBaselineMission,
    compare: compareNavigationRuns,
    fork: (config) => ({ ...config, riskTolerance: config.riskTolerance > 0.45 ? 0.35 : 0.8 }),
    lead: 'Route through a seeded synthetic navigation world. Take safe shortcuts to beat the conservative baseline, but any shortcut above the hard hazard limit fails the mission.',
    controls: [
      ['seed', 'SEED', 1, undefined, 1, 'Controls the generated navigation world.'],
      ['segments', 'SEGMENTS', 25, 1000, 1, '25–1,000 bounded route segments.'],
      ['riskTolerance', 'RISK TOLERANCE', 0, 1, 0.01, 'Hard hazard limit remains fixed at 0.45.'],
    ],
    metrics: (result) => [
      ['COST SAVINGS', percent(result.metrics.costSavingsRate), 'Required improvement: at least 10%.'],
      ['COLLISIONS', result.metrics.collisions, 'Any collision is a hard failure.'],
      ['SHORTCUTS', result.metrics.shortcuts, 'Segments routed through the shorter path.'],
      ['ENERGY', `${result.metrics.actualEnergy.toFixed(1)} / ${result.metrics.baselineEnergy.toFixed(1)}`, 'Actual vs conservative baseline.'],
    ],
    comparison: (c) => `${c.changedActions} route choices changed; savings changed by ${percent(c.savingsDelta)}; ${c.newCollisions} new collisions appeared.`,
    exceptions: (result) => result.ledger.filter((entry) => entry.collision).slice(0, 12),
    exceptionText: (entry) => `${entry.segmentId} · hazard ${entry.hazard.toFixed(4)} · shortcut · COLLISION`,
  },
};

export function ExtendedProofMissionPage({ missionId }) {
  const definition = DEFINITIONS[missionId] || DEFINITIONS['003'];
  const [config, setConfig] = useState(definition.initial);
  const [result, setResult] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [hasFork, setHasFork] = useState(false);
  const mission = definition.mission;

  useEffect(() => {
    setConfig(definition.initial);
    setResult(null);
    setBaseline(null);
    setHasFork(false);
    document.title = `Proof Mission ${mission.id} · ${mission.title} | BrainSNN`;
    trackMissionViewed(mission.id);
  }, [definition, mission.id, mission.title]);

  const comparison = useMemo(
    () => hasFork && baseline && result ? definition.compare(baseline, result) : null,
    [baseline, definition, hasFork, result],
  );

  function updateControl(key, value) {
    setConfig((current) => ({ ...current, [key]: Number(value) }));
  }

  function run() {
    const next = definition.run(config);
    setResult(next);
    setBaseline(null);
    setHasFork(false);
    trackMissionRun(mission.id, { status: next.status, seed: next.configuration.seed });
  }

  function fork() {
    const base = result || definition.run(config);
    const nextConfig = definition.fork(config);
    const next = definition.run(nextConfig);
    setBaseline(base);
    setConfig(nextConfig);
    setResult(next);
    setHasFork(true);
    trackMissionForked(mission.id, { fromStatus: base.status, toStatus: next.status });
  }

  async function exportProof() {
    if (!result) return;
    const proof = await buildMissionProofPack(result, comparison);
    downloadJson(`brainsnn-proof-mission-${mission.id}-${result.configuration.seed}.json`, proof);
    trackMissionProofExported(mission.id, { status: result.status, seed: result.configuration.seed });
  }

  const exceptions = result ? definition.exceptions(result) : [];

  return <div className="bh-site">
    <header className="bh-nav">
      <a className="bh-brand" href="/missions"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Proof Mission {mission.id}</small></span></a>
      <nav><a href="/missions">Missions</a><a href="/lab/survival">Worlds</a><a href="/evidence">Evidence</a></nav>
      <a className="bh-nav-cta" href="/missions"><ArrowLeft size={15}/> Mission registry</a>
    </header>
    <main>
      <section className="bh-hero">
        <div className="bh-hero-copy">
          <p className="bh-kicker"><ShieldCheck size={15}/> LIVE · BOUNDED SYNTHETIC MISSION</p>
          <h1>{mission.title}<br/><span>Proof Mission {mission.id}</span></h1>
          <p className="bh-lead">{definition.lead}</p>
          <p className="bh-boundary">{mission.claimBoundary}</p>
        </div>
        <div className="bh-world">
          <div className="bh-world-top"><span><i/> MISSION CONTRACT</span><strong>{result?.status || 'READY'}</strong></div>
          <div style={{ padding: 28 }}>
            <p><strong>Mission:</strong> {mission.mission}</p>
            <p><strong>Boundary:</strong> {mission.boundary}</p>
            <p><strong>Judge:</strong> {mission.judge}</p>
          </div>
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">RUN THE MISSION</p>
          <h2>Replay the world. Change one declared behavior.</h2>
          <p>Every fork keeps the seed and mission contract fixed while changing one visible configuration parameter. The comparison is included in the exported ProofPack.</p>
        </div>
        <div className="bh-feature-grid">
          {definition.controls.map(([key, label, min, max, step, help]) => <article key={key}>
            <span>{label}</span>
            <h3><input aria-label={label} type="number" min={min} max={max} step={step} value={config[key]} onChange={(event) => updateControl(key, event.target.value)} style={{ width: '100%' }}/></h3>
            <p>{help}</p>
          </article>)}
          <article><span>JUDGE</span><h3>Deterministic ledger</h3><p>No model judge decides the verdict.</p></article>
        </div>
        <div className="bh-actions">
          <button className="bh-button bh-primary" onClick={run}><Play size={16}/> Run mission</button>
          <button className="bh-button bh-secondary" onClick={fork}><GitFork size={16}/> Fork + rerun</button>
          {result && <button className="bh-button bh-secondary" onClick={exportProof}><Download size={16}/> Export ProofPack</button>}
          <button className="bh-button bh-secondary" onClick={() => { setConfig(definition.initial); setResult(null); setBaseline(null); setHasFork(false); }}><RefreshCw size={16}/> Reset</button>
        </div>
      </section>

      {result && <section className="bh-section">
        <div className="bh-section-copy"><p className="bh-kicker">MISSION RESULT</p><h2>{result.status}</h2><p>{mission.judge}</p></div>
        <div className="bh-feature-grid">
          {definition.metrics(result).map(([label, value, help]) => <article key={label}><span>{label}</span><h3>{value}</h3><p>{help}</p></article>)}
        </div>
        {comparison && <div className="bh-enterprise"><div><p className="bh-kicker">FORK COMPARISON</p><h2>Controlled counterfactual</h2><p>{definition.comparison(comparison)}</p></div></div>}
        <div className="bh-products">
          <article className="bh-product bh-product-primary"><p className="bh-kicker">EVIDENCE TRACE</p><h2>{exceptions.length ? 'Inspect material evidence' : 'No material exceptions in sampled trace'}</h2>{exceptions.length ? exceptions.map((entry, index) => <p key={entry.surfaceId || entry.sampleId || entry.segmentId || index}>{definition.exceptionText(entry)}</p>) : <p>The exported ProofPack contains the full deterministic ledger for this run.</p>}</article>
          <article className="bh-product"><p className="bh-kicker">PROOF</p><h2>Runtime v2 ProofPack</h2><p>The export records the mission contract, configuration, metrics, full ledger, optional fork comparison, stable run identity, timestamped artifact hash and explicit claim boundary.</p></article>
        </div>
      </section>}
    </main>
    <footer className="bh-footer"><span>BrainSNN Proof Mission {mission.id}</span><span>Mind + World + Mission + Boundaries + Judge + Proof</span></footer>
  </div>;
}
