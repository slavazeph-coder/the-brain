import React, { useMemo, useState } from 'react';
import { ArrowLeft, Copy, Download, ExternalLink, GitFork, Goal, Play, RefreshCw, Scale, Share2, ShieldCheck } from 'lucide-react';
import { buildMissionProofPack } from '../features/missions/missionRuntime.js';
import { publishMission } from '../features/missions/missionMarketplaceApi.js';
import {
  BUILDER_WORLD_TEMPLATES,
  DEFAULT_MISSION_DRAFT,
  buildMissionContract,
  compareBuiltMissionRuns,
  forkMissionDraft,
  getBuilderWorldTemplate,
  runBuiltMission,
} from '../features/missions/missionBuilder.js';
import '../styles/behaviour-home.css';

function percent(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function downloadJson(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toLocalDateTimeInput(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

const DEFAULT_PUBLISH_TERMS = {
  creatorLabel: 'Mission creator',
  amount: '0',
  currency: 'CAD',
  deadline: '',
  rules: 'Top verified MISSION SUCCESS submissions are eligible. The creator selects the winner.',
};

const fieldStyle = {
  width: '100%',
  padding: '11px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.14)',
  background: 'rgba(255,255,255,.04)',
  color: 'inherit',
  font: 'inherit',
};

const textareaStyle = { ...fieldStyle, minHeight: 86, resize: 'vertical' };

export function MissionBuilderPage() {
  const [draft, setDraft] = useState({ ...DEFAULT_MISSION_DRAFT });
  const [publishTerms, setPublishTerms] = useState({ ...DEFAULT_PUBLISH_TERMS });
  const [result, setResult] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [hasFork, setHasFork] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(null);
  const [publishError, setPublishError] = useState('');
  const [copied, setCopied] = useState(false);

  const contract = useMemo(() => buildMissionContract(draft), [draft]);
  const template = useMemo(() => getBuilderWorldTemplate(draft.worldTemplate), [draft.worldTemplate]);
  const comparison = useMemo(
    () => (hasFork && baseline && result ? compareBuiltMissionRuns(baseline, result) : null),
    [baseline, hasFork, result],
  );

  React.useEffect(() => {
    document.title = 'Mission Builder | BrainSNN';
  }, []);

  function clearPublished() {
    setPublished(null);
    setPublishError('');
    setCopied(false);
  }

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
    setResult(null);
    setBaseline(null);
    setHasFork(false);
    clearPublished();
  }

  function updateNumber(key, value) {
    update(key, Number(value));
  }

  function updatePublishTerm(key, value) {
    setPublishTerms((current) => ({ ...current, [key]: value }));
    clearPublished();
  }

  function runMission() {
    const next = runBuiltMission(draft);
    setDraft(next.configuration);
    setResult(next);
    setBaseline(null);
    setHasFork(false);
    clearPublished();
  }

  function forkMission() {
    const base = result || runBuiltMission(draft);
    const nextDraft = forkMissionDraft(draft);
    const next = runBuiltMission(nextDraft);
    setBaseline(base);
    setDraft(next.configuration);
    setResult(next);
    setHasFork(true);
    clearPublished();
  }

  async function exportProof() {
    if (!result) return;
    const proof = await buildMissionProofPack(result, comparison);
    downloadJson(`brainsnn-custom-proof-${result.configuration.seed}.json`, proof);
  }

  async function publishCurrentMission() {
    setPublishing(true);
    setPublishError('');
    setCopied(false);
    try {
      const amount = Number(publishTerms.amount || 0);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Reward amount must be zero or greater.');
      if (publishTerms.deadline) {
        const deadline = new Date(publishTerms.deadline);
        if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= Date.now()) {
          throw new Error('Deadline must be a valid future date and time.');
        }
      }
      const response = await publishMission(draft, {
        creatorLabel: publishTerms.creatorLabel,
        amountCents: Math.round(amount * 100),
        currency: publishTerms.currency,
        deadline: publishTerms.deadline ? new Date(publishTerms.deadline).toISOString() : null,
        rules: publishTerms.rules,
      });
      setPublished(response);
    } catch (error) {
      setPublishError(error.message || 'Mission could not be published.');
    } finally {
      setPublishing(false);
    }
  }

  async function copyPublishedLink() {
    if (!published?.url) return;
    const absolute = new URL(published.url, window.location.origin).toString();
    await navigator.clipboard.writeText(absolute);
    setCopied(true);
  }

  function reset() {
    setDraft({ ...DEFAULT_MISSION_DRAFT });
    setPublishTerms({ ...DEFAULT_PUBLISH_TERMS });
    setResult(null);
    setBaseline(null);
    setHasFork(false);
    clearPublished();
  }

  const evidence = result
    ? result.ledger.filter((entry) => entry.boundaryViolation || entry.action !== 'HOLD').slice(0, 12)
    : [];

  return <div className="bh-site">
    <header className="bh-nav">
      <a className="bh-brand" href="/missions"><span className="bh-mark">B</span><span><strong>BrainSNN</strong><small>Mission Builder</small></span></a>
      <nav><a href="/missions">Missions</a><a href="/lab/survival">Worlds</a><a href="/evidence">Evidence</a></nav>
      <a className="bh-nav-cta" href="/missions"><ArrowLeft size={15}/> Registry</a>
    </header>

    <main>
      <section className="bh-hero">
        <div className="bh-hero-copy">
          <p className="bh-kicker"><Goal size={15}/> PROOF MISSION BUILDER</p>
          <h1>Define the contract.<br/><span>Then prove the run.</span></h1>
          <p className="bh-lead">Author a bounded deterministic mission without writing executable code. Pick a seeded world, state the objective, declare the hard boundary and choose measurable acceptance thresholds.</p>
          <p className="bh-boundary">Builder v1 executes only BrainSNN's declared finite templates. Your text describes the contract; the verdict comes only from the structured deterministic judge below.</p>
        </div>

        <div className="bh-world">
          <div className="bh-world-top"><span><i/> LIVE CONTRACT PREVIEW</span><strong>{result?.status || 'DRAFT'}</strong></div>
          <div style={{ padding: 28 }}>
            <p className="bh-kicker">{contract.type} · CUSTOM</p>
            <h2 style={{ marginTop: 8 }}>{contract.title}</h2>
            <p><strong>Mind:</strong> {contract.mind}</p>
            <p><strong>World:</strong> {contract.world}</p>
            <p><strong>Mission:</strong> {contract.mission}</p>
            <p><strong>Boundary:</strong> {contract.boundary}</p>
            <p><strong>Judge:</strong> {contract.judge}</p>
            <p><strong>Proof:</strong> {contract.proof}</p>
          </div>
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">1 · AUTHOR THE CONTRACT</p>
          <h2>Describe the mission. Keep the judge structured.</h2>
          <p>The authored language is preserved in the ProofPack, while the world size, seed, thresholds and policy controls are normalized into bounded numeric fields.</p>
        </div>

        <div className="bh-feature-grid">
          <article>
            <span>WORLD TEMPLATE</span>
            <h3><select aria-label="World template" value={draft.worldTemplate} onChange={(event) => update('worldTemplate', event.target.value)} style={fieldStyle}>
              {BUILDER_WORLD_TEMPLATES.map((world) => <option key={world.id} value={world.id}>{world.label}</option>)}
            </select></h3>
            <p>{template.description}</p>
          </article>
          <article><span>MISSION TITLE</span><h3><input aria-label="Mission title" value={draft.title} onChange={(event) => update('title', event.target.value)} style={fieldStyle}/></h3><p>Short name stored in the mission contract.</p></article>
          <article><span>MIND / POLICY</span><h3><input aria-label="Mind or policy" value={draft.mind} onChange={(event) => update('mind', event.target.value)} style={fieldStyle}/></h3><p>Name the policy, model or configuration being evaluated.</p></article>
          <article><span>SEED</span><h3><input aria-label="Seed" type="number" min="1" max="2147483647" value={draft.seed} onChange={(event) => updateNumber('seed', event.target.value)} style={fieldStyle}/></h3><p>Replay the same generated world exactly.</p></article>
        </div>

        <div className="bh-products" style={{ marginTop: 20 }}>
          <article className="bh-product bh-product-primary"><p className="bh-kicker">MISSION</p><textarea aria-label="Mission objective" value={draft.objective} onChange={(event) => update('objective', event.target.value)} style={textareaStyle}/></article>
          <article className="bh-product"><p className="bh-kicker">HARD BOUNDARY</p><textarea aria-label="Mission boundary" value={draft.boundary} onChange={(event) => update('boundary', event.target.value)} style={textareaStyle}/></article>
          <article className="bh-product"><p className="bh-kicker">JUDGE</p><textarea aria-label="Mission judge" value={draft.judge} onChange={(event) => update('judge', event.target.value)} style={textareaStyle}/></article>
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">2 · SET THE MEASURABLE RULES</p>
          <h2>The words do not decide the verdict. These numbers do.</h2>
        </div>
        <div className="bh-feature-grid">
          <article><span>WORLD SIZE</span><h3><input aria-label="World size" type="number" min="25" max="500" value={draft.cases} onChange={(event) => updateNumber('cases', event.target.value)} style={fieldStyle}/></h3><p>25–500 finite items.</p></article>
          <article><span>HARD RISK LIMIT</span><h3><input aria-label="Hard risk limit" type="number" min="0.05" max="0.9" step="0.01" value={draft.maxRisk} onChange={(event) => updateNumber('maxRisk', event.target.value)} style={fieldStyle}/></h3><p>Any action above this limit is a boundary violation.</p></article>
          <article><span>MIN IMPROVEMENT</span><h3><input aria-label="Minimum improvement" type="number" min="0" max="2" step="0.01" value={draft.minimumImprovement} onChange={(event) => updateNumber('minimumImprovement', event.target.value)} style={fieldStyle}/></h3><p>{percent(draft.minimumImprovement)} required vs the conservative baseline.</p></article>
          <article><span>MIN QUALITY</span><h3><input aria-label="Minimum quality" type="number" min="0.5" max="1" step="0.01" value={draft.minimumQuality} onChange={(event) => updateNumber('minimumQuality', event.target.value)} style={fieldStyle}/></h3><p>{percent(draft.minimumQuality)} average quality required.</p></article>
          <article><span>AGGRESSIVENESS</span><h3><input aria-label="Aggressiveness" type="number" min="0" max="1" step="0.01" value={draft.aggressiveness} onChange={(event) => updateNumber('aggressiveness', event.target.value)} style={fieldStyle}/></h3><p>Higher values act on more opportunities.</p></article>
          <article><span>BOUNDARY DISCIPLINE</span><h3><input aria-label="Boundary discipline" type="number" min="0" max="1" step="0.01" value={draft.boundaryDiscipline} onChange={(event) => updateNumber('boundaryDiscipline', event.target.value)} style={fieldStyle}/></h3><p>1.00 strictly enforces the hard risk gate; lower values intentionally test unsafe policy drift.</p></article>
        </div>

        <div className="bh-actions">
          <button className="bh-button bh-primary" onClick={runMission}><Play size={16}/> Run mission</button>
          <button className="bh-button bh-secondary" onClick={forkMission}><GitFork size={16}/> Fork + rerun</button>
          <button className="bh-button bh-secondary" onClick={() => downloadJson('brainsnn-mission-contract.json', { schema: 'brainsnn.proof_mission_contract.v1', ...contract, configuration: draft })}><Download size={16}/> Export contract</button>
          {result && <button className="bh-button bh-secondary" onClick={exportProof}><Download size={16}/> Export ProofPack</button>}
          <button className="bh-button bh-secondary" onClick={reset}><RefreshCw size={16}/> Reset</button>
        </div>
      </section>

      <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker"><Share2 size={14}/> 3 · PUBLISH + SET THE ECONOMIC TERMS</p>
          <h2>Freeze the challenge. Optionally attach a public reward pledge.</h2>
          <p>The mission, world, seed, boundary, judge, acceptance thresholds and bounty terms become immutable when published. Participants may change only their declared policy fields.</p>
          <p className="bh-boundary">A displayed reward is a creator pledge only. BrainSNN does not currently escrow, hold, charge or pay funds. Payment rail status remains NOT_CONNECTED until a real payment integration is added.</p>
        </div>

        <div className="bh-feature-grid">
          <article><span>CREATOR LABEL</span><h3><input aria-label="Creator label" value={publishTerms.creatorLabel} onChange={(event) => updatePublishTerm('creatorLabel', event.target.value)} style={fieldStyle}/></h3><p>Public creator name. Ownership itself is bound to your private browser workspace.</p></article>
          <article><span>REWARD PLEDGE</span><h3><input aria-label="Reward amount" type="number" min="0" max="1000000" step="1" value={publishTerms.amount} onChange={(event) => updatePublishTerm('amount', event.target.value)} style={fieldStyle}/></h3><p>Use 0 for a no-cash mission. This amount is not escrowed.</p></article>
          <article><span>CURRENCY</span><h3><select aria-label="Reward currency" value={publishTerms.currency} onChange={(event) => updatePublishTerm('currency', event.target.value)} style={fieldStyle}><option value="CAD">CAD</option><option value="USD">USD</option></select></h3><p>Display currency for the public pledge.</p></article>
          <article><span>DEADLINE · OPTIONAL</span><h3><input aria-label="Mission deadline" type="datetime-local" min={toLocalDateTimeInput(new Date(Date.now() + 60_000))} value={publishTerms.deadline} onChange={(event) => updatePublishTerm('deadline', event.target.value)} style={fieldStyle}/></h3><p>New verified submissions stop when the deadline is reached.</p></article>
        </div>

        <div className="bh-products" style={{ marginTop: 20 }}>
          <article className="bh-product bh-product-primary">
            <p className="bh-kicker">BOUNTY / WINNER RULES</p>
            <textarea aria-label="Bounty rules" maxLength={700} value={publishTerms.rules} onChange={(event) => updatePublishTerm('rules', event.target.value)} style={textareaStyle}/>
            <p>The creator can select a winner only from server-verified MISSION SUCCESS entries. The ranked top eligible run is selected by the current v1 workflow.</p>
          </article>
          <article className="bh-product">
            <p className="bh-kicker">CREATOR CONTROL</p>
            <h2>Close · reopen · award</h2>
            <p>After publishing, this browser workspace can close submissions, reopen before the deadline, and select the verified winner. Ownership is not inferred from a public creator label.</p>
            <a href="/missions#creator-dashboard">Open creator dashboard</a>
          </article>
        </div>

        <div className="bh-enterprise" style={{ marginTop: 20 }}>
          <div>
            <p className="bh-kicker">PUBLISH IMMUTABLY</p>
            <h2>Let other policies compete against exactly the same contract.</h2>
            <p>Submitted scores are recomputed server-side before entering the leaderboard. A duplicate policy/run identity does not get a second leaderboard entry.</p>
            {publishError && <p className="bh-boundary">{publishError}</p>}
            {published?.mission && <>
              <p><strong>Published:</strong> {published.mission.id} · {published.mission.submissionCount || 0} submissions · {published.mission.bounty?.lifecycle || 'OPEN'}</p>
              <p><strong>Reward:</strong> {(Number(published.mission.bounty?.amountCents || 0) / 100).toLocaleString()} {published.mission.bounty?.currency || 'CAD'} · {published.mission.bounty?.fundingStatus || 'NOT_ESCROWED'}</p>
            </>}
          </div>
          <div className="bh-actions">
            {!published && <button className="bh-button bh-primary" disabled={publishing} onClick={publishCurrentMission}><Share2 size={16}/> {publishing ? 'Publishing…' : 'Publish mission'}</button>}
            {published?.url && <button className="bh-button bh-secondary" onClick={copyPublishedLink}><Copy size={16}/> {copied ? 'Copied' : 'Copy challenge link'}</button>}
            {published?.url && <a className="bh-button bh-primary" href={published.url}><ExternalLink size={16}/> Open challenge</a>}
          </div>
        </div>
      </section>

      {result && <section className="bh-section">
        <div className="bh-section-copy">
          <p className="bh-kicker">4 · RESULT</p>
          <h2>{result.status}</h2>
          <p>{result.mission.claimBoundary}</p>
        </div>
        <div className="bh-feature-grid">
          <article><span>IMPROVEMENT</span><h3>{percent(result.metrics.improvementRate)}</h3><p>Required: {percent(result.configuration.minimumImprovement)}.</p></article>
          <article><span>QUALITY</span><h3>{percent(result.metrics.qualityRate)}</h3><p>Required: {percent(result.configuration.minimumQuality)}.</p></article>
          <article><span>BOUNDARY VIOLATIONS</span><h3>{result.metrics.boundaryViolations}</h3><p>Any violation causes a hard failure.</p></article>
          <article><span>ACTIONS</span><h3>{result.metrics.acted} / {result.configuration.cases}</h3><p>Items acted on by the active policy.</p></article>
        </div>

        {comparison && <div className="bh-enterprise">
          <div><p className="bh-kicker">CONTROLLED FORK</p><h2>{comparison.fromStatus} → {comparison.toStatus}</h2><p>{comparison.changedActions} decisions changed. Improvement moved by {percent(comparison.improvementDelta)}; quality moved by {percent(comparison.qualityDelta)}; {comparison.newViolations} new boundary violations appeared.</p></div>
        </div>}

        <div className="bh-products">
          <article className="bh-product bh-product-primary">
            <p className="bh-kicker">EVIDENCE TRACE</p>
            <h2>{evidence.length ? 'Inspect acted items' : 'No material actions in sampled trace'}</h2>
            {evidence.length ? evidence.map((entry) => <p key={entry.itemId}>{entry.itemId} · {entry.action} · risk {entry.risk.toFixed(4)} · value {entry.value.toFixed(2)}{entry.boundaryViolation ? ' · BOUNDARY VIOLATION' : ''}</p>) : <p>The full deterministic ledger remains in the ProofPack.</p>}
          </article>
          <article className="bh-product">
            <p className="bh-kicker"><Scale size={14}/> PROOF</p>
            <h2>Runtime v2 compatible</h2>
            <p>The same ProofPack path used by the five curated missions records the authored contract, normalized controls, complete ledger, optional fork comparison, stable run identity and artifact hash.</p>
          </article>
        </div>
      </section>}

      <section className="bh-enterprise">
        <div><p className="bh-kicker"><ShieldCheck size={14}/> WHY THIS IS BOUNDED</p><h2>No arbitrary code execution.</h2><p>Builder v1 only instantiates declared BrainSNN templates and numeric controls. Published challenges freeze the environment and judge; the server recomputes every accepted submission rather than trusting a client-reported score.</p></div>
      </section>
    </main>

    <footer className="bh-footer"><a href="/missions"><ArrowLeft size={14}/> Proof Missions</a><span>Mind + World + Mission + Boundaries + Judge + Proof + optional public bounty</span></footer>
  </div>;
}
