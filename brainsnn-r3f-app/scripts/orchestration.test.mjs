import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Readable, Writable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { createOrchestration } from '../src/server/orchestration.js';

const OWNER = 'o'.repeat(40), WORKER = 'w'.repeat(40), SHA = 'a'.repeat(64);
const RESEARCH = { objective: 'local', sources: [{ id: 's1', title: 'Fixture', url: 'https://example.invalid/evidence', content: 'Local evidence only.' }] };
async function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'brainsnn-scheduler-'));
  let now = 100000;
  const env = { ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1', ORCHESTRATION_DB_PATH: join(dir, 'queue.db'), ORCHESTRATION_OWNER_KEY: OWNER, ORCHESTRATION_WORKER_KEY: WORKER, ...options.env };
  let orchestration = createOrchestration(env, { now: () => now, leaseMs: 1000, ...options });
  const dispatch = (req, res, target = orchestration) => {
    const owner = req.url.startsWith('/owner/');
    req.url = req.url.replace(/^\/(owner|worker)/, '');
    return (owner ? target.handleOwner : target.handleWorker)(req, res);
  };
  let server;
  if (process.env.ORCHESTRATION_TEST_HTTP === '1') {
    server = createServer(dispatch);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  }
  t.after(async () => { orchestration.close(); if (server) await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const call = async (surface, path, body, override = {}, target = orchestration) => {
    const headers = { authorization: `Bearer ${surface === 'owner' ? OWNER : WORKER}`, 'x-brainsnn-worker': 'worker_1234', 'content-type': 'application/json', ...Object.fromEntries(Object.entries(override).map(([k,v]) => [k.toLowerCase(),v])) };
    if (server) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/${surface}${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    // Same production auth/body/HTTP handlers, real Node readable/writable streams.
    // Socket binding is denied in the managed sandbox; ORCHESTRATION_TEST_HTTP=1
    // exercises the identical tests through a real loopback HTTP server elsewhere.
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.headers = headers; req.method = body === undefined ? 'GET' : 'POST'; req.url = `/${surface}${path}`;
    const chunks = []; let status = 200;
    const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(chunk); callback(); } });
    res.setHeader = () => {}; res.writeHead = code => { status = code; };
    const finished = new Promise(resolve => res.once('finish', resolve));
    await dispatch(req, res, target); await finished;
    return { status, body: JSON.parse(Buffer.concat(chunks).toString()) };
  };
  const submit = async (key, kind = 'video', payload = { workflowId: 'approved-local' }) => {
    const r = await call('owner', '/jobs', { idempotencyKey: key, kind, payload });
    assert.equal(r.status, 201); return r.body.job;
  };
  return { call, submit, env, connect: () => { const other = createOrchestration(env, { now: () => now, leaseMs: 1000, ...options }); t.after(() => other.close()); return other; }, clock: n => { now += n; }, scheduler: () => orchestration, restart: () => { orchestration.close(); orchestration = createOrchestration(env, { now: () => now, leaseMs: 1000, ...options }); } };
}

test('missing/weak/shared auth or non-durable configuration fails closed', async () => {
  for (const env of [{}, { ORCHESTRATION_ENABLED: '1' }, { ORCHESTRATION_ENABLED: '1', ORCHESTRATION_OWNER_KEY: OWNER, ORCHESTRATION_WORKER_KEY: OWNER, ORCHESTRATION_SINGLE_REPLICA: '1', ORCHESTRATION_DB_PATH: ':memory:' }]) {
    const s = createOrchestration(env); assert.equal(s.configured, false); assert.equal((await s.request('models', { method: 'GET' })).status, 503); s.close();
  }
});

test('owner and worker endpoints reject wrong or swapped credentials', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('owner', '/status', undefined, { Authorization: '' })).status, 401);
  assert.equal((await f.call('owner', '/status', undefined, { Authorization: `Bearer ${WORKER}` })).status, 401);
  assert.equal((await f.call('worker', '/next', undefined, { Authorization: `Bearer ${OWNER}` })).status, 401);
  assert.equal((await f.call('worker', '/next', undefined, { 'X-BrainSNN-Worker': '' })).status, 400);
});

