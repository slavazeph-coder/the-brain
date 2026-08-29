import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, Play, Send, ShieldCheck, Trophy } from 'lucide-react';
import { buildSubmissionConfiguration } from '../features/missions/missionMarketplace.js';
import { runBuiltMission } from '../features/missions/missionBuilder.js';
import { getMissionLeaderboard, getPublishedMission, proofUrl, submitMissionPolicy } from '../features/missions/missionMarketplaceApi.js';
import '../styles/behaviour-home.css';

const fieldStyle = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(255,255,255,.04)',
  color: 'inherit',
  font: 'inherit',
};

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function missionIdFromPath() {
  const match = window.location.pathname.match(/^\/m\/([a-zA-Z0-9_-]+)/);
  return match?.[1] || '';
}

async function downloadProof(missionId, submissionId) {
  const response = await fetch(proofUrl(missionId, submissionId), { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Could not download verified ProofPack.');
  const body = await response.json();
  const blob = new Blob([JSON.stringify(body.proofPack || body, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brainsnn-${missionId}-${submissionId}-proofpack.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function PublishedMissionPage() {
  const missionId = useMemo(missionIdFromPath, []);
  const [mission, setMission] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [participant, setParticipant] = useState('Anonymous');
  const [policy, setPolicy] = useState({ mind: 'Policy v1', aggressiveness: 0.55, boundaryDiscipline: 1 });
  const [result, setResult] = useState(null);
  const [lastSubmission, setLastSubmission] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [missionResponse, boardResponse] = await Promise.all([
          getPublishedMission(missionId),
          getMissionLeaderboard(missionId),
        ]);
        if (!live) return;
        const nextMission = missionResponse.mission;
        setMission(nextMission);
        setLeaderboard(boardResponse.entries || []);
        setPolicy({
          mind: nextMission.configuration.mind,
          aggressiveness: nextMission.configuration.aggressiveness,
          boundaryDiscipline: nextMission.configuration.boundaryDiscipline,
        });
        document.title = `${nextMission.contract.title} | BrainSNN Mission`;
      } catch (loadError) {
        if (live) setError(loadError.message || 'Mission could not be loaded.');
      } finally {
        if (live) setLoading(false);
      }
    }
    if (missionId) load();
    else { setError('Invalid mission link.'); setLoading(false); }
    return () => { live = false; };
  }, [missionId]);

  function updatePolicy(key, value) {
    setPolicy((current) => ({ ...current, [key]: value }));
    setResult(null);
    setLastSubmission(null);
  }

  function runPolicy() {
    if (!mission) return;
    const configuration = buildSubmissionConfiguration(mission.configuration, policy);
    setPolicy({
      mind: configuration.mind,
      aggressiveness: configuration.aggressiveness,
      boundaryDiscipline: configuration.boundaryDiscipline,
    });
    setResult(runBuiltMission(configuration));
    setLastSubmission(null);
  }

  async function submitPolicy() {
    if (!mission) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await submitMissionPolicy(mission.id, participant, policy);
      setLastSubmission(response.submission);
      setLeaderboard(response.leaderboard || []);
      const configuration = buildSubmissionConfiguration(mission.configuration, response.submission.policy);
      setResult(runBuiltMission(configuration));
    } catch (submitError) {
      setError(submitError.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="bh-site"><main><section className="bh-section"><div className="bh-section-copy"><p className="bh-kicker">PUBLISHED MISSION</p><h2>Loading mission…</h2></div></section></main></div>;
  if (error && !mission) return <div className="bh-site"><main><section className="bh-section"><div className="bh-section-copy"><p className="bh-kicker">PUBLISHED MISSION</p><h2>Mission unavailable</h2><p>{error}</p><a className="bh-button bh-secondary" href="/missions"><ArrowLeft size={15}/> Back to missions</a></div></section></main></div>;

  return <div className="bh-site">
    <header className="bh-nav">
      <a className="bh-brand" href="/missions"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Published Mission</small></span></a>
      <nav><a href="/missions">Missions</a><a href="/missions/build">Build</a><a href="/evidence">Evidence</a></nav>
      <a className="bh-nav-cta" href="/missions/build">Build your own</a>
    </header>

    <main>
      <section className="bh-hero">
        <div className="bh-hero-copy">
          <p className="bh-kicker"><Trophy size={15}/> VERIFIED PUBLIC MISSION · {mission.id}</p>
          <h1>{mission.contract.title}<br/><span>Beat the mission, not the browser.</span></h1>
          <p className="bh-lead">The world, seed, judge and hard boundary are frozen. You may change only the declared participant policy. Every leaderboard entry is recomputed on the BrainSNN server before it is accepted.</p>
          <p className="bh-boundary">{mission.contract.claimBoundary}</p>
        </div>
        <div className="bh-world">
          <div className="bh-world-top"><span><i/> IMMUTABLE CONTRACT</span><strong>{mission.submissionCount || 0} SUBMISSIONS</strong></div>
          <div style={{ padding: 28 }}>
            <p><strong>Mind baseline:</strong> {mission.contract.mind}</p>
            <p><strong>World:</strong> {mission.contract.world}</p>
            <p><strong>Mission:</strong> {mission.contract.mission}</p>
            <p><strong>Boundary:</strong> {mission.contract.boundary}</p>
            <p><strong>Judge:</strong> {mission.contract.judge}</p>
            <p><strong>Seed:</strong> {mission.configuration.seed}</p>
          </div>
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">1 · YOUR POLICY</p>
          <h2>Change the mind. The challenge stays fixed.</h2>
          <p>Participant submissions can change only policy identity, aggressiveness and boundary discipline. Seed, world size, hard risk limit and acceptance thresholds stay immutable.</p>
        </div>
        <div className="bh-feature-grid">
          <article><span>PARTICIPANT</span><h3><input aria-label="Participant" value={participant} onChange={(event) => setParticipant(event.target.value)} style={fieldStyle}/></h3><p>Public leaderboard label. Keep it non-sensitive.</p></article>
          <article><span>MIND / POLICY NAME</span><h3><input aria-label="Policy name" value={policy.mind} onChange={(event) => updatePolicy('mind', event.target.value)} style={fieldStyle}/></h3><p>Name the policy configuration you are testing.</p></article>
          <article><span>AGGRESSIVENESS</span><h3><input aria-label="Aggressiveness" type="number" min="0" max="1" step="0.01" value={policy.aggressiveness} onChange={(event) => updatePolicy('aggressiveness', Number(event.target.value))} style={fieldStyle}/></h3><p>Higher values act on more opportunities.</p></article>
          <article><span>BOUNDARY DISCIPLINE</span><h3><input aria-label="Boundary discipline" type="number" min="0" max="1" step="0.01" value={policy.boundaryDiscipline} onChange={(event) => updatePolicy('boundaryDiscipline', Number(event.target.value))} style={fieldStyle}/></h3><p>Lower values may cross the published hard-risk boundary and fail.</p></article>
        </div>
        <div className="bh-actions">
          <button className="bh-button bh-secondary" onClick={runPolicy}><Play size={16}/> Run locally</button>
          <button className="bh-button bh-primary" disabled={submitting} onClick={submitPolicy}><Send size={16}/> {submitting ? 'Verifying…' : 'Submit verified run'}</button>
        </div>
        {error && <p className="bh-boundary">{error}</p>}
      </section>

      {result && <section className="bh-section">
        <div className="bh-section-copy"><p className="bh-kicker">2 · RESULT</p><h2>{result.status}</h2><p>{lastSubmission ? 'This result was recomputed and accepted by the server.' : 'Local preview only. Submit it to enter the verified leaderboard.'}</p></div>
        <div className="bh-feature-grid">
          <article><span>IMPROVEMENT</span><h3>{percent(result.metrics.improvementRate)}</h3><p>Required: {percent(mission.configuration.minimumImprovement)}.</p></article>
          <article><span>QUALITY</span><h3>{percent(result.metrics.qualityRate)}</h3><p>Required: {percent(mission.configuration.minimumQuality)}.</p></article>
          <article><span>BOUNDARY VIOLATIONS</span><h3>{result.metrics.boundaryViolations}</h3><p>Any violation is a hard failure.</p></article>
          <article><span>ACTIONS</span><h3>{result.metrics.acted}</h3><p>Out of {mission.configuration.cases} finite items.</p></article>
        </div>
        {lastSubmission && <div className="bh-actions"><button className="bh-button bh-secondary" onClick={() => downloadProof(mission.id, lastSubmission.id)}><Download size={16}/> Download verified ProofPack</button></div>}
      </section>}

      <section className="bh-section">
        <div className="bh-section-copy"><p className="bh-kicker">3 · VERIFIED LEADERBOARD</p><h2>Server-recomputed submissions.</h2><p>Success ranks above objective miss, which ranks above boundary failure. Within a verdict class: fewer boundary violations, higher improvement, then higher quality.</p></div>
        <div className="bh-products">
          {leaderboard.length === 0 ? <article className="bh-product"><p className="bh-kicker">NO SUBMISSIONS YET</p><h2>Be the first verified run.</h2></article> : leaderboard.slice(0, 30).map((entry) => <article className="bh-product" key={entry.id}>
            <p className="bh-kicker">#{entry.rank} · {entry.status}</p>
            <h2>{entry.participant}</h2>
            <p><strong>Policy:</strong> {entry.policy?.mind || 'Unnamed'}</p>
            <p><strong>Improvement:</strong> {percent(entry.metrics?.improvementRate)} · <strong>Quality:</strong> {percent(entry.metrics?.qualityRate)} · <strong>Violations:</strong> {entry.metrics?.boundaryViolations || 0}</p>
            <button className="bh-button bh-secondary" onClick={() => downloadProof(mission.id, entry.id)}><ShieldCheck size={15}/> ProofPack</button>
          </article>)}
        </div>
      </section>
    </main>

    <footer className="bh-footer"><a href="/missions"><ArrowLeft size={14}/> Proof Missions</a><span>Immutable mission · mutable policy · server-verified result</span></footer>
  </div>;
}
