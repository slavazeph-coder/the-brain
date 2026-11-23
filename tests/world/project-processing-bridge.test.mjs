import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createProjectProcessingBridge } from '../../brainsnn-r3f-app/src/server/projectProcessingBridge.js';

const tenant = 'tenant_fixture';
const token = 'w'.repeat(43);
const id = 'a'.repeat(32);
const caps = { api_version: 'brainsnn.worker.v1', access_mode: 'tenant', owner_id: tenant, idempotency: { supported: true } };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } });

async function fixture(t, { capabilities = caps, env = {}, respond = () => json({ id }), authenticate, timeouts, fetchOverride } = {}) {
  const upstreamCalls = [], authCalls = [], metered = [];
  const service = createProjectProcessingBridge({
    env: { WORLD_WORKER_INTERNAL_URL: 'http://worker.internal/', WORLD_PROJECT_WORKER_TOKENS_JSON: JSON.stringify({ [tenant]: token }), ...env },
    projects: { authenticate: authenticate || (async (req, options) => {
      authCalls.push(options);
      if (req.headers.authorization !== 'Bearer fixture-site-key') throw Object.assign(new Error('Unauthorized.'), { status: 401, code: 'unauthorized' });
      return { tenant_id: tenant, actor_id: 'actor_fixture' };
    }), meterUsage: async (owner, metric, quantity) => { metered.push([owner, metric, quantity]); } },
    timeouts,
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url: String(url), options });
      if (fetchOverride) return fetchOverride(url, options);
      return String(url).endsWith('/v1/capabilities') ? json(typeof capabilities === 'function' ? capabilities(options) : capabilities) : respond(url, options);
    },
  });
  const server = http.createServer(service.handle);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = 'GET', body, headers = {} } = {}) => fetch(base + path, {
    method, headers: { Authorization: 'Bearer fixture-site-key', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { call, base, upstreamCalls, authCalls, metered };
}

test('dedicated bridge requires project identity and refuses tenant mismatches before resource access', async t => {
  const { call, upstreamCalls } = await fixture(t, { capabilities: { ...caps, owner_id: 'site-owner' } });
  let response = await call('/jobs/' + id, { headers: { Authorization: '' } });
  assert.equal(response.status, 401); assert.equal(upstreamCalls.length, 0);
  response = await call('/jobs/' + id);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'worker_tenant_mismatch');
  assert.equal(upstreamCalls.length, 1);
  assert.ok(upstreamCalls[0].url.endsWith('/capabilities'));
});

test('durable upload admission requires key and worker support, forwards only dedicated credential', async t => {
  const { call, upstreamCalls, authCalls } = await fixture(t, { respond: () => json({ id }, 201, { 'Idempotency-Replayed': 'true' }) });
  const body = { name: 'room.png', kind: 'image', size: 500 };
  assert.equal((await call('/uploads', { method: 'POST', body })).status, 422);
  const response = await call('/uploads', { method: 'POST', body, headers: { 'Idempotency-Key': 'fixture-upload-00001', 'X-World-Owner': 'foreign' } });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('Idempotency-Replayed'), 'true');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.ok(response.headers.get('X-Request-Id'));
  const sent = upstreamCalls.at(-1);
  assert.equal(sent.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(sent.options.headers['Idempotency-Key'], 'fixture-upload-00001');
  assert.equal(sent.options.headers['X-World-Owner'], undefined);
  assert.deepEqual(JSON.parse(sent.options.body), body);
  assert.equal(authCalls.filter(v => v.scopes[0] === 'processing:write').length, 3);
  const older = await fixture(t, { capabilities: { ...caps, idempotency: undefined } });
  assert.equal((await older.call('/uploads', { method: 'POST', body, headers: { 'Idempotency-Key': 'fixture-upload-00001' } })).status, 503);
  assert.equal(older.upstreamCalls.length, 1);
});

test('bridge fails closed for absent, duplicate or reserved worker credentials', async t => {
  for (const mapping of ['', '{bad', JSON.stringify({ 'site-owner': token }), JSON.stringify({ [tenant]: token, other: token })]) {
    const { call, upstreamCalls } = await fixture(t, { env: { WORLD_PROJECT_WORKER_TOKENS_JSON: mapping } });
    assert.equal((await call('/capabilities')).status, 503);
    assert.equal(upstreamCalls.length, 0);
  }
});

test('ticket issue is a read operation and downloads stay authenticated and tenant-bound', async t => {
  const payload = Buffer.from(JSON.stringify({ owner: tenant, job: id })).toString('base64url');
  const ticket = payload + '.' + 'b'.repeat(64);
  const { call, authCalls, upstreamCalls } = await fixture(t, { respond: (url) => {
    if (String(url).endsWith('/ticket')) return json({ url: '/v1/download/' + ticket, expires_in: 60 });
    return new Response(Buffer.from('source bytes'), { headers: { 'Content-Length': '12', 'Content-Type': 'application/octet-stream' } });
  } });
  let response = await call('/jobs/' + id + '/ticket', { method: 'POST', body: { artifact: 0 } });
  const issued = await response.json();
  assert.equal(response.status, 200);
  assert.equal(issued.url, '/api/world/v1/processing/download/' + ticket);
  assert.equal(issued.authorization_required, true);
  assert.equal(authCalls.at(-1).scopes[0], 'processing:read');
  response = await call('/download/' + ticket);
  assert.equal(response.status, 200); assert.equal(await response.text(), 'source bytes');
  const foreign = Buffer.from(JSON.stringify({ owner: 'foreign' })).toString('base64url') + '.' + 'c'.repeat(64);
  const before = upstreamCalls.length;
  assert.equal((await call('/download/' + foreign)).status, 404);
  assert.equal(upstreamCalls.length, before + 1, 'only capability request may reach worker');
  assert.equal((await call('/download/' + ticket, { headers: { Authorization: '' } })).status, 401);
});

test('only allowlisted routes pass; worker errors preserve useful status and request ID', async t => {
  const { call, upstreamCalls } = await fixture(t, { respond: () => json({ detail: 'Upload offset mismatch. Read upload status to resume.' }, 409) });
  for (const path of ['/execute', '/uploads', '/jobs?owner_id=foreign', '/capabilities?url=https://elsewhere.test']) {
    assert.equal((await call(path)).status, 404);
  }
  assert.equal(upstreamCalls.length, 0);
  const response = await call('/jobs');
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'worker_request_failed');
  assert.equal(body.error.request_id, response.headers.get('X-Request-Id'));
});