test('idempotent submissions persist across restart and conflicting reuse is rejected', async t => {
  const f = await fixture(t); const job = await f.submit('unique-1'); f.restart();
  const duplicate = await f.call('owner', '/jobs', { idempotencyKey: 'unique-1', kind: 'video', payload: { workflowId: 'approved-local' } });
  assert.equal(duplicate.status, 200); assert.equal(duplicate.body.job.id, job.id);
  assert.equal((await f.call('owner', '/jobs', { idempotencyKey: 'unique-1', kind: 'video', payload: { workflowId: 'different' } })).status, 409);
  assert.equal(f.scheduler().snapshot().jobs.length, 1);
});

test('parallel worker claims grant one lease, video wins at a job boundary', async t => {
  const f = await fixture(t); await f.submit('research-first', 'research', RESEARCH);
  const video = await f.submit('video-next');
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.call('worker', '/next')));
  const leased = claims.filter(r => r.body.job); assert.equal(leased.length, 1); assert.equal(leased[0].body.job.id, video.id);
  assert.equal(leased[0].body.job.stage, 'generating');
});

test('active inference finishes before video and no overlapping GPU leases exist', async t => {
  const f = await fixture(t); await f.submit('inference', 'inference', { operation: 'models' });
  const first = (await f.call('worker', '/next')).body.job; await f.submit('video');
  assert.equal((await f.call('worker', '/next')).body.job, null);
  assert.equal((await f.call('worker', `/jobs/${first.id}/complete`, { quiescent: true, token: first.lease.token, result: { status: 200, body: { data: [] } }, artifacts: [] })).status, 200);
  assert.equal((await f.call('worker', '/next')).body.job.kind, 'video');
});

test('lease expiry fences old worker, quarantines GPU durably, requires quiescence and explicit resume', async t => {
  const f = await fixture(t); await f.submit('expired'); const job = (await f.call('worker', '/next')).body.job;
  f.clock(1001); assert.equal((await f.call('worker', '/next')).body.job, null); f.restart();
  assert.equal(f.scheduler().snapshot().control.gpuQuarantined, true);
  assert.equal((await f.call('worker', `/jobs/${job.id}/heartbeat`, { token: job.lease.token })).status, 409);
  assert.equal((await f.call('worker', `/jobs/${job.id}/complete`, { quiescent: true, token: job.lease.token, result: {}, artifacts: [] })).status, 409);
  assert.equal((await f.call('owner', `/jobs/${job.id}/resume`, {})).status, 409);
  assert.equal((await f.call('worker', '/reconcile', { quiescent: false, reason: 'not stopped' })).status, 400);
  assert.equal((await f.call('worker', '/reconcile', { quiescent: true, reason: 'owned processes stopped' }, { 'X-BrainSNN-Worker': 'other_worker' })).status, 409);
  assert.equal((await f.call('worker', '/reconcile', { quiescent: true, reason: 'owned processes stopped' })).status, 200);
  assert.equal((await f.call('owner', `/jobs/${job.id}/resume`, {})).status, 200);
  const next = (await f.call('worker', '/next')).body.job; assert.equal(next.id, job.id); assert.notEqual(next.lease.token, job.lease.token);
});

test('checkpoint history and decoding stage survive restart and resume', async t => {
  const f = await fixture(t); await f.submit('checkpoint'); const job = (await f.call('worker', '/next')).body.job;
  assert.equal((await f.call('worker', `/jobs/${job.id}/checkpoint`, { token: job.lease.token, stage: 'decoding', checkpoint: { latent: 'immutable://latent' } })).status, 200);
  assert.equal((await f.call('worker', `/jobs/${job.id}/checkpoint`, { token: job.lease.token, stage: 'generating', checkpoint: {} })).status, 409);
  f.clock(1001); f.restart();
  await f.call('worker', '/reconcile', { quiescent: true, reason: 'stopped' }); await f.call('owner', `/jobs/${job.id}/resume`, {});
  const next = (await f.call('worker', '/next')).body.job;
  assert.equal(next.stage, 'decoding'); assert.equal(next.checkpoint.latent, 'immutable://latent');
  assert.equal(f.scheduler().snapshot().jobs[0].checkpoints.length, 1);
});

