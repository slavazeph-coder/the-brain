import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProjectsClient, createIdempotencyKey, ProjectsApiError, MAX_PROJECT_SOURCE_BYTES } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';

const token = 'bsk_test_only_never_a_production_key_123456789';
const ok = data => Response.json(data);

test('API credentials stay in the Authorization header, status is public, and disconnect removes access', async () => {
  const calls = [];
  const client = createProjectsClient({ apiKey: token, fetchImpl: async (url, options) => { calls.push({ url, options }); return ok({ available: true }); } });
  await client.status();
  await client.me();
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`);
  for (const { url, options } of calls) {
    assert.ok(!url.includes(token));
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.match(options.headers['X-Request-Id'], /^[A-Za-z0-9:_-]{16,128}$/);
  }
  assert.ok(!JSON.stringify(client).includes(token));
  client.clearApiKey();
  await assert.rejects(client.me(), { code: 'missing_api_key' });
  assert.equal(calls.length, 2);
});

test('prepared mutation retries explicitly with identical bytes and key after an ambiguous network failure', async () => {
  const calls = [];
  const client = createProjectsClient({ apiKey: token, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw new Error(`A transport leaked ${token}`);
    return ok({ project: { id: 'p1', version: 1 } });
  } });
  const body = { title: 'Site A', description: 'Original intent' };
  const operation = client.prepareMutation('createProject', [body]);
  await assert.rejects(operation.run(), error => {
    assert.ok(error instanceof ProjectsApiError);
    assert.equal(error.code, 'network_error');
    assert.equal(error.idempotencyKey, operation.idempotencyKey);
    assert.ok(!String(error).includes(token));
    return true;
  });
  assert.equal(calls.length, 1, 'a failed POST was not retried automatically');
  body.title = 'A different user intention';
  const result = await operation.run();
  assert.equal(result.project.id, 'p1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body, calls[1].options.body);
  assert.equal(JSON.parse(calls[1].options.body).title, 'Site A');
  assert.equal(calls[0].options.headers['Idempotency-Key'], calls[1].options.headers['Idempotency-Key']);
  assert.notEqual(calls[0].options.headers['X-Request-Id'], calls[1].options.headers['X-Request-Id']);
});

test('server conflicts retain request diagnostics and never modify or retry a stale version', async () => {
  let calls = 0;
  const client = createProjectsClient({ apiKey: token, fetchImpl: async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).expected_version, 4);
    return Response.json({ error: { code: 'version_conflict', message: 'Refresh the project.', request_id: 'server_request_123', details: { expected: 4, actual: 5 } } }, { status: 409, headers: { 'x-request-id': 'server_request_123' } });
  } });
  const key = createIdempotencyKey();
  await assert.rejects(client.createRevision('project_1', { expected_version: 4, label: 'As built' }, { idempotencyKey: key }), error => {
    assert.equal(error.status, 409);
    assert.equal(error.code, 'version_conflict');
    assert.equal(error.requestId, 'server_request_123');
    assert.equal(error.idempotencyKey, key);
    assert.deepEqual(error.details, { expected: 4, actual: 5 });
    return true;
  });
  assert.equal(calls, 1);
});

test('source limits count UTF-8 or decoded bytes, not string length', async () => {
  let calls = 0;
  const client = createProjectsClient({ apiKey: token, fetchImpl: async () => { calls++; return ok({}); } });
  const body = { expected_version: 1, name: 'source.txt', media_type: 'text/plain', content_text: '🧠'.repeat(MAX_PROJECT_SOURCE_BYTES / 4) };
  await client.addSource('p1', body);
  await assert.rejects(client.addSource('p1', { ...body, content_text: body.content_text + 'a' }), { code: 'source_too_large' });
  await assert.rejects(client.addSource('p1', { ...body, data_base64: 'YQ==' }), { code: 'invalid_source' });
  await assert.rejects(client.addSource('p1', { name: 'bad', data_base64: 'not base64!' }), { code: 'invalid_source' });
  await client.addSource('p1', { name: 'binary', data_base64: Buffer.alloc(MAX_PROJECT_SOURCE_BYTES).toString('base64') });
  assert.equal(calls, 2);
});

test('paths and destinations cannot smuggle credentials or select a different route', () => {
  for (const baseUrl of ['http://remote.example/api', '//remote.example/api', 'https://user:secret@example.com/api', 'https://example.com/api?key=secret', 'https://example.com/api#token', 'javascript:alert(1)']) {
    assert.throws(() => createProjectsClient({ apiKey: token, baseUrl }), { code: 'invalid_base_url' });
  }
  const client = createProjectsClient({ apiKey: token, fetchImpl: () => assert.fail('must not fetch') });
  for (const id of ['../keys', 'project?other=1', 'x/y', 'https://evil.example']) assert.throws(() => client.getProject(id), { code: 'invalid_identifier' });
  assert.throws(() => client.prepareMutation('createProject', [{}], { idempotencyKey: 'short' }), { code: 'invalid_idempotency_key' });
});

test('a timeout or caller cancellation sends at most one request and retains its mutation key', async () => {
  let calls = 0, fetchSignal;
  const client = createProjectsClient({ apiKey: token, timeoutMs: 20, fetchImpl: async (_url, options) => {
    calls++;
    fetchSignal = options.signal;
    return new Promise(() => {});
  } });
  const operation = client.prepareMutation('createProject', [{ title: 'Timeout' }]);
  await assert.rejects(operation.run(), error => error.code === 'timeout' && error.idempotencyKey === operation.idempotencyKey);
  assert.equal(calls, 1);
  assert.equal(fetchSignal.aborted, true);
  const abort = new AbortController();
  const pending = operation.run({ signal: abort.signal });
  abort.abort();
  await assert.rejects(pending, { code: 'aborted' });
  assert.equal(calls, 2);
  await assert.rejects(operation.run({ signal: abort.signal }), { code: 'aborted' });
  assert.equal(calls, 2, 'pre-cancelled requests do not reach the network');
});

test('oversized and malformed responses are bounded errors, never a successful project', async () => {
  const oversized = createProjectsClient({ apiKey: token, maxResponseBytes: 20, fetchImpl: async () => ok({ value: 'x'.repeat(40) }) });
  await assert.rejects(oversized.me(), { code: 'response_too_large' });
  const malformed = createProjectsClient({ apiKey: token, fetchImpl: async () => new Response('<html>Sign in</html>') });
  await assert.rejects(malformed.me(), { code: 'invalid_response' });
});

test('server error diagnostics redact the key even after the caller disconnects', async () => {
  let respond;
  const client = createProjectsClient({ apiKey: token, fetchImpl: async () => new Promise(resolve => { respond = resolve; }) });
  const pending = client.me();
  client.clearApiKey();
  respond(Response.json({ error: { code: 'denied', message: `Rejected ${token}`, details: { leaked: token } } }, { status: 403 }));
  await assert.rejects(pending, error => {
    assert.ok(!String(error).includes(token));
    assert.ok(!JSON.stringify(error).includes(token));
    assert.deepEqual(error.details, { leaked: '[redacted]' });
    return true;
  });
});

test('processing uses the same tenant key and preserves native JSON and exact chunk bytes', async () => {
  const calls = [];
  const client = createProjectsClient({ apiKey: token, fetchImpl: async (url, options) => { calls.push({ url, options }); return ok({ api_version: 'brainsnn.worker.v1', offset: 3 }); } });
  const capabilities = await client.processingRequest('/capabilities');
  assert.equal(capabilities.api_version, 'brainsnn.worker.v1');
  const chunk = new Uint8Array([0, 255, 13]);
  await client.processingRequest('/uploads/upload_12345678?offset=0', { method: 'PUT', raw: true, body: chunk });
  assert.equal(calls[1].url, '/api/world/v1/processing/uploads/upload_12345678?offset=0');
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].options.headers['Content-Type'], 'application/octet-stream');
  assert.equal(calls[1].options.body, chunk);
  const key = createIdempotencyKey();
  await client.processingRequest('/jobs', { method: 'POST', body: { engine: 'inspect', upload_ids: ['upload_12345678'], consent: true }, idempotencyKey: key });
  assert.equal(calls[2].options.headers['Idempotency-Key'], key);
  for (const path of ['https://evil.example/capabilities', '/../keys', '/jobs?token=x', '/download/secret', '/uploads/id?offset=1&owner=other']) {
    await assert.rejects(client.processingRequest(path), { code: 'invalid_processing_path' });
  }
  assert.equal(calls.length, 3);
});

test('processing artifacts stay on the API origin and require matching size and SHA-256', async () => {
  const bytes = new TextEncoder().encode('exact worker artifact');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let calls = 0;
  const client = createProjectsClient({ apiKey: token, baseUrl: 'https://api.example/api/world/v1', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.example/api/world/v1/processing/download/signed.ticket');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    return new Response(bytes);
  } });
  assert.deepEqual(await client.processingDownload('/api/world/v1/processing/download/signed.ticket', { sha256, expectedBytes: bytes.byteLength }), bytes);
  await assert.rejects(client.processingDownload('signed.ticket', { sha256: '0'.repeat(64) }), { code: 'artifact_hash_mismatch' });
  await assert.rejects(client.processingDownload('signed.ticket', { sha256, expectedBytes: bytes.byteLength + 1 }), { code: 'artifact_size_mismatch' });
  await assert.rejects(client.processingDownload('signed.ticket', { sha256, maxBytes: bytes.byteLength - 1 }), { code: 'response_too_large' });
  const before = calls;
  for (const url of ['https://evil.example/api/world/v1/processing/download/signed.ticket', '/api/world/v1/processing/download/../../keys', '/api/world/v1/processing/download/signed.ticket?key=secret', '//evil.example/api/world/v1/processing/download/signed.ticket']) {
    await assert.rejects(client.processingDownload(url, { sha256 }), { code: 'invalid_download_url' });
  }
  await assert.rejects(client.processingDownload('signed.ticket'), { code: 'invalid_artifact_hash' });
  assert.equal(calls, before);
});
