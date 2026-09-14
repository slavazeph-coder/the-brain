// Actual durable scheduler + Python worker/runtime over a controlled stdio
// transport. Socket/Comfy/model adapters are fixtures, never live validation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createOrchestration } from '../../brainsnn-r3f-app/src/server/orchestration.js';

const root = mkdtempSync(join(tmpdir(), 'brainsnn-vertical-slice-'));
const env = { ORCHESTRATION_ENABLED: '1', ORCHESTRATION_SINGLE_REPLICA: '1', ORCHESTRATION_DB_PATH: join(root, 'jobs.sqlite'), ORCHESTRATION_OWNER_KEY: 'o'.repeat(40), ORCHESTRATION_WORKER_KEY: 'w'.repeat(40) };
let scheduler = createOrchestration(env);
const receipts = [], running = new Set();
let child;

async function call(surface, method, path, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.url = path; req.method = method;
  req.headers = { authorization: 'Bearer ' + (surface === 'owner' ? env.ORCHESTRATION_OWNER_KEY : env.ORCHESTRATION_WORKER_KEY), 'content-type': 'application/json', 'x-brainsnn-worker': 'controlled_slice' };
  return await new Promise((resolveReply, reject) => {
    const res = { destroyed: false, writableEnded: false, setHeader() {}, writeHead(code) { this.code = code; }, end(text) { this.writableEnded = true; resolveReply({ status: this.code, body: JSON.parse(text) }); } };
    Promise.resolve((surface === 'owner' ? scheduler.handleOwner : scheduler.handleWorker)(req, res)).catch(reject);
  });
}

try {
  assert.equal(scheduler.configured, true);
  const inference = await call('owner', 'POST', '/jobs', { idempotencyKey: 'slice-inference', kind: 'inference', payload: { operation: 'models' } });
  const video = await call('owner', 'POST', '/jobs', { idempotencyKey: 'slice-video', kind: 'video', payload: { workflowId: 'controlled-local', prompt: 'Controlled fixture only' } });
  assert.equal(inference.status, 201); assert.equal(video.status, 201);
  const diagnosticJobs = [];
  for (const objective of ['controlled cancellation', 'controlled timeout']) {
    const submitted = await call('owner', 'POST', '/jobs', { idempotencyKey: objective.replaceAll(' ', '-'), kind: 'research', payload: {
      engine: 'swarms-crewai', objective,
      sources: [{ id: 's1', title: 'Synthetic fixture', url: 'https://example.invalid/source', content: 'Synthetic evidence.' }],
    } });
    assert.equal(submitted.status, 201);
    diagnosticJobs.push(submitted.body.job.id);
  }
  scheduler.close(); scheduler = createOrchestration(env);
  assert.equal(scheduler.snapshot().jobs.length, 4, 'queue survives actual database close/reopen');
  const runtimeDir = join(root, 'runtime'); mkdirSync(runtimeDir);
  child = spawn('python3', [resolve('ops/gpu/tests/orchestration_slice_fixture.py'), runtimeDir], { env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = new Promise((resolveExit, reject) => { child.once('exit', code => resolveExit(code)); child.once('error', reject); });
  const timer = setTimeout(() => child.kill('SIGTERM'), 25000);
  try {
    for await (const line of createInterface({ input: child.stdout })) {
      const value = JSON.parse(line);
      if (value.request) {
        const r = value.request;
        const result = await call('worker', r.method, r.path, r.body === null ? undefined : r.body);
        child.stdin.write(JSON.stringify(result) + '\n');
      } else {
        receipts.push(value);
        if (value.event === 'child_started') { assert.equal(running.size, 0, 'no inference/render owned process overlap'); running.add(value.pid); }
        if (value.event === 'child_stopped') { assert.notEqual(value.returncode, null, 'child actually reaped'); assert.equal(running.delete(value.pid), true); }
      }
    }
    assert.equal(await exit, 0, stderr);
  } finally { clearTimeout(timer); }
  assert.equal(running.size, 0);
  const fixture = receipts.find(item => item.event === 'fixture_complete');
  assert.deepEqual(fixture.counts, { generate: 1, decode: 2 }, `transport retry resumes decode without regenerating: ${JSON.stringify(scheduler.snapshot().jobs.map(job => ({ kind: job.kind, status: job.status, error: job.error })))}`);
  assert.equal(receipts.find(item => item.event === 'child_started').kind, 'comfy_gpu', 'video wins despite inference submitted first');
  const status = scheduler.snapshot();
  assert.deepEqual(fixture.researchFailures, ['research_cancelled', 'inference_timeout']);
  for (const [index, id] of diagnosticJobs.entries()) {
    const failed = status.jobs.find(job => job.id === id);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.attempts, 1, 'diagnostics must not introduce automatic research retries');
    assert.equal(failed.error, fixture.researchFailures[index]);
    assert.deepEqual(failed.artifacts, []);
  }
  const result = status.jobs.find(job => job.id === video.body.job.id);
  assert.equal(result.status, 'ready-for-review'); assert.equal(result.result.visuallyApproved, false); assert.equal(result.result.sale, false);
  assert.equal(result.attempts, 2); assert.equal(result.artifacts.length, 2);
  assert.equal(status.jobs.find(job => job.id === inference.body.job.id).status, 'ready-for-review');
  for (const artifact of result.artifacts) {
    const bytes = readFileSync(join(runtimeDir, 'artifacts', artifact.sha256));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
    assert.equal(bytes.length, artifact.bytes);
  }
  assert.deepEqual(status.approvals, []);
  const artifactSha256 = result.artifacts.find(item => item.mediaType === 'image/png').sha256;
  for (const category of ['visual', 'outreach', 'publication', 'spend']) {
    const approval = await call('owner', 'POST', `/jobs/${result.id}/approvals`, { category, decision: category === 'visual' ? 'approved' : 'rejected', artifactSha256, note: 'Controlled fixture decision; no external action' });
    assert.equal(approval.status, 201);
  }
  scheduler.close(); scheduler = createOrchestration(env);
  assert.equal(scheduler.snapshot().approvals.length, 4);
  assert.equal(scheduler.snapshot().control.externalExecution, false);
  console.log(JSON.stringify({ passed: true, controlledAdapters: ['stdio scheduler transport', 'ComfyUI protocol', 'GPU health', 'OpenAI models', 'research failures'], realExecution: ['SQLite restart persistence', 'Node auth and scheduler handlers', 'Python outbound worker', 'owned subprocess start/stop/reap', 'pinned workflows', 'checkpoint and decode resume', 'SHA256 artifact files', 'separate durable approvals'], researchFailureCodes: fixture.researchFailures, researchAttemptsEach: 1, generateRuns: 1, decodeAttempts: 2, maxConcurrentOwnedChildren: 1, approvalRecords: 4, externalExecution: false, liveModelOrRenderValidated: false }, null, 2));
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  for (const pid of running) {
    // Only process groups whose starts this fixture observed, never discovery
    // or signalling of unrelated processes when a test assertion fails.
    try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  scheduler.close(); rmSync(root, { recursive: true, force: true });
}
