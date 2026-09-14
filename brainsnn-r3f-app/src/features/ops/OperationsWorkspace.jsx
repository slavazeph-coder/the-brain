import React, { useEffect, useRef, useState } from 'react';
import './operations.css';

const STATES = ['queued', 'generating', 'decoding', 'ready-for-review', 'failed', 'paused'];
const CATEGORIES = ['visual', 'outreach', 'publication', 'spend'];
const readable = (value) => String(value || '—').replaceAll('-', ' ');

function JobRecord({ job, approvals, execute, busy }) {
  const [category, setCategory] = useState(job.kind === 'video' ? 'visual' : 'outreach');
  const [artifact, setArtifact] = useState('');
  const [note, setNote] = useState('');
  const artifacts = job.artifacts || [];
  const selected = artifact || artifacts[0]?.sha256 || '';
  const records = approvals.filter((item) => item.jobId === job.id);
  return <article className="ops-job" data-job-id={job.id}>
    <div className="ops-row"><h3>{readable(job.kind)} <code>{job.id.slice(0, 8)}</code></h3><span className={`ops-state ops-state-${job.status}`}>{readable(job.status)}</span></div>
    {job.kind === 'research' && <p>Engine: {job.payload?.engine || 'crewai'}</p>}
    <p>Stage: <strong>{readable(job.stage)}</strong> · Attempts: {job.attempts || 0}</p>
    {job.error && <p className="ops-warning">{typeof job.error === 'string' ? job.error : JSON.stringify(job.error)}</p>}
    <details><summary>Checkpoint and result</summary><pre>{JSON.stringify({ checkpoint: job.checkpoint, result: job.result }, null, 2)}</pre></details>
    {artifacts.length > 0 && <div><h4>Immutable artifact references</h4><ul>{artifacts.map((item) => <li key={item.sha256}><code>{item.sha256}</code><br/><span>{item.uri}</span><br/>{item.bytes} bytes · {item.mediaType}</li>)}</ul></div>}
    {['paused', 'failed'].includes(job.status) && (job.kind !== 'inference' || job.internalWarmup) && <button disabled={busy} onClick={() => execute(`/jobs/${job.id}/resume`, {})}>Resume this job</button>}
    {job.status === 'ready-for-review' && <form className="ops-review" onSubmit={(event) => { event.preventDefault(); execute(`/jobs/${job.id}/approvals`, { category, decision: event.nativeEvent.submitter?.value || 'rejected', artifactSha256: selected, note }); }}>
      <h4>Record a human decision</h4>
      <p>Review the referenced file or draft independently. Each decision applies only to the selected artifact and purpose.</p>
      <label>Purpose<select value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.filter((item) => item !== 'visual' || job.kind === 'video').map((item) => <option key={item} value={item}>{readable(item)}</option>)}</select></label>
      <label>Artifact<select value={selected} onChange={(event) => setArtifact(event.target.value)} required><option value="" disabled>Select an artifact</option>{artifacts.map((item) => <option key={item.sha256} value={item.sha256}>{item.sha256.slice(0, 16)} · {item.mediaType}</option>)}</select></label>
      <label>Review note<textarea required maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} rows={2}/></label>
      <div className="ops-actions"><button type="submit" value="approved" disabled={busy || !selected}>Record approval</button><button type="submit" value="rejected" disabled={busy || !selected}>Record rejection</button></div>
    </form>}
    {records.length > 0 && <ul aria-label="Approval history">{records.map((item) => <li key={item.id}><strong>{readable(item.category)}: {item.decision}</strong> · {item.note}<br/><code>{item.artifactSha256}</code></li>)}</ul>}
  </article>;
}

