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

async function fixture(t, { capabilities = caps, env = {}, respond = () => json({ id }), authenticate } = {}) {
  const upstreamCalls = [], authCalls = [];
  const service = createProjectProcessingBridge({
    env: { WORLD_WORKER_INTERNAL_URL: 'http://worker.internal/', WORLD_PROJECT_WORKER_TOKENS_JSON: JSON.stringify({ [tenant]: token }), ...env },
    projects: { authenticate: authenticate || (async (req, options) => {
      authCalls.push(options);
      if (req.headers.authorization !== 'Bearer fixture-site-key') throw Object.assign(new Error('Unauthorized.'), { status: 401, code: 'unauthorized' });
      return { tenant_id: tenant, actor_id: 'actor_fixture' };
    }) },
    fetchImpl: async (url, options) => {
      upstreamCalls.push({ url: String(url), options });
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
  return { call, upstreamCalls, authCalls };
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
