import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, LockKeyhole, Play, RefreshCw, Send, ShieldCheck, Trophy } from 'lucide-react';
import { buildSubmissionConfiguration } from '../features/missions/missionMarketplace.js';
import { runBuiltMission } from '../features/missions/missionBuilder.js';
import {
  closeOwnedMission,
  getMissionLeaderboard,
  getPublishedMission,
  proofUrl,
  reopenOwnedMission,
  selectMissionWinner,
  submitMissionPolicy,
} from '../features/missions/missionMarketplaceApi.js';
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

function money(amountCents, currency = 'CAD') {
  const amount = Number(amountCents || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function dateTime(value) {
  if (!value) return 'No deadline';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'No deadline';
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
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [error, setError] = useState('');
  const [ownerMessage, setOwnerMessage] = useState('');

  async function loadMissionAndBoard() {
    const [missionResponse, boardResponse] = await Promise.all([
      getPublishedMission(missionId),
      getMissionLeaderboard(missionId),
    ]);
    return { mission: missionResponse.mission, leaderboard: boardResponse.entries || [] };
  }

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const loaded = await loadMissionAndBoard();
        if (!live) return;
        const nextMission = loaded.mission;
        setMission(nextMission);
        setLeaderboard(loaded.leaderboard);
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
    if (!mission || mission.bounty?.lifecycle !== 'OPEN') return;
    setSubmitting(true);
    setError('');
    try {
      const response = await submitMissionPolicy(mission.id, participant, policy);
      setLastSubmission(response.submission);
      setLeaderboard(response.leaderboard || []);
      const configuration = buildSubmissionConfiguration(mission.configuration, response.submission.policy);
      setResult(runBuiltMission(configuration));
      const refreshed = await getPublishedMission(mission.id);
      setMission(refreshed.mission);
    } catch (submitError) {
      setError(submitError.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  }

  async function ownerAction(action) {
    if (!mission?.isOwner) return;
    setOwnerBusy(true);
    setError('');
    setOwnerMessage('');
    try {
      let response;
      if (action === 'close') response = await closeOwnedMission(mission.id);
      else if (action === 'reopen') response = await reopenOwnedMission(mission.id);
      else response = await selectMissionWinner(mission.id);
      setMission(response.mission);
      if (response.leaderboard) setLeaderboard(response.leaderboard);
      else {
        const board = await getMissionLeaderboard(mission.id);
        setLeaderboard(board.entries || []);
      }
      if (action === 'close') setOwnerMessage('Submissions closed.');
      if (action === 'reopen') setOwnerMessage('Submissions reopened.');
      if (action === 'winner') setOwnerMessage(`Winner selected: ${response.winner?.participant || response.winner?.id || 'verified submission'}. No payout has been processed.`);
    } catch (ownerError) {
      setError(ownerError.message || 'Creator action failed.');
    } finally {
      setOwnerBusy(false);
    }
  }

  if (loading) return <div className="bh-site"><main><section className="bh-section"><div className="bh-section-copy"><p className="bh-kicker">PUBLISHED MISSION</p><h2>Loading mission…</h2></div></section></main></div>;
  if (error && !mission) return <div className="bh-site"><main><section className="bh-section"><div className="bh-section-copy"><p className="bh-kicker">PUBLISHED MISSION</p><h2>Mission unavailable</h2><p>{error}</p><a className="bh-button bh-secondary" href="/missions"><ArrowLeft size={15}/> Back to missions</a></div></section></main></div>;

  const lifecycle = mission.bounty?.lifecycle || 'OPEN';
  const submissionsOpen = lifecycle === 'OPEN';
  const reward = money(mission.bounty?.amountCents, mission.bounty?.currency);
  const topEligible = leaderboard.find((entry) => entry.status === 'MISSION SUCCESS');
  const winner = leaderboard.find((entry) => entry.isWinner);

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
          <p className="bh-lead">The world, seed, judge, hard boundary and economic terms are frozen. You may change only the declared participant policy. Every leaderboard entry is recomputed on the BrainSNN server before it is accepted.</p>
          <p className="bh-boundary">{mission.contract.claimBoundary}</p>
        </div>
        <div className="bh-world">
          <div className="bh-world-top"><span><i/> {lifecycle} CONTRACT</span><strong>{mission.submissionCount || 0} SUBMISSIONS</strong></div>
          <div style={{ padding: 28 }}>
            <p><strong>Creator:</strong> {mission.creator?.label || 'Mission creator'}</p>
            <p><strong>Reward pledge:</strong> {reward} · {mission.bounty?.fundingStatus || 'NOT_ESCROWED'}</p>
            <p><strong>Deadline:</strong> {dateTime(mission.bounty?.deadline)}</p>
            <p><strong>Payment rail:</strong> {mission.bounty?.paymentRail || mission.bounty?.paymentStatus || 'NOT_CONNECTED'}</p>
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
          <p className="bh-kicker">PUBLIC ECONOMIC TERMS</p>
          <h2>{reward} pledged · {lifecycle}.</h2>
          <p>{mission.bounty?.rules}</p>
          <p className="bh-boundary">The displayed reward is a creator pledge, not escrow. BrainSNN does not currently hold funds or process a payout. An AWARDED status records the selected verified winner only.</p>
          {winner && <p><strong>Selected winner:</strong> {winner.participant} · {winner.policy?.mind || 'Unnamed policy'} · verified submission {winner.id}</p>}
        </div>
      </section>

      {mission.isOwner && <section className="bh-enterprise">
        <div>
          <p className="bh-kicker"><LockKeyhole size={14}/> CREATOR CONTROLS</p>
          <h2>You own this published mission.</h2>
          <p>Ownership is tied to this private browser workspace, not the public creator label. Close submissions at any time, reopen before an unexpired deadline, or award the top server-verified MISSION SUCCESS entry.</p>
          <p><strong>Current lifecycle:</strong> {lifecycle} · <strong>Eligible top run:</strong> {topEligible ? `${topEligible.participant} (#${topEligible.rank})` : 'none yet'}.</p>
          {ownerMessage && <p>{ownerMessage}</p>}
        </div>
        <div className="bh-actions">
          {lifecycle === 'OPEN' && <button className="bh-button bh-secondary" disabled={ownerBusy} onClick={() => ownerAction('close')}><LockKeyhole size={15}/> Close submissions</button>}
          {lifecycle === 'CLOSED' && <button className="bh-button bh-secondary" disabled={ownerBusy} onClick={() => ownerAction('reopen')}><RefreshCw size={15}/> Reopen submissions</button>}
          {lifecycle !== 'AWARDED' && <button className="bh-button bh-primary" disabled={ownerBusy || !topEligible} onClick={() => ownerAction('winner')}><Trophy size={15}/> Select verified winner</button>}
        </div>
      </section>}

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">1 · YOUR POLICY</p>
          <h2>Change the mind. The challenge stays fixed.</h2>
          <p>Participant submissions can change only policy identity, aggressiveness and boundary discipline. Seed, world size, hard risk limit, acceptance thresholds, deadline and bounty terms stay immutable.</p>
          {!submissionsOpen && <p className="bh-boundary">This mission is {lifecycle.toLowerCase()} and is not accepting new verified submissions. Local replay remains available.</p>}
        </div>
        <div className="bh-feature-grid">
          <article><span>PARTICIPANT</span><h3><input aria-label="Participant" value={participant} onChange={(event) => setParticipant(event.target.value)} style={fieldStyle}/></h3><p>Public leaderboard label. Keep it non-sensitive.</p></article>
          <article><span>MIND / POLICY NAME</span><h3><input aria-label="Policy name" value={policy.mind} onChange={(event) => updatePolicy('mind', event.target.value)} style={fieldStyle}/></h3><p>Name the policy configuration you are testing.</p></article>
          <article><span>AGGRESSIVENESS</span><h3><input aria-label="Aggressiveness" type="number" min="0" max="1" step="0.01" value={policy.aggressiveness} onChange={(event) => updatePolicy('aggressiveness', Number(event.target.value))} style={fieldStyle}/></h3><p>Higher values act on more opportunities.</p></article>
          <article><span>BOUNDARY DISCIPLINE</span><h3><input aria-label="Boundary discipline" type="number" min="0" max="1" step="0.01" value={policy.boundaryDiscipline} onChange={(event) => updatePolicy('boundaryDiscipline', Number(event.target.value))} style={fieldStyle}/></h3><p>Lower values may cross the published hard-risk boundary and fail.</p></article>
        </div>
        <div className="bh-actions">
          <button className="bh-button bh-secondary" onClick={runPolicy}><Play size={16}/> Run locally</button>
          <button className="bh-button bh-primary" disabled={submitting || !submissionsOpen} onClick={submitPolicy}><Send size={16}/> {submitting ? 'Verifying…' : submissionsOpen ? 'Submit verified run' : `Submissions ${lifecycle.toLowerCase()}`}</button>
        </div>
        {error && <p className="bh-boundary">{error}</p>}
      </section>

      {result && <section className="bh-section">
        <div className="bh-section-copy"><p className="bh-kicker">2 · RESULT</p><h2>{result.status}</h2><p>{lastSubmission ? 'This result was recomputed and accepted by the server.' : 'Local preview only. Submit it while the mission is open to enter the verified leaderboard.'}</p></div>
        <div className="bh-feature-grid">
          <article><span>IMPROVEMENT</span><h3>{percent(result.metrics.improvementRate)}</h3><p>Required: {percent(mission.configuration.minimumImprovement)}.</p></article>
          <article><span>QUALITY</span><h3>{percent(result.metrics.qualityRate)}</h3><p>Required: {percent(mission.configuration.minimumQuality)}.</p></article>
          <article><span>BOUNDARY VIOLATIONS</span><h3>{result.metrics.boundaryViolations}</h3><p>Any violation is a hard failure.</p></article>
          <article><span>ACTIONS</span><h3>{result.metrics.acted}</h3><p>Out of {mission.configuration.cases} finite items.</p></article>
        </div>
        {lastSubmission && <div className="bh-actions"><button className="bh-button bh-secondary" onClick={() => downloadProof(mission.id, lastSubmission.id)}><Download size={16}/> Download verified ProofPack</button></div>}
      </section>}

      <section className="bh-section">
        <div className="bh-section-copy"><p className="bh-kicker">3 · VERIFIED LEADERBOARD</p><h2>Server-recomputed submissions.</h2><p>Success ranks above objective miss, which ranks above boundary failure. Within a verdict class: fewer boundary violations, higher improvement, then higher quality. A selected winner must already be a verified MISSION SUCCESS entry.</p></div>
        <div className="bh-products">
          {leaderboard.length === 0 ? <article className="bh-product"><p className="bh-kicker">NO SUBMISSIONS YET</p><h2>{submissionsOpen ? 'Be the first verified run.' : 'No verified runs were submitted.'}</h2></article> : leaderboard.slice(0, 30).map((entry) => <article className={`bh-product${entry.isWinner ? ' bh-product-primary' : ''}`} key={entry.id}>
            <p className="bh-kicker">#{entry.rank} · {entry.status}{entry.isWinner ? ' · SELECTED WINNER' : ''}</p>
            <h2>{entry.participant}</h2>
            <p><strong>Policy:</strong> {entry.policy?.mind || 'Unnamed'}</p>
            <p><strong>Improvement:</strong> {percent(entry.metrics?.improvementRate)} · <strong>Quality:</strong> {percent(entry.metrics?.qualityRate)} · <strong>Violations:</strong> {entry.metrics?.boundaryViolations || 0}</p>
            <button className="bh-button bh-secondary" onClick={() => downloadProof(mission.id, entry.id)}><ShieldCheck size={15}/> ProofPack</button>
          </article>)}
        </div>
      </section>
    </main>

    <footer className="bh-footer"><a href="/missions"><ArrowLeft size={14}/> Proof Missions</a><span>Immutable mission · public pledge · mutable policy · server-verified result</span></footer>
  </div>;
}
