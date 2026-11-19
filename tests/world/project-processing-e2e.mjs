#!/usr/bin/env node
/**
 * Joined, test-only API/worker proof using an authored PNG and CPU inspect.
 * Requires the app's dev dependencies plus the Python worker requirements.
 * WORLD_PROJECT_TEST_PYTHON selects Python (default: python).
 * Uses private temporary PostgreSQL/PGlite and worker SQLite state, no providers,
 * GPU, production credentials, real site capture, or physical robot execution.
 * Kept outside *.test.mjs because the Python dependencies are optional locally.
 */
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createWorldProjectService } from '../../brainsnn-r3f-app/src/server/worldProjectService.js';
import { createProjectProcessingBridge } from '../../brainsnn-r3f-app/src/server/projectProcessingBridge.js';
import { createProjectsClient, createIdempotencyKey } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const express = require('express');
const repo = fileURLToPath(new URL('../../', import.meta.url));
const python = process.env.WORLD_PROJECT_TEST_PYTHON || 'python';
const secrets = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const redact = value => secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));

// A valid authored 12x12 RGB PNG; constructing it here avoids binary fixtures or
// a second Python process. Pixel values do not purport to depict a real site.
function authoredPng() {
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    let crc = 0xffffffff;
    for (const byte of payload) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0);
    payload.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(12, 0); header.writeUInt32BE(12, 4);
  header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(12 * (1 + 12 * 3));
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const start = y * 37 + 1 + x * 3;
    pixels[start] = 40; pixels[start + 1] = 70; pixels[start + 2] = 90;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function stopWorker(worker) {
  if (!worker) return;
  if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGTERM');
  let timer;
  const stopped = await Promise.race([worker.closed.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 5000); })]);
  clearTimeout(timer);
  if (!stopped) {
    worker.child.kill('SIGKILL');
    await worker.closed;
  }
}