test('artifact streaming rejects absent lengths and terminates incomplete responses', async t => {
  const ticket = Buffer.from(JSON.stringify({ owner: tenant, job: id })).toString('base64url') + '.' + 'b'.repeat(64);
  const missing = await fixture(t, { respond: () => new Response(Buffer.from('partial')) });
  const response = await missing.call('/download/' + ticket);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'worker_response');
  const short = await fixture(t, { respond: () => new Response(Buffer.from('partial'), { headers: { 'Content-Length': '20' } }) });
  await assert.rejects(async () => { const value = await short.call('/download/' + ticket); await value.arrayBuffer(); });
});

test('body is bounded and identity rechecked after upload body admission', async t => {
  let calls = 0;
  const { call, upstreamCalls } = await fixture(t, { authenticate: async () => {
    if (++calls > 1) throw Object.assign(new Error('Revoked.'), { status: 401, code: 'unauthorized' });
    return { tenant_id: tenant };
  } });
  const response = await call('/uploads', { method: 'POST', body: { name: 'x.png' }, headers: { 'Idempotency-Key': 'fixture-upload-00001' } });
  assert.equal(response.status, 401); assert.equal(upstreamCalls.length, 0);
  const oversized = await fixture(t);
  assert.equal((await oversized.call('/jobs', { method: 'POST', body: { huge: 'x'.repeat(20000) }, headers: { 'Idempotency-Key': 'fixture-job-000001' } })).status, 413);
});

test('global admission bounds live processing requests across independent tenants', async t => {
  const owners = Array.from({ length: 5 }, (_, i) => `tenant_fixture_${i}`);
  const tokens = owners.map((_, i) => String.fromCharCode(97 + i).repeat(43));
  let admitted;
  const allAdmitted = new Promise(resolve => { admitted = resolve; });
  const releases = [];
  const { call } = await fixture(t, {
    env: { WORLD_PROJECT_WORKER_TOKENS_JSON: JSON.stringify(Object.fromEntries(owners.map((owner, i) => [owner, tokens[i]]))) },
    authenticate: async req => ({ tenant_id: owners[Number(req.headers.authorization.slice(-1))] }),
    capabilities: options => ({ ...caps, owner_id: owners[tokens.indexOf(options.headers.Authorization.slice(7))] }),
    respond: () => new Promise(resolve => { releases.push(() => resolve(json({ jobs: [] }))); if (releases.length === 16) admitted(); }),
  });
  const pending = Array.from({ length: 16 }, (_, i) => call('/jobs', { headers: { Authorization: `Bearer fixture-${Math.floor(i / 4)}` } }));
  try {
    await allAdmitted;
    assert.equal((await call('/jobs', { headers: { Authorization: 'Bearer fixture-4' } })).status, 429);
  } finally { for (const release of releases) release(); await Promise.all(pending); }
});

// A fetch that only settles when its signal aborts, like a worker that accepted
// the connection during a redeploy and never answered.
const hang = (options) => new Promise((_, reject) => {
  options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
});

