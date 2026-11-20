import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorldProjectService } from '../../brainsnn-r3f-app/src/server/worldProjectService.js';
import { canonical } from '../../brainsnn-r3f-app/src/server/worldProjectStore.js';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';
import { createMemoryProjectObjectStore } from './helpers/project-object-store.mjs';

const STAMP = Date.parse('2026-11-19T12:00:00Z');
const MiB = 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function host(service) {
  const server = createServer((req, res) => service.handle(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}/api/world/v1`,
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}

async function fixture(t, options = {}) {
  let clock = STAMP;
  const directory = await mkdtemp(join(tmpdir(), 'brainsnn-media-'));
  const objectStore = options.objectStore || createMemoryProjectObjectStore();
  const f = { objectStore, directory, setTime: value => { clock = value; } };
  async function open() {
    f.pool = await createProjectTestPool({ ...(options.persistent ? { directory: join(directory, 'postgres') } : {}) });
    f.service = createWorldProjectService({ pool: options.decoratePool ? options.decoratePool(f.pool) : f.pool, env: {}, objectStore, now: () => clock });
    await f.service.initialize();
    f.web = await host(f.service);
  }
  await open();
  f.tenant = await f.service.provisionTenant({ name: `Media fixture ${randomUUID()}`, ...(options.limits ? { limits: options.limits } : {}) });
  f.admin = await f.service.provisionKey({ tenant_id: f.tenant.id, actor_name: 'Media administrator', role: 'admin' });
  f.editor = await f.service.provisionKey({ tenant_id: f.tenant.id, actor_name: 'Media recorder', role: 'editor' });
  f.reader = await f.service.provisionKey({ tenant_id: f.tenant.id, actor_name: 'Media reader', role: 'reader' });
  f.raw = (path, { method = 'GET', token = f.admin.token, headers = {}, body } = {}) => fetch(f.web.base + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body,
  });
  f.call = async (path, { method = 'GET', body, key = randomUUID(), token = f.admin.token, headers = {} } = {}) => {
    const response = await f.raw(path, { method, token, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': key }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  f.part = async (project, upload, number, bytes, options = {}) => {
    const response = await f.raw(`/projects/${project.id}/source-uploads/${upload.id}/parts/${number}`, {
      method: 'PUT', token: options.token || f.editor.token,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-Content-SHA256': options.sha256 || sha(bytes) }, body: bytes,
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  };
  f.restart = async () => { await f.web.close(); await f.service.close(); await f.pool.end(); await open(); };
  t.after(async () => { await f.web.close(); await f.service.close(); await f.pool.end(); await rm(directory, { recursive: true, force: true }); });
  return f;
}

async function project(f) {
  const result = await f.call('/projects', { method: 'POST', token: f.editor.token, body: { title: 'Authored large-source fixture', description: 'Software fixture bytes; no physical capture or real-world qualification.' } });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.project;
}
async function start(f, p, bytes, options = {}) {
  const result = await f.call(`/projects/${p.id}/source-uploads`, { method: 'POST', token: f.editor.token,
    body: { expected_version: p.version, name: 'walkthrough-fixture.bin', media_type: 'application/octet-stream', bytes: bytes.length, sha256: options.sha256 || sha(bytes) }, ...(options.key ? { key: options.key } : {}) });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  return result.data.upload;
}
async function uploadAll(f, p, upload, bytes) {
  for (let number = 1; number <= upload.part_count; number++) {
    const result = await f.part(p, upload, number, bytes.subarray((number - 1) * upload.part_bytes, number * upload.part_bytes));
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
}
const complete = (f, p, upload, options = {}) => f.call(`/projects/${p.id}/source-uploads/${upload.id}/complete`, {
  method: 'POST', token: f.editor.token, body: { expected_version: p.version }, ...options,
});
const uploadState = (f, p, upload) => f.call(`/projects/${p.id}/source-uploads/${upload.id}`);
const abort = (f, p, upload) => f.call(`/projects/${p.id}/source-uploads/${upload.id}/abort`, { method: 'POST', body: {} });
async function smallSource(f, p) {
  const result = await f.call(`/projects/${p.id}/sources`, { method: 'POST', body: { expected_version: p.version, name: 'note.txt', media_type: 'text/plain', content_text: 'An inline project note.' } });
  assert.equal(result.status, 201, JSON.stringify(result.data)); return result.data;
}

test('large originals retain a real 5 MiB fixture, stream exact bytes, and export a private v2 manifest', async t => {
  const f = await fixture(t), p = await project(f);
  const bytes = Buffer.alloc(5 * MiB + 17);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 8)) & 255;
  const status = await f.call('/status', { token: null });
  assert.equal(status.data.object_storage.configured, true);
  const upload = await start(f, p, bytes);
  assert.equal(upload.part_bytes, 4 * MiB); assert.equal(upload.part_count, 2);
  assert.equal((await f.call(`/projects/${p.id}`)).data.project.sources.length, 0);
  await uploadAll(f, p, upload, bytes);
  const key = randomUUID(), saved = await complete(f, p, upload, { key });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  const source = saved.data.resource;
  assert.equal(source.storage_kind, 'object'); assert.equal(source.sha256, sha(bytes)); assert.equal(source.bytes, bytes.length);
  assert.equal(saved.data.project.version, p.version + 1);
  const replay = await complete(f, p, upload, { key });
  assert.equal(replay.status, 201); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.data.resource.id, source.id); assert.equal(replay.data.project.sources.length, 1);
  const response = await f.raw(`/projects/${p.id}/sources/${source.id}/content`, { token: f.reader.token });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal(response.headers.get('x-content-sha256'), sha(bytes));
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const envelope = await f.call(`/projects/${p.id}/sources/${source.id}`, { token: f.reader.token });
  assert.equal(envelope.data.data_base64, null); assert.equal(envelope.data.download_path, source.download_path);
  const exported = await f.call(`/projects/${p.id}/export`, { token: f.reader.token });
  assert.equal(exported.status, 200); assert.equal(exported.data.schema, 'brainsnn.project-export.v2');
  assert.equal(exported.data.includes_all_source_bytes, false); assert.equal(exported.data.external_source_count, 1);
  assert.equal(exported.data.sources[0].data_base64, null);
  const { integrity, ...payload } = exported.data;
  assert.equal(integrity.sha256, sha(canonical(payload)));
  const encoded = JSON.stringify(exported.data);
  assert.ok(encoded.length < 20000, 'Large bytes must not expand the JSON export.');
  assert.equal(encoded.includes('tenant/' + f.tenant.id + '/upload/'), false);
  assert.equal(encoded.includes(f.admin.token), false);
  const usage = (await f.call('/usage')).data.usage;
  assert.equal(usage.object_source_bytes, bytes.length); assert.equal(usage.reserved_object_bytes, 0);
});

test('source upload survives a lost object acknowledgement and PostgreSQL/service restart without changing parts', async t => {
  const memory = createMemoryProjectObjectStore();
  const put = memory.put.bind(memory); let loseAcknowledgement = true;
  memory.put = async (...args) => { const result = await put(...args); if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('Simulated lost object write acknowledgement'); } return result; };
  const f = await fixture(t, { objectStore: memory, persistent: true, limits: { uploadPartBytes: 1024 } });
  const p = await project(f), bytes = Buffer.alloc(2049, 193), upload = await start(f, p, bytes);
  const failed = await f.part(p, upload, 1, bytes.subarray(0, 1024));
  assert.equal(failed.status, 503); assert.equal(memory.objects.size, 1);
  assert.equal((await uploadState(f, p, upload)).data.upload.uploaded_bytes, 0);
  await f.restart();
  const resumable = (await f.call(`/projects/${p.id}/source-uploads`)).data.uploads;
  assert.equal(resumable.length, 1); assert.equal(resumable[0].id, upload.id);
  const recovered = await f.part(p, upload, 1, bytes.subarray(0, 1024));
  assert.equal(recovered.status, 200); assert.equal(recovered.data.upload.uploaded_bytes, 1024);
  const changed = await f.part(p, upload, 1, Buffer.alloc(1024, 17));
  assert.equal(changed.status, 409); assert.equal(changed.data.error.code, 'part-conflict');
  const same = await f.part(p, upload, 1, bytes.subarray(0, 1024));
  assert.equal(same.status, 200); assert.equal(same.headers.get('idempotency-replayed'), 'true');
  for (let number = 2; number <= upload.part_count; number++) {
    assert.equal((await f.part(p, upload, number, bytes.subarray((number - 1) * 1024, number * 1024))).status, 200);
  }
  const retained = await complete(f, p, upload);
  assert.equal(retained.status, 201, JSON.stringify(retained.data));
  await f.restart();
  const result = await f.raw(`/projects/${p.id}/sources/${retained.data.resource.id}/content`);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
});

test('object writes remain recoverable when a part transaction rolls back or final COMMIT acknowledgement is lost', async t => {
  let fault = null;
  const decoratePool = pool => ({
    query: (...args) => pool.query(...args),
    async connect() {
      const client = await pool.connect(); let marker;
      return {
        release: () => client.release(),
        async query(sql, values) {
          if (sql === 'BEGIN') marker = undefined;
          if (sql.includes("UPDATE brainsnn_world_source_parts SET status='stored'")) marker = 'part';
          if (sql.includes('INSERT INTO brainsnn_world_sources')) marker = 'source';
          if (sql === 'COMMIT' && fault === 'part-before' && marker === 'part') { fault = null; throw new Error('Simulated pre-commit failure'); }
          const result = await client.query(sql, values);
          if (sql === 'COMMIT' && fault === 'source-after' && marker === 'source') { fault = null; throw new Error('Simulated lost commit acknowledgement'); }
          return result;
        },
      };
    },
  });
  const f = await fixture(t, { decoratePool, limits: { uploadPartBytes: 1024 } });
  const p = await project(f), bytes = Buffer.from('exact bytes despite transaction uncertainty'), upload = await start(f, p, bytes);
  fault = 'part-before';
  assert.equal((await f.part(p, upload, 1, bytes)).status, 503);
  assert.equal(f.objectStore.objects.size, 1);
  assert.equal((await uploadState(f, p, upload)).data.upload.parts[0].status, 'reserved');
  assert.equal((await f.part(p, upload, 1, bytes)).status, 200);
  fault = 'source-after'; const key = randomUUID();
  assert.equal((await complete(f, p, upload, { key })).status, 503);
  const persisted = (await f.call(`/projects/${p.id}`)).data.project;
  assert.equal(persisted.sources.length, 1); assert.equal(persisted.version, 2);
  const replay = await complete(f, p, upload, { key });
  assert.equal(replay.status, 201); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(replay.data.resource.id, persisted.sources[0].id);
  assert.equal(replay.data.project.events.filter(event => event.type === 'source.retained').length, 1);
});

test('upload and source routes enforce tenant identity, roles and per-part/full-file integrity', async t => {
  const f = await fixture(t, { limits: { uploadPartBytes: 1024 } });
  const p = await project(f), bytes = Buffer.from('genuine fixture bytes'), upload = await start(f, p, bytes, { sha256: '0'.repeat(64) });
  const otherTenant = await f.service.provisionTenant({ name: `Other media tenant ${randomUUID()}` });
  const other = await f.service.provisionKey({ tenant_id: otherTenant.id, actor_name: 'Other editor', role: 'editor' });
  assert.equal((await f.call(`/projects/${p.id}/source-uploads/${upload.id}`, { token: other.token })).status, 404);
  assert.equal((await f.part(p, upload, 1, bytes, { token: other.token })).status, 404);
  assert.equal((await f.part(p, upload, 1, bytes, { token: f.reader.token })).status, 403);
  assert.equal((await complete(f, p, upload, { token: f.reader.token })).status, 403);
  const wrongPart = await f.part(p, upload, 1, bytes, { sha256: 'f'.repeat(64) });
  assert.equal(wrongPart.status, 422); assert.equal(wrongPart.data.error.code, 'part-hash-mismatch');
  assert.equal((await uploadState(f, p, upload)).data.upload.parts.length, 0);
  assert.equal((await f.part(p, upload, 1, bytes)).status, 200);
  const failed = await complete(f, p, upload);
  assert.equal(failed.status, 422); assert.equal(failed.data.error.code, 'source-hash-mismatch');
  assert.equal((await uploadState(f, p, upload)).data.upload.status, 'failed');
  assert.equal((await f.call(`/projects/${p.id}`)).data.project.sources.length, 0);
  const good = await start(f, p, bytes); await uploadAll(f, p, good, bytes);
  const saved = await complete(f, p, good); assert.equal(saved.status, 201);
  assert.equal((await f.raw(`/projects/${p.id}/sources/${saved.data.resource.id}/content`, { token: other.token })).status, 404);
  assert.equal((await f.raw(`/projects/${p.id}/sources/${saved.data.resource.id}/content`, { token: null })).status, 401);
});

test('verification leases allow concurrent project edits but prevent duplicate verification and cancelled publication', async t => {
  const memory = createMemoryProjectObjectStore(), originalGet = memory.get.bind(memory);
  let gate;
  memory.get = async (...args) => { if (gate) { const current = gate; gate = null; current.entered.resolve(); await current.release.promise; } return originalGet(...args); };
  const f = await fixture(t, { objectStore: memory, limits: { uploadPartBytes: 1024 } });
  let p = await project(f); const bytes = Buffer.from('verifiable bounded source'), upload = await start(f, p, bytes);
  await uploadAll(f, p, upload, bytes);
  const blocking = { entered: deferred(), release: deferred() }; gate = blocking;
  const first = complete(f, p, upload); await blocking.entered.promise;
  const duplicate = await complete(f, p, upload);
  assert.equal(duplicate.status, 409); assert.equal(duplicate.data.error.code, 'upload-verifying');
  const edited = await smallSource(f, p); p = edited.project;
  blocking.release.resolve();
  const stale = await first;
  assert.equal(stale.status, 409); assert.equal(stale.data.error.code, 'stale-version');
  assert.equal((await uploadState(f, p, upload)).data.upload.status, 'ready');
  const retained = await complete(f, p, upload); assert.equal(retained.status, 201); p = retained.data.project;
  const cancelled = await start(f, p, bytes); await uploadAll(f, p, cancelled, bytes);
  const next = { entered: deferred(), release: deferred() }; gate = next;
  const verifying = complete(f, p, cancelled); await next.entered.promise;
  assert.equal((await abort(f, p, cancelled)).status, 200);
  next.release.resolve();
  const refused = await verifying;
  assert.ok([409, 410].includes(refused.status));
  assert.equal((await uploadState(f, p, cancelled)).data.upload.status, 'aborted');
  assert.equal((await f.call(`/projects/${p.id}`)).data.project.sources.length, 2);
});

test('reservations bound concurrent large uploads and aborted/expired cleanup never deletes retained source parts', async t => {
  const memory = createMemoryProjectObjectStore();
  const f = await fixture(t, { objectStore: memory, limits: { uploadPartBytes: 128, objectSourceBytes: 400, projectObjectBytes: 400, tenantObjectBytes: 400, activeSourceUploads: 2 } });
  let p = await project(f); const bytes = Buffer.alloc(160, 7);
  const retainedUpload = await start(f, p, bytes); await uploadAll(f, p, retainedUpload, bytes);
  const retained = await complete(f, p, retainedUpload); assert.equal(retained.status, 201); p = retained.data.project;
  const retainedKeys = [...memory.objects.keys()];
  const abandoned = await start(f, p, bytes); await uploadAll(f, p, abandoned, bytes);
  const over = await f.call(`/projects/${p.id}/source-uploads`, { method: 'POST', body: { expected_version: p.version, name: 'over.bin', media_type: 'application/octet-stream', bytes: 160, sha256: sha(bytes) } });
  assert.equal(over.status, 429); assert.equal(over.data.error.code, 'object-storage-limit');
  const before = (await f.call('/usage')).data.usage;
  assert.equal(before.object_source_bytes, 160); assert.equal(before.reserved_object_bytes, 160);
  assert.equal((await abort(f, p, abandoned)).status, 200);
  assert.equal((await f.call('/usage')).data.usage.reserved_object_bytes, 0);
  const expired = await start(f, p, bytes); await uploadAll(f, p, expired, bytes);
  await f.pool.query('UPDATE brainsnn_world_source_uploads SET expires_at=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [f.tenant.id, p.id, expired.id, new Date(STAMP - 12 * 60000).toISOString()]);
  assert.equal((await complete(f, p, expired)).status, 410);
  f.setTime(STAMP + 11 * 60000);
  const preview = await f.service.cleanupSourceUploads({ apply: false });
  assert.ok(preview.uploads.some(value => value.id === abandoned.id)); assert.ok(preview.uploads.some(value => value.id === expired.id));
  assert.equal(memory.objects.size, 6);
  const originalDelete = memory.delete.bind(memory); let fail = true;
  memory.delete = async (...args) => { if (fail && args[0].includes(`/${abandoned.id}/`)) { fail = false; throw new Error('Simulated cleanup transport outage'); } return originalDelete(...args); };
  const firstCleanup = await f.service.cleanupSourceUploads({ apply: true });
  assert.ok(firstCleanup.failed >= 1);
  const incomplete = await f.pool.query('SELECT cleaned_at FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [f.tenant.id, p.id, abandoned.id]);
  assert.equal(incomplete.rows[0].cleaned_at, null);
  await f.service.cleanupSourceUploads({ apply: true });
  assert.deepEqual([...memory.objects.keys()].sort(), retainedKeys.sort());
  assert.equal((await abort(f, p, retainedUpload)).status, 409);
  const content = await f.raw(`/projects/${p.id}/sources/${retained.data.resource.id}/content`);
  assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
});

test('download refuses corrupted chunks and cannot complete a body whose whole-file SHA changed', async t => {
  const f = await fixture(t, { limits: { uploadPartBytes: 1024 } });
  const p = await project(f), bytes = Buffer.alloc(2048, 29), upload = await start(f, p, bytes);
  await uploadAll(f, p, upload, bytes);
  const saved = await complete(f, p, upload); assert.equal(saved.status, 201);
  const sourceId = saved.data.resource.id, path = `/projects/${p.id}/sources/${sourceId}/content`;
  const keys = [...f.objectStore.objects.keys()].sort();
  f.objectStore.objects.set(keys[0], Buffer.alloc(1024, 99));
  const corrupt = await f.call(path);
  assert.equal(corrupt.status, 503); assert.equal(corrupt.data.error.code, 'source-integrity-failed');
  f.objectStore.objects.set(keys[0], bytes.subarray(0, 1024));
  await f.pool.query('UPDATE brainsnn_world_sources SET sha256=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [f.tenant.id, p.id, sourceId, '0'.repeat(64)]);
  let completeBody = false;
  try { const response = await f.raw(path); if (response.status === 200) { await response.arrayBuffer(); completeBody = true; } } catch { /* A truncated authenticated response must fail at the client. */ }
  assert.equal(completeBody, false, 'Do not send the last declared byte before full-file integrity succeeds.');
});

test('cleanup fails closed when a damaged pending part row points at another retained upload', async t => {
  const f = await fixture(t, { limits: { uploadPartBytes: 1024 } });
  let p = await project(f); const bytes = Buffer.from('retained source protected from cleanup');
  const good = await start(f, p, bytes); await uploadAll(f, p, good, bytes);
  const saved = await complete(f, p, good); assert.equal(saved.status, 201); p = saved.data.project;
  const retainedKey = [...f.objectStore.objects.keys()][0];
  const abandoned = await start(f, p, bytes); await uploadAll(f, p, abandoned, bytes);
  const abandonedKey = [...f.objectStore.objects.keys()].find(key => key.includes(`/${abandoned.id}/`));
  assert.equal((await abort(f, p, abandoned)).status, 200);
  await f.pool.query('UPDATE brainsnn_world_source_parts SET object_key=$4 WHERE tenant_id=$1 AND project_id=$2 AND upload_id=$3', [f.tenant.id, p.id, abandoned.id, retainedKey]);
  f.setTime(STAMP + 11 * 60000);
  const cleanup = await f.service.cleanupSourceUploads({ apply: true });
  assert.ok(cleanup.failed >= 1);
  assert.ok(f.objectStore.objects.has(retainedKey)); assert.ok(f.objectStore.objects.has(abandonedKey));
  assert.equal(f.objectStore.calls.filter(call => call.operation === 'delete' && call.key === retainedKey).length, 0);
  const row = (await f.pool.query('SELECT cleaned_at FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [f.tenant.id, p.id, abandoned.id])).rows[0];
  assert.equal(row.cleaned_at, null);
  await f.pool.query('UPDATE brainsnn_world_source_parts SET object_key=$4 WHERE tenant_id=$1 AND project_id=$2 AND upload_id=$3', [f.tenant.id, p.id, abandoned.id, abandonedKey]);
  await f.service.cleanupSourceUploads({ apply: true });
  assert.deepEqual([...f.objectStore.objects.keys()], [retainedKey]);
  const response = await f.raw(`/projects/${p.id}/sources/${saved.data.resource.id}/content`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});

test('verification and downloads reserve the tenant read budget, including failed transfers', async t => {
  const f = await fixture(t, { limits: { uploadPartBytes: 128, sourceReadBytesPerHour: 256 } });
  const p = await project(f), bytes = Buffer.alloc(128, 39), upload = await start(f, p, bytes);
  await uploadAll(f, p, upload, bytes);
  const saved = await complete(f, p, upload); assert.equal(saved.status, 201);
  assert.equal((await f.call('/usage')).data.usage.source_read_bytes_this_hour, 128);
  const path = `/projects/${p.id}/sources/${saved.data.resource.id}/content`;
  const first = await f.raw(path); assert.deepEqual(Buffer.from(await first.arrayBuffer()), bytes);
  const rejected = await f.call(path);
  assert.equal(rejected.status, 429); assert.equal(rejected.data.error.code, 'source-read-limit');
  assert.equal((await f.call('/usage')).data.usage.source_read_bytes_this_hour, 256);
  f.setTime(STAMP + 3600000);
  const next = await project(f), pending = await start(f, next, bytes); await uploadAll(f, next, pending, bytes);
  const retained = await complete(f, next, pending); assert.equal(retained.status, 201);
  const key = [...f.objectStore.objects.keys()].find(value => value.includes(`/${pending.id}/`));
  f.objectStore.objects.set(key, Buffer.alloc(128, 10));
  const download = `/projects/${next.id}/sources/${retained.data.resource.id}/content`;
  assert.equal((await f.call(download)).status, 503);
  assert.equal((await f.call('/usage')).data.usage.source_read_bytes_this_hour, 256);
  f.objectStore.objects.set(key, bytes);
  const retry = await f.call(download);
  assert.equal(retry.status, 429); assert.equal(retry.data.error.code, 'source-read-limit');
});