test('transport retries are bounded; hardware cannot retry or clear through general resume', async t => {
  const f = await fixture(t); await f.submit('transport');
  for (let n = 1; n <= 3; n++) { const job = (await f.call('worker', '/next')).body.job; assert.equal(job.attempts, n); await f.call('worker', `/jobs/${job.id}/fail`, { token: job.lease.token, category: 'transport', message: 'connection reset', quiescent: true }); }
  assert.equal(f.scheduler().snapshot().jobs[0].status, 'failed');
  const hard = await f.submit('hardware'); const job = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/fail`, { token: job.lease.token, category: 'hardware', message: 'NVML Xid79 device lost', quiescent: true });
  assert.equal(f.scheduler().snapshot().control.hardwarePaused, true);
  assert.equal((await f.call('owner', '/control', { action: 'resume' })).status, 409);
  assert.equal((await f.call('owner', `/jobs/${hard.id}/resume`, {})).status, 409);
  await f.call('worker', '/reconcile', { quiescent: true, reason: 'stopped' });
  assert.equal(f.scheduler().snapshot().control.hardwarePaused, true);
  assert.equal((await f.call('owner', '/control', { action: 'clear-hardware', reason: 'owner verified device healthy and all old processes stopped' })).status, 200);
  await f.call('owner', '/control', { action: 'resume' });
  assert.equal((await f.call('worker', '/next')).body.job, null);
});

test('global pause drains current lease, kill fences and requires quiescence before resuming', async t => {
  const f = await fixture(t); await f.submit('kill'); const job = (await f.call('worker', '/next')).body.job;
  await f.call('owner', '/control', { action: 'pause' });
  assert.equal((await f.call('worker', `/jobs/${job.id}/heartbeat`, { token: job.lease.token })).status, 200);
  await f.call('owner', '/control', { action: 'kill', reason: 'operator stop' });
  assert.equal((await f.call('worker', `/jobs/${job.id}/heartbeat`, { token: job.lease.token })).status, 409);
  assert.equal((await f.call('owner', '/control', { action: 'resume' })).status, 409);
  await f.call('worker', '/reconcile', { quiescent: true, reason: 'owned processes stopped' });
  assert.equal((await f.call('owner', '/control', { action: 'resume' })).status, 200);
});

test('completion stores immutable artifacts with separate human-only approval records', async t => {
  const f = await fixture(t); await f.submit('review'); const job = (await f.call('worker', '/next')).body.job;
  const artifact = { sha256: SHA, uri: `sha256:${SHA}`, bytes: 1234, mediaType: 'video/mp4' };
  assert.equal((await f.call('worker', `/jobs/${job.id}/complete`, { quiescent: true, token: job.lease.token, result: { rendered: true }, artifacts: [artifact] })).status, 200);
  let s = f.scheduler().snapshot(); assert.equal(s.jobs[0].status, 'ready-for-review'); assert.equal(s.approvals.length, 0);
  assert.equal((await f.call('owner', `/jobs/${job.id}/approvals`, { category: 'publication', decision: 'approved', artifactSha256: 'b'.repeat(64) })).status, 400);
  for (const category of ['visual', 'outreach', 'publication', 'spend']) assert.equal((await f.call('owner', `/jobs/${job.id}/approvals`, { category, decision: 'approved', artifactSha256: SHA, note: 'human reviewed exact bytes' })).status, 201);
  assert.equal((await f.call('worker', `/jobs/${job.id}/approvals`, { category: 'visual', decision: 'approved', artifactSha256: SHA })).status, 404);
  assert.equal((await f.call('owner', '/control', { action: 'enable-external-execution' })).status, 400);
  f.restart(); s = f.scheduler().snapshot(); assert.equal(s.approvals.length, 4); assert.equal(s.control.externalExecution, false); assert.deepEqual(s.jobs[0].artifacts, [artifact]);
});

test('durable inference request forwards a real worker result and handles bounded deadline safely', async t => {
  const f = await fixture(t, { deadlineMs: 120, responsePollMs: 5 });
  const waiting = f.scheduler().request('chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'local' }] }) });
  const job = (await f.call('worker', '/next')).body.job; assert.equal(job.kind, 'inference');
  await f.call('worker', `/jobs/${job.id}/complete`, { quiescent: true, token: job.lease.token, result: { status: 200, body: { choices: [{ message: { content: 'controlled adapter output' } }] } }, artifacts: [] });
  const response = await waiting; assert.equal(response.status, 200); assert.match(JSON.stringify(await response.json()), /controlled adapter output/);
  const expired = f.scheduler().request('models', { method: 'GET' }); await f.call('worker', '/next');
  assert.equal((await expired).status, 504); assert.equal(f.scheduler().snapshot().control.gpuQuarantined, true);
});


test('independent SQLite connections share one lease and schema rejects a second active GPU job', async t => {
  const f = await fixture(t); await f.submit('connection-one'); await f.submit('connection-two');
  const second = f.connect();
  const first = (await f.call('worker', '/next')).body.job;
  const collision = await f.call('worker', '/next', undefined, {}, second);
  assert.equal(collision.body.job, null); assert.equal(second.snapshot().jobs.filter(j => j.status === 'generating').length, 1);
  const db = new DatabaseSync(f.env.ORCHESTRATION_DB_PATH); t.after(() => db.close());
  assert.throws(() => db.prepare("UPDATE orchestration_jobs SET lease_token='illegal' WHERE id<>?").run(first.id), /UNIQUE constraint failed/);
});

test('first rejected stale heartbeat durably latches quarantine before any status read', async t => {
  const f = await fixture(t); await f.submit('heartbeat-expired'); const job = (await f.call('worker', '/next')).body.job;
  f.clock(1001);
  assert.equal((await f.call('worker', `/jobs/${job.id}/heartbeat`, { token: job.lease.token })).status, 409);
  const db = new DatabaseSync(f.env.ORCHESTRATION_DB_PATH); t.after(() => db.close());
  assert.equal(db.prepare('SELECT quarantine FROM orchestration_control').get().quarantine, 1);
  assert.equal(db.prepare('SELECT lease_token FROM orchestration_jobs WHERE id=?').get(job.id).lease_token, null);
});

test('missing quiescence prevents transport retry and hardware signatures override caller category', async t => {
  const f = await fixture(t); await f.submit('unsafe-retry'); const job = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/fail`, { token: job.lease.token, category: 'transport', message: 'connection lost' });
  assert.equal(f.scheduler().snapshot().control.gpuQuarantined, true); assert.equal((await f.call('worker', '/next')).body.job, null);
  await f.call('worker', '/reconcile', { quiescent: true, reason: 'all owned processes stopped' });
  await f.call('owner', `/jobs/${job.id}/resume`, {});
  const retry = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/fail`, { token: retry.lease.token, category: 'transport', message: 'NVML device lost Xid79', quiescent: true });
  assert.equal(f.scheduler().snapshot().control.hardwarePaused, true);
});

test('content-addressed artifact identity and append-only evidence are enforced in SQLite', async t => {
  const f = await fixture(t); await f.submit('immutable'); const job = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/checkpoint`, { token: job.lease.token, stage: 'decoding', checkpoint: { step: 1 } });
  const artifact = { sha256: SHA, uri: `sha256:${SHA}`, bytes: 1234, mediaType: 'video/mp4' };
  assert.equal((await f.call('worker', `/jobs/${job.id}/complete`, { quiescent: true, token: job.lease.token, result: {}, artifacts: [{ ...artifact, uri: 'https://example.invalid/latest.mp4' }] })).status, 400);
  assert.equal((await f.call('worker', `/jobs/${job.id}/complete`, { quiescent: true, token: job.lease.token, result: {}, artifacts: [artifact] })).status, 200);
  await f.call('owner', `/jobs/${job.id}/approvals`, { category: 'visual', decision: 'approved', artifactSha256: SHA });
  const db = new DatabaseSync(f.env.ORCHESTRATION_DB_PATH); t.after(() => db.close());
  assert.throws(() => db.exec("UPDATE orchestration_artifacts SET bytes=999"), /immutable_artifact/);
  assert.throws(() => db.exec('DELETE FROM orchestration_approvals'), /immutable_approval/);
  assert.throws(() => db.exec('DELETE FROM orchestration_checkpoints'), /immutable_checkpoint/);
  await f.submit('same-hash-conflict'); const another = (await f.call('worker', '/next')).body.job;
  assert.equal((await f.call('worker', `/jobs/${another.id}/complete`, { quiescent: true, token: another.lease.token, result: {}, artifacts: [{ ...artifact, bytes: 999 }] })).status, 409);
  assert.equal(f.scheduler().snapshot().approvals.length, 1);
});