export function OperationsWorkspace() {
  const key = useRef('');
  const generation = useRef(0);
  const activeRequests = useRef(new Set());
  const submitting = useRef(false);
  const refreshSequence = useRef(0);
  const submissionKey = useRef(crypto.randomUUID());
  const [credential, setCredential] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [kind, setKind] = useState('video');
  const [engine, setEngine] = useState('crewai');
  const [workflow, setWorkflow] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sources, setSources] = useState('[]');
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('all');

  function logout() {
    generation.current += 1;
    key.current = '';
    for (const controller of activeRequests.current) controller.abort();
    activeRequests.current.clear();
    setCredential(''); setSnapshot(null); setOnline(false); setError(''); setMessage(''); setBusy(false);
  }

  async function request(path, body, token = key.current) {
    const controller = new AbortController();
    activeRequests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(`/api/ops${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: controller.signal });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) { logout(); throw new Error('Owner authentication failed.'); }
        if (response.status === 503) throw new Error('Operations are unavailable. Check the server configuration and durable store.');
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error ? readable(result.error) : 'The operation was not accepted.');
      }
      return await response.json();
    } finally { clearTimeout(timer); activeRequests.current.delete(controller); }
  }

  async function refresh(epoch = generation.current) {
    const sequence = ++refreshSequence.current;
    const current = () => sequence === refreshSequence.current && epoch === generation.current && key.current;
    try {
      const result = await request('/status');
      if (current()) { setSnapshot(result); setOnline(true); setError(''); }
      return true;
    } catch (failure) {
      if (current()) { setOnline(false); setError(failure.name === 'AbortError' ? 'Status refresh timed out.' : failure.message); }
      return false;
    }
  }

  useEffect(() => { document.title = 'Private operations | BrainSNN'; return () => { generation.current += 1; key.current = ''; for (const controller of activeRequests.current) controller.abort(); }; }, []);
  const authenticated = snapshot !== null;
  useEffect(() => {
    if (!authenticated) return;
    let stopped = false;
    let timer;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(poll, 3000);
    };
    timer = setTimeout(poll, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [authenticated]);

  async function login(event) {
    event.preventDefault(); setBusy(true); setError('');
    const epoch = ++generation.current;
    try {
      const result = await request('/status', undefined, credential);
      if (epoch !== generation.current) return;
      key.current = credential; setCredential(''); setSnapshot(result); setOnline(true);
    } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); }
    finally { setBusy(false); }
  }

  async function execute(path, body) {
    if (submitting.current) return false;
    submitting.current = true; setBusy(true); setError(''); setMessage('');
    const epoch = generation.current;
    try {
      await request(path, body);
      if (epoch !== generation.current) return false;
      setMessage('Recorded.'); return await refresh(epoch);
    } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); return false; }
    finally { submitting.current = false; setBusy(false); }
  }

  async function submit(event) {
    event.preventDefault();
    let payload;
    try { payload = kind === 'video' ? { workflowId: workflow, prompt } : { objective: prompt, sources: JSON.parse(sources), engine }; }
    catch { setError('Evidence sources must be a JSON array.'); return; }
    if (await execute('/jobs', { kind, payload, idempotencyKey: submissionKey.current })) submissionKey.current = crypto.randomUUID();
  }
  function changeSubmission(update) { submissionKey.current = crypto.randomUUID(); update(); }
  const control = snapshot?.control || {};
  const jobs = snapshot?.jobs || [];
  return <div className="ops-site" data-build-marker="brainsnn-private-operations">
    <header className="ops-header"><a href="/">BrainSNN <span>/ private operations</span></a>{authenticated && <button onClick={logout}>Lock operations</button>}</header>
    <main><p className="ops-eyebrow">OWNER WORKSPACE</p><h1>Work queue</h1>
      {!authenticated ? <form className="ops-panel ops-login" onSubmit={login}><h2>Owner sign in</h2><p>Use the owner credential configured for this server. It is kept in this page’s memory until you lock or leave.</p><label>Owner credential<input type="password" required autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)}/></label><button disabled={busy} type="submit">{busy ? 'Checking…' : 'Unlock operations'}</button></form> : <>
        <p className="ops-boundary">Artifacts and drafts await human review. Approval records do not send outreach, publish content, or spend money. External execution is disabled.</p>
        <section className="ops-panel" aria-labelledby="ops-control-title"><div className="ops-row"><h2 id="ops-control-title">Scheduler</h2><span className="ops-state">{control.kill ? 'killed' : control.hardwarePaused ? 'hardware hold' : control.gpuQuarantined ? 'quarantined' : control.paused ? 'paused' : 'accepting work'}</span></div>{control.idleResident && <p>Inference model resident and idle; video handoff drains it before rendering.</p>}<p>{control.reason || 'Video has priority at the next job boundary. One GPU job runs at a time.'}</p><label>Operator reason<input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Record the reason for this change"/></label><div className="ops-actions"><button disabled={busy || !reason.trim()} onClick={() => execute('/control', { action: 'pause', reason })}>Pause after current job</button><button disabled={busy || !reason.trim() || control.hardwarePaused || control.gpuQuarantined} onClick={() => execute('/control', { action: 'resume', reason })}>Resume scheduler</button><button className="ops-danger" disabled={busy || !reason.trim()} onClick={() => execute('/control', { action: 'kill', reason })}>Stop all work</button></div>
          {(control.hardwarePaused || control.gpuQuarantined) && <details className="ops-clear"><summary>Clear a verified hardware or lease hold</summary><p>First stop the worker and verify that all owned GPU processes are quiescent. Follow the runbook to clear the local runtime latch after host clearance. Record that evidence here; clearing this hold leaves the scheduler paused.</p><button disabled={busy || !reason.trim()} onClick={() => execute('/control', { action: 'clear-hardware', reason })}>Record verified clearance</button></details>}
        </section>
        <section className="ops-panel" aria-label="Operations evidence">
          <h2>Deployment readiness: {online && snapshot.readiness?.ready === true ? 'assertions satisfied' : 'blocked'}</h2>
          <p>Control plane: {online ? 'online' : 'unverified — refresh failed'}</p>
          <p>GPU worker readiness: {online && snapshot.readiness?.ready === true ? 'assertions satisfied; physical checks still required' : 'unverified'}</p>
          <p>Worker contact: {!online ? 'unverified' : snapshot.readiness?.checks?.find(item => item.id === 'workerContact')?.reason === 'authenticated_contact_only' ? 'recent (within 60 seconds); contact only' : snapshot.workerContacts?.length ? 'stale or conflicting' : 'absent'}</p>
          <p>Read-only assessment. Missing evidence blocks readiness. Human assertions do not independently verify hardware or authorize cutover.</p>
          <details><summary>Readiness reasons and evidence types</summary><ul>{snapshot.readiness?.checks?.map(item => <li key={item.id}><strong>{item.id}: {item.state}</strong> · {item.source === 'operator' ? 'human assertion' : 'machine check'}<br/>{item.reason}</li>)}</ul></details>
          <h3>Persisted job outcomes</h3>
          <p>Ready for review: {snapshot.metrics?.readyForReview ?? 'unknown'} · Failed: {snapshot.metrics?.failed ?? 'unknown'}</p>
          <p>All retained jobs, excluding internal warmups. Completion does not mean approval. {online ? '' : 'Showing the last received snapshot.'}</p>
        </section>
        <section className="ops-panel"><h2>Queue work</h2><form onSubmit={submit} className="ops-submit"><label>Work type<select value={kind} onChange={(event) => changeSubmission(() => setKind(event.target.value))}><option value="video">Video render</option><option value="research">Research and draft</option></select></label>{kind === 'video' && <label>Configured workflow ID<input required value={workflow} maxLength={80} onChange={(event) => changeSubmission(() => setWorkflow(event.target.value))}/></label>}<label>{kind === 'video' ? 'Render prompt' : 'Research objective'}<textarea required value={prompt} maxLength={kind === 'video' ? 8000 : 2000} rows={3} onChange={(event) => changeSubmission(() => setPrompt(event.target.value))}/></label>{kind === 'research' && <label>Research engine<select value={engine} onChange={(event) => changeSubmission(() => setEngine(event.target.value))}><option value="crewai">CrewAI</option><option value="swarms-crewai">Swarms proposal/critique → CrewAI</option></select></label>}{kind === 'research' && <label>Evidence sources (JSON)<textarea value={sources} required rows={5} onChange={(event) => changeSubmission(() => setSources(event.target.value))} aria-describedby="ops-evidence-help"/><small id="ops-evidence-help">Supply 1–4 source objects with id, title, url (HTTPS), and content (up to 6,000 characters each). Only supplied evidence is available to the worker; links are not fetched.</small></label>}<button disabled={busy} type="submit">Queue {kind === 'video' ? 'render' : 'research'}</button></form></section>
        <section aria-labelledby="ops-jobs-title"><div className="ops-row"><h2 id="ops-jobs-title">Jobs <span>({jobs.length})</span></h2><label>Show status<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All states</option>{STATES.map((state) => <option key={state} value={state}>{readable(state)} ({jobs.filter((job) => job.status === state).length})</option>)}</select></label></div>{jobs.length === 0 && <p>No jobs queued.</p>}{jobs.filter((job) => filter === 'all' || job.status === filter).map((job) => <JobRecord key={job.id} job={job} approvals={snapshot.approvals || []} execute={execute} busy={busy}/>)}</section>
      </>}
      {error && <p className="ops-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </main>
  </div>;
}