async function startWorker({ directory, registry, operatorToken, port }) {
  const env = Object.fromEntries(['PATH', 'HOME', 'SYSTEMROOT', 'TMPDIR', 'LANG', 'LC_ALL'].filter(name => process.env[name]).map(name => [name, process.env[name]]));
  Object.assign(env, {
    PYTHONPATH: repo, PYTHONUNBUFFERED: '1',
    WORLD_WORKER_TOKEN: operatorToken, WORLD_WORKER_DIR: directory,
    WORLD_TENANTS_FILE: registry, WORLD_STORAGE_BYTES: String(20 * 1024 ** 3),
    WORLD_ADAPTERS_FILE: '', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
    CUDA_VISIBLE_DEVICES: '',
  });
  const child = spawn(python, ['-m', 'uvicorn', 'robotics.world_worker.app:create_app', '--factory', '--host', '127.0.0.1', '--port', String(port), '--no-access-log', '--log-level', 'warning'], {
    cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const worker = { child, logs: '', failed: null, url: `http://127.0.0.1:${port}/` };
  worker.closed = new Promise(resolve => child.once('close', resolve));
  child.on('error', error => { worker.failed = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    const text = bytes.toString('utf8');
    if (secrets.some(secret => text.includes(secret))) worker.failed = new Error('Worker emitted a credential; raw logs suppressed.');
    worker.logs = (worker.logs + redact(text)).slice(-12000);
  });
  try {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (worker.failed || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Worker did not start: ${redact(worker.failed?.message || worker.logs || 'process exited')}`);
      }
      try {
        const response = await fetch(new URL('healthz', worker.url), { signal: AbortSignal.timeout(500) });
        if (response.ok && (await response.json()).status === 'ok') return worker;
      } catch { /* Startup is polled within the bounded deadline. */ }
      await delay(100);
    }
    throw new Error(`Worker health deadline exceeded. ${worker.logs}`);
  } catch (error) { await stopWorker(worker); throw error; }
}

async function startSite({ directory, tenantId, workerToken, workerUrl, bootstrap = false }) {
  // Explicit empty connectionString prevents ambient database settings from
  // changing this isolated test into a write to an external PostgreSQL service.
  const pool = await createProjectTestPool({ directory, connectionString: '' });
  const service = createWorldProjectService({ pool, env: {} });
  let server;
  try {
    await service.initialize();
    let credential;
    if (bootstrap) {
      const tenant = await service.provisionTenant({ id: tenantId, name: 'Authored processing E2E workspace' });
      credential = await service.provisionKey({ tenant_id: tenant.id, actor_name: 'Authored E2E editor', role: 'editor' });
      secrets.push(credential.token);
    }
    const bridge = createProjectProcessingBridge({ projects: service, env: {
      WORLD_WORKER_INTERNAL_URL: workerUrl,
      WORLD_PROJECT_WORKER_TOKENS_JSON: JSON.stringify({ [tenantId]: workerToken }),
    } });
    const app = express();
    app.use('/api/world/v1/processing', bridge.handle);
    app.use('/api/world/v1', service.handle);
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    return { origin, url: `${origin}/api/world/v1`, credential,
      async close() {
        await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
        await service.close(); await pool.end();
      },
    };
  } catch (error) {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await service.close(); await pool.end();
    throw error;
  }
}

async function waitForCompletedJob(client, jobId) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const job = await client.processingRequest(`/jobs/${jobId}`);
    if (job.status === 'complete') return job;
    assert.ok(!['failed', 'cancelled'].includes(job.status), `Inspect ended as ${job.status}: ${redact(job.error || '')}`);
    await delay(100);
  }
  throw new Error('CPU inspect did not complete within ten seconds.');
}

async function run() {
  const temporary = await mkdtemp(join(tmpdir(), 'brainsnn-processing-e2e-'));
  await chmod(temporary, 0o700);
  const tenantId = `tenant_e2e_${randomBytes(8).toString('hex')}`;
  const workerToken = randomBytes(32).toString('base64url');
  const operatorToken = randomBytes(48).toString('base64url');
  secrets.push(workerToken, operatorToken);
  const registry = join(temporary, 'worker-tenants.json');
  const workerDirectory = join(temporary, 'worker');
  const databaseDirectory = join(temporary, 'projects-pg');
  await writeFile(registry, JSON.stringify({ schema: 'brainsnn.world.tenants.v1', tenants: [{
    id: tenantId, token_sha256: digest(workerToken), enabled: true, engines: ['inspect'],
    limits: { upload_count: 12, upload_bytes: 536870912, job_count: 12, active_jobs: 1, storage_bytes: 7 * 1024 ** 3 },
  }] }), { mode: 0o600 });
  const port = await freePort();
  let worker, site, client;
  try {
    worker = await startWorker({ directory: workerDirectory, registry, operatorToken, port });
    site = await startSite({ directory: databaseDirectory, tenantId, workerToken, workerUrl: worker.url, bootstrap: true });
    const projectKey = site.credential.token;
    const actorId = site.credential.key.actor_id;
    client = createProjectsClient({ apiKey: projectKey, baseUrl: site.url, timeoutMs: 10000 });
    const me = await client.me();
    assert.equal(me.tenant.id, tenantId); assert.equal(me.actor.id, actorId);
    const caps = await client.processingRequest('/capabilities');
    assert.equal(caps.owner_id, tenantId); assert.equal(caps.access_mode, 'tenant');
    assert.equal(caps.idempotency.supported, true);
    assert.ok(caps.engines.some(engine => engine.id === 'inspect' && engine.available === true));

    const png = authoredPng();
    const uploadKey = createIdempotencyKey();
    const uploadBody = { name: 'authored-e2e.png', kind: 'image', size: png.length };
    const upload = await client.processingRequest('/uploads', { method: 'POST', body: uploadBody, idempotencyKey: uploadKey });
    assert.equal((await client.processingRequest('/uploads', { method: 'POST', body: uploadBody, idempotencyKey: uploadKey })).id, upload.id);
    const split = Math.floor(png.length / 2);
    const partial = await client.processingRequest(`/uploads/${upload.id}?offset=0`, { method: 'PUT', raw: true, body: png.subarray(0, split) });
    assert.equal(partial.offset, split);
    assert.equal((await client.processingRequest(`/uploads/${upload.id}`)).offset, split);
    const full = await client.processingRequest(`/uploads/${upload.id}?offset=${split}`, { method: 'PUT', raw: true, body: png.subarray(split) });
    assert.equal(full.offset, png.length);
    const uploadReplay = await client.processingRequest('/uploads', { method: 'POST', body: uploadBody, idempotencyKey: uploadKey });
    assert.equal(uploadReplay.id, upload.id); assert.equal(uploadReplay.offset, png.length);

    const jobKey = createIdempotencyKey(), startKey = createIdempotencyKey();
    const jobBody = { engine: 'inspect', upload_ids: [upload.id], consent: true };
    const prepared = await client.processingRequest('/jobs', { method: 'POST', body: jobBody, idempotencyKey: jobKey });
    assert.equal(prepared.status, 'prepared');
    assert.equal((await client.processingRequest('/jobs', { method: 'POST', body: jobBody, idempotencyKey: jobKey })).id, prepared.id);
    const started = await client.processingRequest(`/jobs/${prepared.id}/start`, { method: 'POST', body: {}, idempotencyKey: startKey });
    assert.equal(started.id, prepared.id);
    assert.equal((await client.processingRequest(`/jobs/${prepared.id}/start`, { method: 'POST', body: {}, idempotencyKey: startKey })).id, prepared.id);
    const completed = await waitForCompletedJob(client, prepared.id);
    assert.equal((await client.processingRequest('/jobs')).jobs.length, 1);
    const artifactIndex = completed.artifacts.findIndex(item => item.name === 'capture-integrity.json');
    assert.ok(artifactIndex >= 0);
    const artifact = completed.artifacts[artifactIndex];
    const ticket = await client.processingRequest(`/jobs/${prepared.id}/ticket`, { method: 'POST', body: { artifact: artifactIndex } });
    assert.equal(ticket.authorization_required, true);
    const anonymous = await fetch(new URL(ticket.url, site.origin), { signal: AbortSignal.timeout(2000) });
    assert.equal(anonymous.status, 401); await anonymous.arrayBuffer();
    const bytes = await client.processingDownload(ticket.url, { sha256: artifact.sha256, expectedBytes: artifact.size });
    const integrity = JSON.parse(new TextDecoder().decode(bytes));
    assert.equal(integrity.schema, 'brainsnn.capture.v1');
    assert.equal(integrity.model_executed, false);
    assert.equal(integrity.sources[0].sha256, digest(png));

    let { project } = await client.createProject({ title: 'Authored joined API E2E', description: 'Synthetic PNG; CPU integrity inspection only. No geometry model or physical trial.' });
    const retained = await client.addSource(project.id, { expected_version: project.version,
      name: artifact.name, media_type: 'application/json', data_base64: Buffer.from(bytes).toString('base64'), sha256: artifact.sha256,
    });
    project = retained.project;
    const sourceId = retained.resource.id;
    const originalRead = await client.getSource(project.id, sourceId);
    assert.equal(originalRead.source.sha256, artifact.sha256);
    assert.deepEqual(Buffer.from(originalRead.data_base64, 'base64'), Buffer.from(bytes));

    client.clearApiKey();
    await site.close(); site = null;
    await stopWorker(worker); worker = null;
    worker = await startWorker({ directory: workerDirectory, registry, operatorToken, port });
    site = await startSite({ directory: databaseDirectory, tenantId, workerToken, workerUrl: worker.url });
    client = createProjectsClient({ apiKey: projectKey, baseUrl: site.url, timeoutMs: 10000 });
    const restoredIdentity = await client.me();
    assert.equal(restoredIdentity.actor.id, actorId); assert.equal(restoredIdentity.tenant.id, tenantId);
    const restoredProject = await client.getProject(project.id);
    assert.equal(restoredProject.project.version, project.version);
    const restoredSource = await client.getSource(project.id, sourceId);
    const restoredBytes = Buffer.from(restoredSource.data_base64, 'base64');
    assert.deepEqual(restoredBytes, Buffer.from(bytes)); assert.equal(digest(restoredBytes), artifact.sha256);
    const restoredJob = await client.processingRequest(`/jobs/${prepared.id}`);
    assert.equal(restoredJob.status, 'complete'); assert.equal(restoredJob.artifacts[artifactIndex].sha256, artifact.sha256);
    const replayedJob = await client.processingRequest('/jobs', { method: 'POST', body: jobBody, idempotencyKey: jobKey });
    assert.equal(replayedJob.id, prepared.id); assert.equal(replayedJob.status, 'complete');
    assert.equal((await client.processingRequest('/uploads', { method: 'POST', body: uploadBody, idempotencyKey: uploadKey })).id, upload.id);
    assert.equal((await client.processingRequest(`/jobs/${prepared.id}/start`, { method: 'POST', body: {}, idempotencyKey: startKey })).status, 'complete');
    assert.equal((await client.processingRequest('/jobs')).jobs.length, 1);
    await assert.rejects(client.processingDownload(ticket.url, { sha256: artifact.sha256, expectedBytes: artifact.size }), error => error.status === 403);
    const renewedTicket = await client.processingRequest(`/jobs/${prepared.id}/ticket`, { method: 'POST', body: { artifact: artifactIndex } });
    assert.deepEqual(await client.processingDownload(renewedTicket.url, { sha256: artifact.sha256, expectedBytes: artifact.size }), bytes);
    assert.ok(!worker.failed, worker.failed?.message);
    console.log(JSON.stringify({
      schema: 'brainsnn.project-processing-e2e.v1', result: 'passed', engine: 'inspect',
      input: 'authored 12x12 PNG', model_executed: false, physical_trial: false,
      checks: ['named-key-to-owner-scoped-worker', 'two-exact-upload-chunks', 'stable-upload-job-start-retries',
        'authenticated-hash-checked-download', 'exact-durable-source-roundtrip', 'site-and-worker-restart',
        'restored-key-project-job-and-source', 'same-job-after-restart-retry', 'old-ticket-rejected-new-ticket-verified'],
      jobs_after_restart: 1, source_bytes: bytes.byteLength,
    }, null, 2));
  } finally {
    client?.clearApiKey();
    try { if (site) await site.close(); }
    finally { try { await stopWorker(worker); } finally { await rm(temporary, { recursive: true, force: true }); } }
  }
}

await run().catch(error => {
  console.error(redact(error.stack || error.message || error));
  process.exitCode = 1;
});
