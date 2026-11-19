import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createWorldProjectObjectStore, WorldProjectObjectStoreError, PROJECT_OBJECT_CHUNK_BYTES } from '../../brainsnn-r3f-app/src/server/worldProjectObjectStore.js';
import { createMemoryProjectObjectStore } from './helpers/project-object-store.mjs';

const env = { WORLD_PROJECT_S3_BUCKET: 'fixture-private-bucket', WORLD_PROJECT_S3_REGION: 'auto',
  WORLD_PROJECT_S3_ENDPOINT: 'https://storage.example.test', WORLD_PROJECT_S3_ACCESS_KEY_ID: 'fixture-key',
  WORLD_PROJECT_S3_SECRET_ACCESS_KEY: 'fixture-secret' };
const key = 'tenant/tenant_fixture/upload/upload_fixture/part/0_abc123';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serviceError = (name, status) => Object.assign(new Error('Private upstream fixture-secret https://private.internal/'), { name, $metadata: { httpStatusCode: status } });
const read = async body => { const chunks = []; for await (const chunk of body) chunks.push(chunk); return Buffer.concat(chunks); };
function fixture(t, respond) {
  const calls = [];
  const client = { send: async (command, options) => { calls.push({ command, options }); return respond(command, options); } };
  const store = createWorldProjectObjectStore({ env, client });
  t.after(() => store.close());
  return { store, calls };
}
const fails = code => error => error instanceof WorldProjectObjectStoreError && error.code === code && !/fixture-secret|private\.internal/.test(error.stack);

test('object adapter is opt-in, rejects unsafe configuration and internal keys without network work', async t => {
  assert.equal(createWorldProjectObjectStore({ env: {} }), null);
  assert.throws(() => createWorldProjectObjectStore({ env: { WORLD_PROJECT_S3_BUCKET: 'fixture-bucket' } }), fails('object-storage-configuration'));
  for (const endpoint of ['http://storage.example.test', 'https://u:fixture-secret@storage.example.test', 'https://storage.example.test/path', 'https://storage.example.test/?key=fixture-secret', 'https://storage.example.test/#x']) {
    assert.throws(() => createWorldProjectObjectStore({ env: { ...env, WORLD_PROJECT_S3_ENDPOINT: endpoint } }), fails('object-storage-configuration'));
  }
  assert.throws(() => createWorldProjectObjectStore({ env: { ...env, WORLD_PROJECT_S3_FORCE_PATH_STYLE: 'perhaps' } }), fails('object-storage-configuration'));
  const aws = createWorldProjectObjectStore({ env: { ...env, WORLD_PROJECT_S3_REGION: 'us-east-1', WORLD_PROJECT_S3_ENDPOINT: '', WORLD_PROJECT_S3_SESSION_TOKEN: '' } });
  aws.close();
  const { store, calls } = fixture(t, () => ({}));
  for (const value of ['', '/leading', 'empty//segment', 'tenant/../elsewhere', 'tenant/%2Fsecret', 'https://other/key', 'bad?query', 'bad#hash', 'bad\\key', 'a'.repeat(513)]) {
    await assert.rejects(store.put(value, Buffer.from('x')), fails('invalid-object-key'));
    await assert.rejects(store.get(value), fails('invalid-object-key'));
    await assert.rejects(store.delete(value), fails('invalid-object-key'));
  }
  assert.equal(calls.length, 0);
});

test('PUT is create-only, bounded and hashes exact bytes independently before transport', async t => {
  const { store, calls } = fixture(t, () => ({}));
  const bytes = Buffer.from([0, 255, 13, 10, 240, 159, 143, 151]);
  const receipt = await store.put(key, bytes, { sha256: hash(bytes) });
  assert.deepEqual(receipt, { bytes: bytes.length, sha256: hash(bytes), created: true });
  const input = calls[0].command.input;
  assert.equal(input.Bucket, env.WORLD_PROJECT_S3_BUCKET);
  assert.equal(input.Key, key);
  assert.equal(input.IfNoneMatch, '*');
  assert.equal(input.ContentLength, bytes.length);
  assert.equal(input.ContentType, 'application/octet-stream');
  assert.equal(input.ContentMD5, createHash('md5').update(bytes).digest('base64'));
  assert.deepEqual(input.Metadata, { sha256: hash(bytes) });
  assert.deepEqual(input.Body, bytes);
  assert.notEqual(input.Body, bytes, 'A caller cannot mutate the in-flight chunk after hashing.');
  assert.ok(calls[0].options.abortSignal instanceof AbortSignal);
  await assert.rejects(store.put(key, bytes, { sha256: '0'.repeat(64) }), fails('object-hash-mismatch'));
  await assert.rejects(store.put(key, Buffer.alloc(0)), fails('object-too-large'));
  await assert.rejects(store.put(key, Buffer.alloc(PROJECT_OBJECT_CHUNK_BYTES + 1)), fails('object-too-large'));
  assert.equal(calls.length, 1);
});