test('an unresponsive worker fails the preflight fast with a retryable 504 and frees the slot', async t => {
  const { call } = await fixture(t, { timeouts: { preflightMs: 60 }, fetchOverride: (_url, options) => hang(options) });
  const started = Date.now();
  const response = await call('/jobs/' + id);
  const body = await response.json();
  assert.equal(response.status, 504);
  assert.equal(body.error.code, 'worker_timeout');
  assert.equal(response.headers.get('Retry-After'), '30');
  assert.equal(body.error.request_id, response.headers.get('X-Request-Id'));
  assert.ok(Date.now() - started < 2000, 'preflight deadline must not fall back to the two-minute transfer limit');
  // The tenant's admission slot is released: four more calls are still admitted rather than refused with 429.
  const statuses = await Promise.all(Array.from({ length: 4 }, () => call('/jobs/' + id).then(r => r.status)));
  assert.deepEqual(statuses, [504, 504, 504, 504]);
});

test('control calls get their own deadline after a healthy preflight', async t => {
  const { call } = await fixture(t, { timeouts: { requestMs: 60 }, respond: (_url, options) => hang(options) });
  const response = await call('/jobs/' + id);
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'worker_timeout');
});

test('downloads are bounded by stalls between chunks, not total wall time', async t => {
  const ticket = Buffer.from(JSON.stringify({ owner: tenant, job: id })).toString('base64url') + '.' + 'b'.repeat(64);
  const slowStream = (chunks, gapMs, { stallAfter = Infinity } = {}) => (_url, options) => {
    let sent = 0;
    const body = new ReadableStream({ async pull(controller) {
      if (sent >= chunks) return controller.close();
      await new Promise((resolve, reject) => {
        const wait = setTimeout(resolve, sent >= stallAfter ? 60_000 : gapMs);
        options.signal.addEventListener('abort', () => { clearTimeout(wait); reject(new Error('aborted')); }, { once: true });
      });
      sent++; controller.enqueue(new Uint8Array([65]));
    } });
    return new Response(body, { headers: { 'Content-Length': String(chunks), 'Content-Type': 'application/octet-stream' } });
  };
  // Eight chunks 40 ms apart take ~320 ms in total: longer than the 150 ms transfer limit, yet never stalled for 100 ms.
  const steady = await fixture(t, { timeouts: { transferMs: 150, stallMs: 100 }, respond: slowStream(8, 40) });
  const ok = await steady.call('/download/' + ticket);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'AAAAAAAA');
  // A stream that stops after two chunks is cut off, so the client never mistakes it for a complete artifact.
  const stalled = await fixture(t, { timeouts: { transferMs: 5000, stallMs: 80 }, respond: slowStream(8, 10, { stallAfter: 2 }) });
  const started = Date.now();
  await assert.rejects(async () => { const value = await stalled.call('/download/' + ticket); await value.arrayBuffer(); });
  assert.ok(Date.now() - started < 3000);
});

test('billing meter counts accepted work once: started jobs, uploaded chunks and downloaded artifacts', async t => {
  const ticket = Buffer.from(JSON.stringify({ owner: tenant, job: id })).toString('base64url') + '.' + 'b'.repeat(64);
  let replay = false;
  const { call, base, metered } = await fixture(t, { respond: (url, options) => {
    if (String(url).includes('/download/')) return new Response(Buffer.from('artifact!'), { headers: { 'Content-Length': '9' } });
    if (options.method === 'PUT') return json({ offset: 5 });
    return json({ id, status: 'queued' }, 200, replay ? { 'Idempotency-Replayed': 'true' } : {});
  } });
  assert.equal((await call('/jobs/' + id + '/start', { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'fixture-start-000001' } })).status, 200);
  replay = true;  // the same start retried: the worker replays it, so it is not counted again
  assert.equal((await call('/jobs/' + id + '/start', { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'fixture-start-000001' } })).status, 200);
  const chunk = await fetch(base + '/uploads/' + id + '?offset=0', {
    method: 'PUT', headers: { Authorization: 'Bearer fixture-site-key', 'Content-Type': 'application/octet-stream' }, body: Buffer.from('bytes') });
  assert.equal(chunk.status, 200);
  const download = await call('/download/' + ticket);
  assert.equal(await download.text(), 'artifact!');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(metered, [[tenant, 'processing_jobs_started', 1], [tenant, 'processing_upload_bytes', 5], [tenant, 'processing_artifact_bytes', 9]]);
});

test('a failing meter never fails the customer request', async t => {
  // A meter that throws, as if the project database went away mid-request.
  const broken = createProjectProcessingBridge({
    env: { WORLD_WORKER_INTERNAL_URL: 'http://worker.internal/', WORLD_PROJECT_WORKER_TOKENS_JSON: JSON.stringify({ [tenant]: token }) },
    projects: { authenticate: async () => ({ tenant_id: tenant }), meterUsage: async () => { throw new Error('database away'); } },
    fetchImpl: async url => String(url).endsWith('/v1/capabilities') ? json(caps) : json({ id, status: 'queued' }),
  });
  const server = http.createServer(broken.handle);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/jobs/${id}/start`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'fixture-start-000002' }, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'queued');
});
