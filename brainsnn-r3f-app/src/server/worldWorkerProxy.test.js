import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { it } from '../test/tinyVitest.js';
import { createWorldWorkerProxy, derivedCredential, route } from './worldWorkerProxy.js';

const nativeFetch = globalThis.fetch;  // other suites stub fetch; these talk to real local servers
const OWNER = 'o'.repeat(43), VISITOR = 'v'.repeat(43), PASSCODE = 'garage-walk-2026';
const id = (n) => String(n).padStart(32, 'a');

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

/** A worker stand-in that records what reached it and answers like the real API. */
async function fakeWorker() {
  const seen = [], jobs = new Map(); let next = 0;
  const worker = await serve((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, length: req.headers['content-length'], body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/v1/download/')) { res.setHeader('Content-Type', 'application/octet-stream'); return res.end('PLY BYTES'); }
      if (req.method === 'POST' && req.url === '/v1/uploads') { res.statusCode = 201; return res.end(JSON.stringify({ id: id(++next), offset: 0, size: 5 })); }
      if (req.method === 'POST' && req.url === '/v1/jobs') { const job = id(++next); jobs.set(job, 'prepared'); res.statusCode = 201; return res.end(JSON.stringify({ id: job, status: 'prepared' })); }
      const job = req.url.match(/^\/v1\/jobs\/([a-f0-9]{32})(\/start)?$/);
      if (job && jobs.has(job[1])) {
        if (req.method === 'POST' && job[2]) jobs.set(job[1], 'queued');
        if (req.method === 'DELETE' && !job[2]) jobs.set(job[1], 'cancelled');
        return res.end(JSON.stringify({ id: job[1], status: jobs.get(job[1]) }));
      }
      if (req.method === 'POST' && req.url.endsWith('/ticket')) return res.end(JSON.stringify({ url: `/v1/download/eyJhIjoxfQ.${'e'.repeat(64)}`, expires_in: 60 }));
      res.end(JSON.stringify({ ok: true, url: req.url }));
    });
  });
  return { ...worker, seen, jobs };
}