test('a lost PUT acknowledgement replays only if existing actual bytes match', async t => {
  const bytes = Buffer.from('retained exact source chunk');
  let retained = bytes;
  const { store, calls } = fixture(t, command => {
    if (command.constructor.name === 'PutObjectCommand') throw serviceError('PreconditionFailed', 412);
    return { Body: Readable.from([retained.subarray(0, 4), retained.subarray(4)]), ContentLength: retained.length };
  });
  assert.deepEqual(await store.put(key, bytes), { bytes: bytes.length, sha256: hash(bytes), created: false });
  assert.deepEqual(calls.map(call => call.command.constructor.name), ['PutObjectCommand', 'GetObjectCommand']);
  retained = Buffer.from('x'.repeat(bytes.length));
  await assert.rejects(store.put(key, bytes), fails('object-integrity-failed'));
  retained = Buffer.from('short');
  await assert.rejects(store.put(key, bytes), fails('object-integrity-failed'));
});

test('GET stays streamed and rejects missing lengths, truncated and overlong bodies', async t => {
  let response;
  const { store } = fixture(t, () => response);
  let pulled = 0;
  response = { Body: Readable.from((async function* () { pulled++; yield Buffer.from('a'); pulled++; yield Buffer.from('bc'); })()), ContentLength: 3 };
  const object = await store.get(key);
  assert.equal(pulled, 0, 'Reading metadata must not buffer source bytes.');
  assert.equal(object.bytes, 3);
  assert.deepEqual(await read(object.body), Buffer.from('abc'));
  for (const length of [undefined, null, '3', 0, -1, 1.5, PROJECT_OBJECT_CHUNK_BYTES + 1]) {
    const raw = Readable.from([Buffer.from('abc')]);
    response = { Body: raw, ContentLength: length };
    await assert.rejects(store.get(key), fails('object-integrity-failed'));
    assert.equal(raw.destroyed, true);
  }
  for (const length of [2, 4]) {
    response = { Body: Readable.from([Buffer.from('abc')]), ContentLength: length };
    const result = await store.get(key);
    await assert.rejects(read(result.body), fails('object-integrity-failed'));
  }
});

test('provider and stream failures are sanitized; cancellation and close stop active reads', async t => {
  let response = () => { throw serviceError('NoSuchKey', 404); };
  const { store, calls } = fixture(t, () => response());
  await assert.rejects(store.get(key), fails('object-not-found'));
  response = () => { throw serviceError('AccessDenied', 403); };
  await assert.rejects(store.get(key), fails('object-storage-unavailable'));
  await assert.rejects(store.put(key, Buffer.from('x')), fails('object-storage-unavailable'));
  response = () => ({ Body: Readable.from((async function* () { yield Buffer.from('a'); throw serviceError('Failure', 500); })()), ContentLength: 2 });
  await assert.rejects(read((await store.get(key)).body), fails('object-storage-unavailable'));
  const aborted = new AbortController(); aborted.abort();
  const before = calls.length;
  await assert.rejects(store.get(key, { signal: aborted.signal }), fails('object-storage-unavailable'));
  assert.equal(calls.length, before);
  const raw = new Readable({ read() {} });
  response = () => ({ Body: raw, ContentLength: 2 });
  const controller = new AbortController();
  const current = await store.get(key, { signal: controller.signal });
  const reading = read(current.body);
  controller.abort();
  await assert.rejects(reading, fails('object-storage-unavailable'));
  assert.equal(raw.destroyed, true);
  const nextRaw = new Readable({ read() {} });
  response = () => ({ Body: nextRaw, ContentLength: 2 });
  const next = await store.get(key);
  const pending = read(next.body);
  store.close();
  await assert.rejects(pending, fails('object-storage-unavailable'));
  assert.equal(nextRaw.destroyed, true);
  await assert.rejects(store.get(key), fails('object-storage-unavailable'));
});

test('deletion is idempotent but does not hide provider denial or uncertainty', async t => {
  let error;
  const { store, calls } = fixture(t, () => { if (error) throw error; return {}; });
  await store.delete(key);
  assert.equal(calls[0].command.constructor.name, 'DeleteObjectCommand');
  error = serviceError('NoSuchKey', 404);
  await store.delete(key);
  error = serviceError('AccessDenied', 403);
  await assert.rejects(store.delete(key), fails('object-storage-unavailable'));
  error = serviceError('ConditionalRequestConflict', 409);
  await assert.rejects(store.put(key, Buffer.from('x')), error => fails('object-storage-conflict')(error) && error.retryable);
});

test('test-only adapter preserves shared objects across service instances and rejects changed retries', async () => {
  const first = createMemoryProjectObjectStore();
  const bytes = Buffer.from('test-only source');
  await first.put(key, bytes, { sha256: hash(bytes) });
  const second = createMemoryProjectObjectStore({ objects: first.objects });
  assert.deepEqual(await read((await second.get(key)).body), bytes);
  await assert.rejects(second.put(key, Buffer.from('changed bytes')), error => error.code === 'object-integrity-failed');
  await second.delete(key);
  await assert.rejects(first.get(key), error => error.code === 'object-not-found');
});