test('canonical warmup survives website timeout, warms once, and binds resident worker affinity', async t => {
  const f = await fixture(t, { env: { GPU_INFERENCE_MODEL: 'controlled-model' }, deadlineMs: 35, responsePollMs: 5 });
  const abort = new AbortController();
  const website = f.scheduler().request('models', { method: 'GET', signal: abort.signal });
  const warm = (await f.call('worker', '/next')).body.job;
  assert.equal(warm.internalWarmup, true); assert.equal(warm.payload.operation, 'models');
  abort.abort(); assert.equal((await website).status, 504);
  assert.equal(f.scheduler().snapshot().control.gpuQuarantined, false);
  assert.equal((await f.call('worker', `/jobs/${warm.id}/heartbeat`, { token: warm.lease.token })).status, 200);
  assert.equal((await f.call('worker', `/jobs/${warm.id}/complete`, { token: warm.lease.token, quiescent: false, idleResident: true, result: { status: 200, body: { data: [{ id: 'controlled-model' }] } }, artifacts: [] })).status, 200);
  assert.equal(f.scheduler().snapshot().control.idleResident, true);
  assert.equal(f.scheduler().snapshot().control.warmRequired, false);
  const video = await f.submit('video-drains-resident');
  assert.equal((await f.call('worker', '/next', undefined, { 'X-BrainSNN-Worker': 'other_worker' })).body.job, null);
  assert.equal((await f.call('worker', '/reconcile', { quiescent: true, reason: 'other process' }, { 'X-BrainSNN-Worker': 'other_worker' })).status, 409);
  const next = (await f.call('worker', '/next')).body.job; assert.equal(next.id, video.id);
  assert.equal((await f.call('worker', `/jobs/${video.id}/complete`, { token: next.lease.token, quiescent: true, result: { rendered: true }, artifacts: [{ sha256: SHA, uri: `sha256:${SHA}`, bytes: 4, mediaType: 'video/mp4' }] })).status, 200);
  assert.equal(f.scheduler().snapshot().control.idleResident, false);
  assert.equal((await f.call('worker', '/next')).body.job, null);
  const secondAbort = new AbortController();
  const secondWebsite = f.scheduler().request('models', { method: 'GET', signal: secondAbort.signal });
  const rewarm = (await f.call('worker', '/next')).body.job; assert.equal(rewarm.internalWarmup, true); assert.notEqual(rewarm.id, warm.id);
  secondAbort.abort(); assert.equal((await secondWebsite).status, 504);
});