async function site(env, options) {
  const proxy = createWorldWorkerProxy(env, options);
  const app = express(); app.set('trust proxy', 1); app.use('/api/world', proxy.handle);
  const server = await serve(app);
  const call = async (path, { method = 'GET', token, body, headers = {}, raw } = {}) => {
    const response = await nativeFetch(server.url + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const text = await response.text();
    let data = text; try { data = JSON.parse(text); } catch { /* bytes */ }
    return { status: response.status, data };
  };
  return { ...server, call, proxy };
}

const env = (worker, extra = {}) => ({ WORLD_WORKER_INTERNAL_URL: worker.url + '/', WORLD_WORKER_SITE_OWNER_TOKEN: OWNER,
  WORLD_SITE_PASSCODE: PASSCODE, ...extra });

it('world processing stays off until the worker, its owner credential and a passcode are all set', async () => {
  assert.deepEqual(createWorldWorkerProxy({}).status(), { available: false, passcode: false, visitors: false, visitorJobsPerDay: null });
  assert.equal(createWorldWorkerProxy({ WORLD_WORKER_INTERNAL_URL: 'http://w:1/', WORLD_WORKER_SITE_OWNER_TOKEN: OWNER, WORLD_SITE_PASSCODE: 'short' }).status().available, false);
  assert.equal(createWorldWorkerProxy({ WORLD_WORKER_INTERNAL_URL: 'http://user:pw@w:1/', WORLD_WORKER_SITE_OWNER_TOKEN: OWNER, WORLD_SITE_PASSCODE: PASSCODE }).status().available, false);
  const visitorsWithoutTheirOwnTenant = createWorldWorkerProxy({ WORLD_WORKER_INTERNAL_URL: 'http://w:1/', WORLD_SITE_VISITORS: '1', WORLD_WORKER_SITE_VISITOR_TOKEN: OWNER, WORLD_WORKER_SITE_OWNER_TOKEN: OWNER });
  assert.equal(visitorsWithoutTheirOwnTenant.status().visitors, false, 'visitors never share the owner tenant');
});

it('world processing: a passcode opens an owner session, and the worker only ever sees the owner tenant credential', async () => {
  const worker = await fakeWorker(), web = await site(env(worker));
  try {
    assert.deepEqual((await web.call('/api/world/processing')).data, { available: true, passcode: true, visitors: false, visitorJobsPerDay: null });
    assert.equal((await web.call('/api/world/session', { method: 'POST', body: {} })).status, 403);
    assert.equal((await web.call('/api/world/session', { method: 'POST', body: { passcode: 'wrong-passcode!' } })).status, 403);
    const opened = await web.call('/api/world/session', { method: 'POST', body: { passcode: PASSCODE } });
    assert.equal(opened.status, 201); assert.equal(opened.data.kind, 'owner'); assert.match(opened.data.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal((await web.call('/api/world/worker/v1/capabilities')).status, 401);
    assert.equal((await web.call('/api/world/worker/v1/capabilities', { token: 'x'.repeat(43) })).status, 401);
    const caps = await web.call('/api/world/worker/v1/capabilities', { token: opened.data.token });
    assert.equal(caps.status, 200);
    assert.deepEqual(worker.seen.map((r) => r.auth), [`Bearer ${OWNER}`]);
    assert.ok(!JSON.stringify(worker.seen).includes(PASSCODE) && !JSON.stringify(worker.seen).includes(opened.data.token));
  } finally { await web.close(); await worker.close(); }
});

it('world processing: ten wrong passcodes lock the address out, even with the right one', async () => {
  const worker = await fakeWorker(), web = await site(env(worker));
  try {
    for (let i = 0; i < 10; i++) assert.equal((await web.call('/api/world/session', { method: 'POST', body: { passcode: `wrong-${i}-passcode` } })).status, 403);
    assert.equal((await web.call('/api/world/session', { method: 'POST', body: { passcode: PASSCODE } })).status, 429);
  } finally { await web.close(); await worker.close(); }
});

it('world processing: a session reaches only the uploads and jobs it created', async () => {
  const worker = await fakeWorker(), web = await site(env(worker));
  try {
    const open = async () => (await web.call('/api/world/session', { method: 'POST', body: { passcode: PASSCODE } })).data.token;
    const mine = await open(), theirs = await open();
    const upload = await web.call('/api/world/worker/v1/uploads', { method: 'POST', token: mine, body: { name: 'walk.mov', size: 5, kind: 'video' } });
    assert.equal(upload.status, 201);
    const chunk = await web.call(`/api/world/worker/v1/uploads/${upload.data.id}?offset=0`, { method: 'PUT', token: mine, body: Buffer.from('HELLO'), raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal(chunk.status, 200);
    const put = worker.seen.at(-1);
    assert.equal(put.method, 'PUT'); assert.equal(put.body.toString(), 'HELLO'); assert.equal(put.length, '5');
    const before = worker.seen.length;
    assert.equal((await web.call(`/api/world/worker/v1/uploads/${upload.data.id}`, { token: theirs })).status, 404);
    assert.equal((await web.call('/api/world/worker/v1/jobs', { method: 'POST', token: theirs, body: { engine: 'colmap-sparse', upload_ids: [upload.data.id], consent: true } })).status, 404);
    assert.equal(worker.seen.length, before, 'refused calls never reach the worker');
    const job = await web.call('/api/world/worker/v1/jobs', { method: 'POST', token: mine, body: { engine: 'colmap-sparse', upload_ids: [upload.data.id], consent: true } });
    assert.equal(job.status, 201);
    assert.equal((await web.call(`/api/world/worker/v1/jobs/${job.data.id}/start`, { method: 'POST', token: mine, body: {} })).status, 200);
    const ticket = await web.call(`/api/world/worker/v1/jobs/${job.data.id}/ticket`, { method: 'POST', token: mine, body: { artifact: 0 } });
    assert.equal(ticket.data.url, `/api/world/worker/v1/download/eyJhIjoxfQ.${'e'.repeat(64)}`, 'the link is under this site, where the browser checks it');
    assert.equal((await web.call(`/api/world/worker/v1/jobs/${job.data.id}`, { token: theirs })).status, 404);
    assert.equal((await web.call('/api/world/worker/v1/jobs', { method: 'POST', token: mine, body: { engine: 'scene-usd', upload_ids: [upload.data.id], source_job: id(999), consent: true } })).status, 404);
    assert.equal((await web.call('/api/world/worker/v1/jobs', { token: mine })).status, 404, 'no job listing: it would show other sessions');
  } finally { await web.close(); await worker.close(); }
});

it('world processing: download tickets pass without a session or credential', async () => {
  const worker = await fakeWorker(), web = await site(env(worker));
  try {
    const ticket = `eyJvd25lciI6ImEifQ.${'f'.repeat(64)}`;
    const download = await web.call(`/api/world/worker/v1/download/${ticket}`);
    assert.equal(download.status, 200); assert.equal(download.data, 'PLY BYTES');
    assert.equal(worker.seen.at(-1).auth, undefined);
    assert.equal((await web.call('/api/world/worker/v1/download/not-a-ticket')).status, 404);
  } finally { await web.close(); await worker.close(); }
});

it('world processing: visitors are off by default, then capped per connection per day on their own tenant', async () => {
  const off = await fakeWorker(), closed = await site(env(off));
  try { assert.equal((await closed.call('/api/world/session', { method: 'POST', body: {} })).status, 403); }
  finally { await closed.close(); await off.close(); }
  const worker = await fakeWorker(), web = await site(env(worker, { WORLD_SITE_VISITORS: '1', WORLD_WORKER_SITE_VISITOR_TOKEN: VISITOR, WORLD_SITE_VISITOR_JOBS_PER_DAY: '2' }));
  try {
    const opened = await web.call('/api/world/session', { method: 'POST', body: {} });
    assert.equal(opened.data.kind, 'visitor');
    const token = opened.data.token;
    const upload = (await web.call('/api/world/worker/v1/uploads', { method: 'POST', token, body: { name: 'walk.mov', size: 5, kind: 'video' } })).data.id;
    const job = (engine) => web.call('/api/world/worker/v1/jobs', { method: 'POST', token, body: { engine, upload_ids: [upload], consent: true } });
    assert.equal((await job('lingbot-map-stream')).status, 403);
    assert.equal((await job('colmap-sparse')).status, 201);
    assert.equal((await job('colmap-sparse')).status, 201);
    const third = await job('colmap-sparse');
    assert.equal(third.status, 429); assert.match(third.data.detail, /2 jobs a day/);
    assert.ok(worker.seen.filter((r) => r.auth).every((r) => r.auth === `Bearer ${VISITOR}`));
  } finally { await web.close(); await worker.close(); }
});

it('world processing: a visitor cannot hoard upload reservations', async () => {
  const worker = await fakeWorker(), web = await site(env(worker, { WORLD_SITE_VISITORS: '1', WORLD_WORKER_SITE_VISITOR_TOKEN: VISITOR, WORLD_SITE_VISITOR_JOBS_PER_DAY: '1' }));
  try {
    const token = (await web.call('/api/world/session', { method: 'POST', body: {} })).data.token;
    const upload = () => web.call('/api/world/worker/v1/uploads', { method: 'POST', token, body: { name: 'walk.mov', size: 5, kind: 'video' } });
    const first = await upload(), second = await upload(), third = await upload();
    assert.deepEqual([first.status, second.status, third.status], [201, 201, 429], 'two unused reservations at a time');
    assert.equal((await web.call('/api/world/worker/v1/jobs', { method: 'POST', token, body: { engine: 'colmap-sparse', upload_ids: [first.data.id], consent: true } })).status, 201);
    assert.equal((await upload()).status, 201, 'an upload given to a job frees its place');
    assert.equal((await upload()).status, 429, 'and the connection has used its day: three uploads per job allowed');
    const before = worker.seen.filter((r) => r.url === '/v1/uploads').length;
    assert.equal(before, 3, 'refused reservations never reach the worker');
    const owner = (await web.call('/api/world/session', { method: 'POST', body: { passcode: PASSCODE } })).data.token;
    assert.equal((await web.call('/api/world/worker/v1/uploads', { method: 'POST', token: owner, body: { name: 'walk.mov', size: 5, kind: 'video' } })).status, 201);
  } finally { await web.close(); await worker.close(); }
});

it('world processing: a job nobody starts is cancelled, so it cannot hold the one active slot', async () => {
  const worker = await fakeWorker(), web = await site(env(worker), { preparedLeaseMs: 50 });
  try {
    const token = (await web.call('/api/world/session', { method: 'POST', body: { passcode: PASSCODE } })).data.token;
    const upload = (await web.call('/api/world/worker/v1/uploads', { method: 'POST', token, body: { name: 'walk.mov', size: 5, kind: 'video' } })).data.id;
    const job = () => web.call('/api/world/worker/v1/jobs', { method: 'POST', token, body: { engine: 'colmap-sparse', upload_ids: [upload], consent: true } });
    const abandoned = (await job()).data.id, started = (await job()).data.id;
    assert.equal((await web.call(`/api/world/worker/v1/jobs/${started}/start`, { method: 'POST', token, body: {} })).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(worker.jobs.get(abandoned), 'cancelled');
    assert.equal(worker.jobs.get(started), 'queued', 'a started job is never touched');
    assert.equal(web.proxy.leases.size, 0);
  } finally { await web.close(); await worker.close(); }
});

it('world processing: the passcode alone gives both sides the same tenant credentials', async () => {
  // Pinned against robotics/world_worker/deploy/railway/tenants.py (tests/world/test_site_worker_deploy.py pins the same).
  assert.equal(derivedCredential('garage-walk-2026', 'site-owner'), 'YKSyflk5DI5jVbtSo_hHapM4BbBylsGbT7ZZXYarmjM');
  assert.equal(derivedCredential('garage-walk-2026', 'site-visitors'), '81ToJqJYH2C-yj2NZH2SCRF2-sGYrKniyrVDLFwbzhU');
  const worker = await fakeWorker(), web = await site({ WORLD_WORKER_INTERNAL_URL: worker.url + '/', WORLD_SITE_PASSCODE: PASSCODE, WORLD_SITE_VISITORS: '1' });
  try {
    assert.deepEqual((await web.call('/api/world/processing')).data, { available: true, passcode: true, visitors: true, visitorJobsPerDay: 2 });
    const owner = (await web.call('/api/world/session', { method: 'POST', body: { passcode: PASSCODE } })).data.token;
    const visitor = (await web.call('/api/world/session', { method: 'POST', body: {} })).data.token;
    await web.call('/api/world/worker/v1/capabilities', { token: owner });
    await web.call('/api/world/worker/v1/capabilities', { token: visitor });
    assert.deepEqual(worker.seen.map((r) => r.auth), [`Bearer ${derivedCredential(PASSCODE, 'site-owner')}`, `Bearer ${derivedCredential(PASSCODE, 'site-visitors')}`]);
  } finally { await web.close(); await worker.close(); }
  assert.equal(createWorldWorkerProxy({ WORLD_WORKER_INTERNAL_URL: 'http://w:1/', WORLD_SITE_PASSCODE: 'too-short' }).status().available, false);
});

it('world processing: only the site flow is routable', () => {
  assert.deepEqual(route('GET', '/v1/capabilities', ''), { name: 'capabilities' });
  assert.deepEqual(route('PUT', `/v1/uploads/${id(1)}`, 'offset=4194304'), { name: 'upload', upload: id(1) });
  assert.equal(route('PUT', `/v1/uploads/${id(1)}`, ''), null);
  assert.equal(route('GET', `/v1/uploads/${id(1)}`, 'offset=0'), null);
  assert.deepEqual(route('DELETE', `/v1/jobs/${id(2)}/artifacts`, ''), { name: 'job', job: id(2) });
  assert.deepEqual(route('POST', `/v1/jobs/${id(2)}/ticket`, ''), { name: 'ticket', job: id(2) });
  assert.equal(route('GET', '/v1/jobs', ''), null);
  assert.equal(route('GET', '/healthz', ''), null);
  assert.equal(route('GET', '/v1/jobs/../../etc', ''), null);
  assert.equal(route('POST', `/v1/jobs/${id(2)}/delete`, ''), null);
});
