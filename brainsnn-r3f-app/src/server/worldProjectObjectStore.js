import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

export const PROJECT_OBJECT_CHUNK_BYTES = 4 * 1024 * 1024;
const OPERATION_TIMEOUT_MS = 45000;
const HASH = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const CONFIG_FIELDS = ['BUCKET', 'REGION', 'ENDPOINT', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY', 'SESSION_TOKEN', 'FORCE_PATH_STYLE'];

/** Deliberately excludes SDK messages, endpoints, bucket names and credentials. */
export class WorldProjectObjectStoreError extends Error {
  constructor(code, message, { status = 503, retryable = false } = {}) {
    super(message);
    this.name = 'WorldProjectObjectStoreError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}
const unavailable = () => new WorldProjectObjectStoreError('object-storage-unavailable', 'Source object storage is unavailable. Retry the same operation.', { retryable: true });
const integrity = () => new WorldProjectObjectStoreError('object-integrity-failed', 'Stored source bytes failed their integrity check.');
const invalidConfiguration = () => new WorldProjectObjectStoreError('object-storage-configuration', 'Source object storage configuration is incomplete or invalid.');

function validateKey(key) {
  if (typeof key !== 'string' || key.length > 512 || !KEY.test(key)) {
    throw new WorldProjectObjectStoreError('invalid-object-key', 'Use a valid internal source object key.', { status: 422 });
  }
  return key;
}
function cleanFailure(error) {
  if (error instanceof WorldProjectObjectStoreError) return error;
  const status = error?.$metadata?.httpStatusCode;
  if (status === 404 || error?.name === 'NoSuchKey' || error?.name === 'NotFound') {
    return new WorldProjectObjectStoreError('object-not-found', 'A retained source object is unavailable.', { status: 404 });
  }
  if (status === 409 || error?.name === 'ConditionalRequestConflict') {
    return new WorldProjectObjectStoreError('object-storage-conflict', 'Source storage changed during this operation. Retry the same operation.', { status: 409, retryable: true });
  }
  return unavailable();
}
function operation(signal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, OPERATION_TIMEOUT_MS);
  timer.unref?.();
  return {
    signal: controller.signal,
    abort,
    done() { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
  };
}

/** Private S3-compatible, bounded chunk storage. It does not grant retention or backup guarantees. */
export function createWorldProjectObjectStore({ env = process.env, client, commandClasses = {} } = {}) {
  const configured = CONFIG_FIELDS.some(field => env[`WORLD_PROJECT_S3_${field}`] !== undefined && env[`WORLD_PROJECT_S3_${field}`] !== '');
  if (!configured && !client) return null;
  const read = field => env[`WORLD_PROJECT_S3_${field}`];
  const bucket = read('BUCKET'), region = read('REGION');
  const accessKeyId = read('ACCESS_KEY_ID'), secretAccessKey = read('SECRET_ACCESS_KEY'), sessionToken = read('SESSION_TOKEN') || undefined;
  const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/\s/.test(value);
  if (typeof bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      typeof region !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(region) ||
      !secret(accessKeyId) || !secret(secretAccessKey) || (sessionToken !== undefined && !secret(sessionToken))) throw invalidConfiguration();
  let endpoint;
  if (read('ENDPOINT')) {
    try {
      const url = new URL(read('ENDPOINT'));
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
      endpoint = url.origin;
    } catch { throw invalidConfiguration(); }
  } else if (region === 'auto') throw invalidConfiguration();
  const style = read('FORCE_PATH_STYLE');
  if (style !== undefined && !['', '0', '1', 'false', 'true'].includes(style)) throw invalidConfiguration();
  const commands = { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ...commandClasses };
  if (Object.values(commands).some(command => typeof command !== 'function') || (client && typeof client.send !== 'function')) throw invalidConfiguration();
  const ownsClient = !client;
  const s3 = client || new S3Client({
    region, ...(endpoint ? { endpoint } : {}), forcePathStyle: style === '1' || style === 'true',
    credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
    maxAttempts: 2, retryMode: 'standard', followRegionRedirects: false, ignoreConfiguredEndpointUrls: true,
    // Older S3-compatible services may not support automatic CRC/trailer headers.
    // Every bounded PUT has Content-MD5; the application independently verifies SHA-256.
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 5000, socketTimeout: 30000, requestTimeout: 40000 },
  });
  let closed = false;
  const active = new Set();
  function begin(signal) {
    if (closed) throw unavailable();
    const op = operation(signal);
    active.add(op);
    const finish = op.done;
    op.done = () => { active.delete(op); finish(); };
    return op;
  }

  async function get(key, { signal } = {}) {
    validateKey(key);
    const op = begin(signal);
    let raw, body;
    try {
      if (op.signal.aborted) throw unavailable();
      const response = await s3.send(new commands.GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: op.signal });
      raw = response.Body;
      raw?.on?.('error', () => {});
      const bytes = response.ContentLength;
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > PROJECT_OBJECT_CHUNK_BYTES || !raw || typeof raw[Symbol.asyncIterator] !== 'function') {
        raw?.destroy?.();
        throw integrity();
      }
      const stop = () => { raw.destroy?.(); body?.destroy(unavailable()); op.done(); };
      op.signal.addEventListener('abort', stop, { once: true });
      // Preserve streaming/backpressure and fail closed on short or overlong provider bodies.
      body = Readable.from((async function* () {
        let received = 0;
        try {
          if (op.signal.aborted) throw unavailable();
          for await (const chunk of raw) {
            if (op.signal.aborted) throw unavailable();
            if (!(chunk instanceof Uint8Array)) throw integrity();
            received += chunk.byteLength;
            if (received > bytes) throw integrity();
            yield chunk;
          }
          if (received !== bytes) throw integrity();
        } catch (error) { throw cleanFailure(error); }
        finally {
          op.signal.removeEventListener('abort', stop);
          raw.destroy?.();
          op.done();
        }
      })(), { objectMode: false, highWaterMark: 64 * 1024 });
      // A caller can abandon an unread stream without leaving a socket or timer alive.
      body.once('close', () => { op.signal.removeEventListener('abort', stop); raw.destroy?.(); op.done(); });
      body.on('error', () => {});
      if (op.signal.aborted) stop();
      return { body, bytes };
    } catch (error) { raw?.destroy?.(); op.done(); throw cleanFailure(error); }
  }

  async function put(key, bytes, { sha256, signal } = {}) {
    validateKey(key);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > PROJECT_OBJECT_CHUNK_BYTES) {
      throw new WorldProjectObjectStoreError('object-too-large', 'Each source object must contain 1–4194304 bytes.', { status: 413 });
    }
    const value = Buffer.from(bytes);
    const hash = createHash('sha256').update(value).digest('hex');
    if (sha256 !== undefined && (typeof sha256 !== 'string' || !HASH.test(sha256) || sha256 !== hash)) {
      throw new WorldProjectObjectStoreError('object-hash-mismatch', 'The source chunk does not match its declared SHA-256.', { status: 422 });
    }
    const op = begin(signal);
    try {
      if (op.signal.aborted) throw unavailable();
      await s3.send(new commands.PutObjectCommand({
        Bucket: bucket, Key: key, Body: value, ContentLength: value.length,
        ContentType: 'application/octet-stream', ContentMD5: createHash('md5').update(value).digest('base64'),
        Metadata: { sha256: hash }, IfNoneMatch: '*',
      }), { abortSignal: op.signal });
      return { bytes: value.length, sha256: hash, created: true };
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 412 && error?.name !== 'PreconditionFailed') throw cleanFailure(error);
      // A lost acknowledgement is safe to retry only when the existing exact bytes match.
      const existing = await get(key, { signal: op.signal });
      if (existing.bytes !== value.length) { existing.body.destroy(); throw integrity(); }
      const existingHash = createHash('sha256');
      for await (const chunk of existing.body) existingHash.update(chunk);
      if (existingHash.digest('hex') !== hash) throw integrity();
      return { bytes: value.length, sha256: hash, created: false };
    } finally { op.done(); }
  }

  async function remove(key, { signal } = {}) {
    validateKey(key);
    const op = begin(signal);
    try {
      if (op.signal.aborted) throw unavailable();
      await s3.send(new commands.DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: op.signal });
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NoSuchKey' && error?.name !== 'NotFound') throw cleanFailure(error);
    } finally { op.done(); }
  }
  function close() {
    if (closed) return;
    closed = true;
    for (const op of active) { op.abort(); op.done(); }
    if (ownsClient) s3.destroy();
  }
  return Object.freeze({ put, get, delete: remove, close });
}