test('warmup is durable, lower priority than video/research, and exhausted retries do not recreate it', async t => {
  const f = await fixture(t, { env: { GPU_INFERENCE_MODEL: 'controlled-model' } });
  await f.submit('research-before-warmup', 'research', RESEARCH);
  const research = (await f.call('worker', '/next')).body.job; assert.equal(research.kind, 'research');
  await f.call('worker', `/jobs/${research.id}/fail`, { token: research.lease.token, category: 'invalid', message: 'controlled invalid fixture', quiescent: true });
  const demandAbort = new AbortController();
  const demand = f.scheduler().request('models', { method: 'GET', signal: demandAbort.signal });
  let first;
  for (let n = 1; n <= 3; n++) {
    const warm = (await f.call('worker', '/next')).body.job; assert.equal(warm.internalWarmup, true);
    first ??= warm.id; assert.equal(warm.id, first); assert.equal(warm.attempts, n);
    if (n === 1) { demandAbort.abort(); assert.equal((await demand).status, 504); }
    await f.call('worker', `/jobs/${warm.id}/fail`, { token: warm.lease.token, category: 'transport', message: 'controlled unavailable backend', quiescent: true });
    f.restart();
  }
  assert.equal((await f.call('worker', '/next')).body.job, null);
  assert.equal(f.scheduler().snapshot().jobs.filter(j => j.internalWarmup).length, 1);
  assert.equal((await f.scheduler().request('models', { method: 'GET' })).status, 503);
  assert.equal((await f.call('owner', `/jobs/${first}/resume`, {})).status, 200);
  assert.equal((await f.call('worker', '/next')).body.job.id, first);
});

test('research packets are validated before GPU leasing and cannot smuggle execution settings', async t => {
  const f = await fixture(t);
  for (const payload of [
    { objective: 'missing sources' },
    { ...RESEARCH, externalExecution: true },
    { ...RESEARCH, sources: [{ id: 's1', url: 'https://example.invalid', text: 'wrong contract' }] },
    { ...RESEARCH, sources: [{ ...RESEARCH.sources[0], url: 'http://example.invalid' }] },
    { ...RESEARCH, sources: [RESEARCH.sources[0], RESEARCH.sources[0]] },
    { ...RESEARCH, objective: 'x'.repeat(2001) },
  ]) {
    assert.equal((await f.call('owner', '/jobs', { idempotencyKey: 'bad-research', kind: 'research', payload })).status, 400);
  }
  assert.equal(f.scheduler().snapshot().jobs.length, 0);
  await f.submit('valid-research', 'research', RESEARCH);
  assert.equal((await f.call('worker', '/next')).body.job.kind, 'research');
});


