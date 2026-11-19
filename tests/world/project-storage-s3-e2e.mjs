#!/usr/bin/env node
/**
 * CI-only protocol/restart qualification against disposable MinIO over trusted
 * loopback TLS. Uses real PostgreSQL, HTTP, the production S3 adapter and SDK.
 * Authored fixture bytes establish software behavior, not live Railway storage,
 * backups, disaster recovery, site measurement or physical qualification.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createWorldProjectObjectStore } from '../../brainsnn-r3f-app/src/server/worldProjectObjectStore.js';
import { createWorldProjectService } from '../../brainsnn-r3f-app/src/server/worldProjectService.js';
import { createProjectsClient } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const { S3Client, CreateBucketCommand, HeadBucketCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand } = require('@aws-sdk/client-s3');
const runFile = promisify(execFile);
const fixedContainer = 'brainsnn-project-test-storage';
const fixtureUser = 'brainsnn-ci-storage';
const fixturePassword = 'disposable-ci-only-storage-password';
const secrets = [fixtureUser, fixturePassword];
const redact = value => secrets.reduce((result, secret) => result.split(secret).join('[redacted]'), String(value));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function requireFixture(condition, message) { if (!condition) throw new Error(message); }
function parsed(value, label) { try { return new URL(value); } catch { throw new Error(`Configure the disposable ${label} fixture URL.`); } }

function fixtureConfiguration() {
  requireFixture(process.env.WORLD_PROJECT_TEST_S3_E2E === '1', 'This script requires explicit WORLD_PROJECT_TEST_S3_E2E=1.');
  requireFixture(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS verification must remain enabled for this fixture.');
  requireFixture(!!process.env.NODE_EXTRA_CA_CERTS, 'Trust the generated fixture certificate through NODE_EXTRA_CA_CERTS.');
  const endpoint = parsed(process.env.WORLD_PROJECT_S3_ENDPOINT, 'loopback TLS storage');
  requireFixture(endpoint.protocol === 'https:' && endpoint.hostname === '127.0.0.1' && endpoint.port === '19000' && endpoint.pathname === '/' && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash,
    'This fixture accepts only the dedicated HTTPS loopback storage endpoint.');
  requireFixture(process.env.WORLD_PROJECT_S3_ACCESS_KEY_ID === fixtureUser && process.env.WORLD_PROJECT_S3_SECRET_ACCESS_KEY === fixturePassword,
    'This fixture accepts only its explicitly disposable storage credentials.');
  requireFixture(!process.env.WORLD_PROJECT_S3_SESSION_TOKEN && process.env.WORLD_PROJECT_S3_REGION === 'us-east-1' && process.env.WORLD_PROJECT_S3_FORCE_PATH_STYLE === '1',
    'Use the dedicated disposable fixture region, credentials and path-style configuration.');
  const database = parsed(process.env.WORLD_PROJECT_TEST_DATABASE_URL, 'PostgreSQL');
  requireFixture(['postgres:', 'postgresql:'].includes(database.protocol) && ['127.0.0.1', 'localhost'].includes(database.hostname) &&
    database.username === 'world_test' && database.password === 'disposable-ci-only' && database.pathname === '/world_projects_test' &&
    (!database.port || database.port === '5432') && !database.search && !database.hash,
    'This fixture only writes to the disposable loopback world_projects_test PostgreSQL database.');
  requireFixture(process.env.CI === 'true' && process.env.WORLD_PROJECT_TEST_RESTART_MINIO === '1',
    'Run this restart qualification only in CI with the explicit MinIO restart flag.');
  return { endpoint: endpoint.origin, database: process.env.WORLD_PROJECT_TEST_DATABASE_URL };
}

function administrativeClient(endpoint) {
  return new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, ignoreConfiguredEndpointUrls: true,
    credentials: { accessKeyId: fixtureUser, secretAccessKey: fixturePassword }, maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 3000, socketTimeout: 10000, requestTimeout: 15000 } });
}
async function readyBucket(s3, bucket) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try { await s3.send(new HeadBucketCommand({ Bucket: bucket })); return; }
    catch { await delay(500); }
  }
  throw new Error('Disposable S3 bucket did not become ready after restart.');
}
async function keysInBucket(s3, bucket) {
  const output = []; let continuation;
  do {
    const result = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ...(continuation ? { ContinuationToken: continuation } : {}) }));
    for (const object of result.Contents || []) output.push(object.Key);
    continuation = result.IsTruncated ? result.NextContinuationToken : null;
    requireFixture(!result.IsTruncated || typeof continuation === 'string', 'Invalid fixture bucket listing.');
  } while (continuation);
  return output.sort();
}
async function startSite({ database, storageEnv, now }) {
  const pool = await createProjectTestPool({ connectionString: database });
  const objectStore = createWorldProjectObjectStore({ env: storageEnv });
  requireFixture(objectStore, 'Production object adapter was not configured for the fixture.');
  const service = createWorldProjectService({ pool, objectStore, env: {}, now });
  let server;
  try {
    await service.initialize();
    server = createServer((req, res) => service.handle(req, res));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { pool, service, objectStore, baseUrl: `http://127.0.0.1:${server.address().port}/api/world/v1`,
      async close() {
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        await service.close(); objectStore.close(); await pool.end();
      } };
  } catch (error) {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    objectStore.close(); await service.close(); await pool.end(); throw error;
  }
}

async function main() {
  const config = fixtureConfiguration();
  const bucket = `brainsnn-ci-${randomUUID().replaceAll('-', '')}`;
  const storageEnv = {
    WORLD_PROJECT_S3_BUCKET: bucket, WORLD_PROJECT_S3_ENDPOINT: config.endpoint,
    WORLD_PROJECT_S3_REGION: 'us-east-1', WORLD_PROJECT_S3_FORCE_PATH_STYLE: '1',
    WORLD_PROJECT_S3_ACCESS_KEY_ID: fixtureUser, WORLD_PROJECT_S3_SECRET_ACCESS_KEY: fixturePassword,
  };
  let administrative = administrativeClient(config.endpoint), site, client, created = false;
  let clock = Date.now();
  try {
    await administrative.send(new CreateBucketCommand({ Bucket: bucket })); created = true;
    site = await startSite({ database: config.database, storageEnv, now: () => clock });
    const probeKey = 'fixture/protocol/immutable', probe = Buffer.from('Authored private S3 protocol fixture.');
    assert.equal((await site.objectStore.put(probeKey, probe, { sha256: hash(probe) })).created, true);
    assert.equal((await site.objectStore.put(probeKey, probe, { sha256: hash(probe) })).created, false);
    await assert.rejects(site.objectStore.put(probeKey, Buffer.from('A changed retry must not overwrite.')), error => error.code === 'object-integrity-failed');
    const checked = await site.objectStore.get(probeKey); const probeHash = createHash('sha256');
    for await (const bytes of checked.body) probeHash.update(bytes);
    assert.equal(probeHash.digest('hex'), hash(probe));
    await site.objectStore.delete(probeKey);

    const tenant = await site.service.provisionTenant({ name: `Authored S3 restart fixture ${randomUUID()}` });
    const principal = await site.service.provisionKey({ tenant_id: tenant.id, actor_name: 'Authored S3 fixture editor', role: 'editor' });
    secrets.push(principal.token);
    client = createProjectsClient({ baseUrl: site.baseUrl, apiKey: principal.token });
    const { project } = await client.createProject({ title: 'Authored large-source S3 restart fixture', description: 'Synthetic bytes used only to qualify software protocol and restart behavior.' });
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 17);
    for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 17 + (index >>> 8)) & 255;
    const expectedHash = hash(bytes), file = new Blob([bytes], { type: 'application/octet-stream' });
    const { upload } = await client.createSourceUpload(project.id, { expected_version: project.version, name: 'authored-walkthrough-fixture.bin', media_type: 'application/octet-stream', bytes: bytes.length, sha256: expectedHash });
    assert.equal(upload.part_count, 2);
    const first = bytes.subarray(0, upload.part_bytes);
    const acknowledged = await client.putSourcePart(project.id, upload.id, 1, first, { sha256: hash(first) });
    assert.equal(acknowledged.upload.uploaded_bytes, upload.part_bytes);
    client.clearApiKey(); client = null;
    const previous = site; site = null; await previous.close();
    administrative.destroy();

    // Fixed binary and container name only; no caller-provided shell text or target.
    await runFile('docker', ['restart', fixedContainer], { timeout: 45000, maxBuffer: 16384 });
    administrative = administrativeClient(config.endpoint);
    await readyBucket(administrative, bucket);
    site = await startSite({ database: config.database, storageEnv, now: () => clock });
    const puts = [];
    client = createProjectsClient({ baseUrl: site.baseUrl, apiKey: principal.token, fetchImpl: async (url, options) => {
      if (options?.method === 'PUT') puts.push(new URL(url).pathname);
      return fetch(url, options);
    } });
    const pending = await client.listSourceUploads(project.id);
    assert.equal(pending.uploads.length, 1); assert.equal(pending.uploads[0].id, upload.id);
    assert.equal(pending.uploads[0].uploaded_bytes, upload.part_bytes);
    const resumedParts = [];
    const resumed = await client.uploadSourceFile(project.id, file, { uploadId: upload.id, sha256: expectedHash, onPart: part => resumedParts.push(part.number) });
    assert.deepEqual(resumedParts, [2]); assert.equal(puts.length, 1); assert.ok(puts[0].endsWith('/parts/2'));
    assert.equal(resumed.upload.uploaded_bytes, bytes.length);
    const completionKey = randomUUID();
    const saved = await client.completeSourceUpload(project.id, upload.id, { expected_version: project.version }, { idempotencyKey: completionKey });
    const replay = await client.completeSourceUpload(project.id, upload.id, { expected_version: project.version }, { idempotencyKey: completionKey });
    assert.equal(replay.resource.id, saved.resource.id); assert.equal(replay.project.sources.length, 1);
    assert.equal(replay.project.events.filter(event => event.type === 'source.retained').length, 1);
    const downloadedHash = createHash('sha256'); let downloadedBytes = 0, closed = false, aborted = false;
    const receipt = await client.downloadSourceToSink(project.id, saved.resource.id, { sink: {
      async write(chunk) { downloadedBytes += chunk.byteLength; downloadedHash.update(chunk); },
      async close() { closed = true; }, async abort() { aborted = true; },
    } });
    assert.equal(closed, true); assert.equal(aborted, false); assert.equal(receipt.verified, true);
    assert.equal(downloadedBytes, bytes.length); assert.equal(downloadedHash.digest('hex'), expectedHash); assert.equal(receipt.sha256, expectedHash);
    const exported = await client.exportProject(project.id);
    assert.equal(exported.schema, 'brainsnn.project-export.v2'); assert.equal(exported.includes_all_source_bytes, false);
    assert.equal(exported.sources[0].data_base64, null); assert.equal(exported.external_source_count, 1);
    assert.ok(JSON.stringify(exported).length < 20000);

    const retainedKeys = await keysInBucket(administrative, bucket); assert.equal(retainedKeys.length, 2);
    const cancelledBytes = Buffer.from('Authored abandoned upload to exercise object cleanup.');
    const cancelled = (await client.createSourceUpload(project.id, { expected_version: saved.project.version, name: 'cancelled-fixture.bin', media_type: 'application/octet-stream', bytes: cancelledBytes.length, sha256: hash(cancelledBytes) })).upload;
    await client.putSourcePart(project.id, cancelled.id, 1, cancelledBytes, { sha256: hash(cancelledBytes) });
    await client.abortSourceUpload(project.id, cancelled.id, {});
    clock += 11 * 60000;
    await site.service.cleanupSourceUploads({ apply: true });
    const cleaned = (await site.pool.query('SELECT cleaned_at FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [tenant.id, project.id, cancelled.id])).rows[0];
    assert.ok(cleaned.cleaned_at);
    assert.deepEqual(await keysInBucket(administrative, bucket), retainedKeys);
    const source = (await client.getProject(project.id)).project.sources[0];
    assert.equal(source.sha256, expectedHash);
    console.log(JSON.stringify({ fixture: 'loopback TLS MinIO with real PostgreSQL', authored_bytes: bytes.length,
      production_adapter_conditional_put: true, storage_container_restarted: true, database_connections_reopened: true,
      resumed_parts: resumedParts, sdk_stream_sha256_verified: true, export_schema: exported.schema,
      cleanup_preserved_retained_parts: true, live_railway_qualified: false }));
  } finally {
    client?.clearApiKey();
    if (site) await site.close();
    try {
      if (created) {
        for (const key of await keysInBucket(administrative, bucket)) await administrative.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        await administrative.send(new DeleteBucketCommand({ Bucket: bucket }));
      }
    } finally { administrative.destroy(); }
  }
}

main().catch(error => { console.error(redact(error.stack || error.message || 'Storage fixture failed.')); process.exitCode = 1; });