test('idle resident hardware fault is authenticated, durable, and requires owner clearance', async t => {
  const f = await fixture(t); await f.submit('idle-model', 'inference', { operation: 'models' });
  const job = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/complete`, { token: job.lease.token, quiescent: false, idleResident: true, result: { status: 200, body: { data: [] } }, artifacts: [] });
  assert.equal((await f.call('worker', '/fault', { category: 'hardware', message: 'NVML lost while idle', quiescent: true }, { 'X-BrainSNN-Worker': 'other_worker' })).status, 409);
  assert.equal((await f.call('worker', '/fault', { category: 'hardware', message: 'NVML lost while idle', quiescent: true })).status, 200);
  f.restart(); assert.equal(f.scheduler().snapshot().control.hardwarePaused, true);
  assert.equal((await f.call('owner', '/control', { action: 'resume' })).status, 409);
});

test('kill of idle resident waits for worker quiescence before owner resume', async t => {
  const f = await fixture(t); await f.submit('idle-kill', 'inference', { operation: 'models' });
  const job = (await f.call('worker', '/next')).body.job;
  await f.call('worker', `/jobs/${job.id}/complete`, { token: job.lease.token, quiescent: false, idleResident: true, result: { status: 200, body: { data: [] } }, artifacts: [] });
  await f.call('owner', '/control', { action: 'kill' });
  assert.equal(f.scheduler().snapshot().control.gpuQuarantined, true);
  assert.equal((await f.call('owner', '/control', { action: 'resume' })).status, 409);
  await f.call('worker', '/reconcile', { quiescent: true, reason: 'resident model stopped' });
  assert.equal(f.scheduler().snapshot().control.idleResident, false);
  assert.equal((await f.call('owner', '/control', { action: 'resume' })).status, 200);
});


test('idle polling without inference demand does not create warmup or reload models', async t => {
  const f = await fixture(t, { env: { GPU_INFERENCE_MODEL: 'controlled-model' } });
  for (let n = 0; n < 3; n++) assert.equal((await f.call('worker', '/next')).body.job, null);
  assert.equal(f.scheduler().snapshot().jobs.length, 0);
  const owner = await f.submit('explicit-model-demand', 'inference', { operation: 'models' });
  const warm = (await f.call('worker', '/next')).body.job;
  assert.equal(warm.internalWarmup, true); assert.notEqual(warm.id, owner.id);
});

test('research engine selection is durable, allowlisted and part of idempotency', async t => {
  const f = await fixture(t);
  for (const engine of ['auto', '', null, {}, 'swarms']) {
    assert.equal((await f.call('owner', '/jobs', { idempotencyKey: 'bad-engine', kind: 'research', payload: { ...RESEARCH, engine } })).status, 400);
  }
  await f.submit('hybrid-engine', 'research', { ...RESEARCH, engine: 'swarms-crewai' });
  const conflict = await f.call('owner', '/jobs', { idempotencyKey: 'hybrid-engine', kind: 'research', payload: { ...RESEARCH, engine: 'crewai' } });
  assert.equal(conflict.status, 409);
  const job = (await f.call('worker', '/next')).body.job;
  assert.equal(job.kind, 'research');
  assert.equal(job.payload.engine, 'swarms-crewai');
});

test('L3 abandoned inference terminalizes only after matching quiescence and frees capacity across restart', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 201; i++) {
    const job = await f.submit(`abandoned-${i}`, 'inference', { operation: 'models' });
    await f.call('worker', '/next');
    f.clock(1001);
    assert.equal(f.scheduler().snapshot().jobs.find(j => j.id === job.id).status, 'paused');
    assert.equal((await f.call('worker', '/reconcile', { quiescent: false, reason: 'uncertain' })).status, 400);
    await f.call('worker', '/reconcile', { quiescent: true, reason: 'verified stopped' });
    assert.equal(f.scheduler().snapshot().jobs.find(j => j.id === job.id).status, 'failed');
    if (i === 100) f.restart();
  }
  await f.submit('capacity-restored');
});
