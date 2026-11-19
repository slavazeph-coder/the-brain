/**
 * Browser/Node client for the durable World Projects API.
 * Credentials live only in this instance's closure. Nothing is logged or persisted.
 * Network failures are deliberately not retried: reuse a prepared mutation or its
 * Idempotency-Key after checking whether the first request completed.
 */
import { sha256 as incrementalSha256 } from './projects-sha256.mjs';
export const PROJECTS_API_VERSION = 'v1';
export const MAX_PROJECT_SOURCE_BYTES = 512 * 1024;
export const PROJECT_SOURCE_PART_BYTES = 4 * 1024 * 1024;
export const MAX_PROJECT_OBJECT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_RESPONSE_BYTES = 64 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9:_-]{16,128}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function sourceFile(file) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_PROJECT_OBJECT_BYTES || typeof file.slice !== 'function') {
    throw new ProjectsApiError('Use a nonempty File or Blob of at most 2 GiB.', { code: 'invalid_source_file' });
  }
  return file;
}
function cancelled(signal) {
  if (signal?.aborted) throw new ProjectsApiError('Source transfer cancelled.', { code: 'aborted' });
}

/** Full-file SHA-256 with at most one 4 MiB slice in memory. */
export async function hashSourceFile(file, { signal, onProgress } = {}) {
  sourceFile(file); cancelled(signal);
  const hash = incrementalSha256.create();
  try {
    onProgress?.({ phase: 'hashing', completedBytes: 0, totalBytes: file.size });
    for (let offset = 0; offset < file.size; offset += PROJECT_SOURCE_PART_BYTES) {
      cancelled(signal);
      const end = Math.min(file.size, offset + PROJECT_SOURCE_PART_BYTES);
      const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      cancelled(signal);
      if (bytes.byteLength !== end - offset) throw new ProjectsApiError('A file slice changed or could not be read completely.', { code: 'source_read_mismatch' });
      hash.update(bytes);
      onProgress?.({ phase: 'hashing', completedBytes: end, totalBytes: file.size });
      // Give browser progress/cancellation a task boundary even for memory Blobs.
      if ((offset / PROJECT_SOURCE_PART_BYTES) % 4 === 3) await new Promise(resolve => setTimeout(resolve, 0));
    }
    cancelled(signal);
    return hex(hash.digest());
  } finally { hash.destroy(); }
}

export class ProjectsApiError extends Error {
  constructor(message, { code = 'request_failed', status = 0, requestId = null,
    idempotencyKey = null, details = null } = {}) {
    super(message);
    this.name = 'ProjectsApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.idempotencyKey = idempotencyKey;
    this.details = details;
  }
}

/** Create once per intended mutation; keep it with the same body for explicit retry. */
export function createIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `wp_${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
    return `wp_${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
  }
  throw new ProjectsApiError('A cryptographic random source is required.', { code: 'random_unavailable' });
}

function identifier(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new ProjectsApiError('Invalid resource identifier.', { code: 'invalid_identifier' });
  }
  return value;
}

function normalizeBase(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\r\n\\]/.test(value)) {
    throw new ProjectsApiError('Invalid API base URL.', { code: 'invalid_base_url' });
  }
  const relative = value.startsWith('/') && !value.startsWith('//');
  let parsed;
  try { parsed = new URL(value, relative ? 'https://projects.invalid' : undefined); }
  catch { throw new ProjectsApiError('Use an HTTPS API URL or a same-origin absolute path.', { code: 'invalid_base_url' }); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((!relative && parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) ||
      parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ProjectsApiError('Use HTTPS (or local HTTP) without credentials, query, or fragment.', { code: 'invalid_base_url' });
  }
  return relative ? parsed.pathname.replace(/\/+$/, '') : `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
}

function checkSource(body) {
  const text = typeof body?.content_text === 'string';
  const binary = typeof body?.data_base64 === 'string';
  if (text === binary) throw new ProjectsApiError('Supply exactly one of content_text or data_base64.', { code: 'invalid_source' });
  let bytes;
  if (text) bytes = new TextEncoder().encode(body.content_text).byteLength;
  else {
    if (body.data_base64.length > Math.ceil(MAX_PROJECT_SOURCE_BYTES / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data_base64)) {
      throw new ProjectsApiError('Supply standard base64 for a source of at most 512 KiB.', { code: 'invalid_source' });
    }
    bytes = body.data_base64.length / 4 * 3 - (body.data_base64.endsWith('==') ? 2 : body.data_base64.endsWith('=') ? 1 : 0);
  }
  if (bytes < 1 || bytes > MAX_PROJECT_SOURCE_BYTES) {
    throw new ProjectsApiError('A retained source must contain 1–524288 decoded bytes.', { code: 'source_too_large' });
  }
}

async function readBytes(response, maximum) {
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw new ProjectsApiError('API response exceeded the configured byte limit.', { code: 'response_too_large' });
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximum) {
      throw new ProjectsApiError('API response exceeded the configured byte limit.', { code: 'response_too_large' });
    }
    return bytes;
  }
}

async function readJson(response, maximum) {
  const raw = new TextDecoder().decode(await readBytes(response, maximum));
  try { return JSON.parse(raw); }
  catch { throw new ProjectsApiError('API returned an invalid JSON response.', { code: 'invalid_response' }); }
}

const MUTATIONS = Object.freeze({
  createProject: { ids: 0, path: () => '/projects' },
  addSource: { ids: 1, path: p => `/projects/${p}/sources`, source: true },
  createRevision: { ids: 1, path: p => `/projects/${p}/revisions` },
  addEvidence: { ids: 1, path: p => `/projects/${p}/evidence` },
  reviewEvidence: { ids: 2, path: (p, e) => `/projects/${p}/evidence/${e}/review` },
  createChange: { ids: 1, path: p => `/projects/${p}/changes` },
  decideChange: { ids: 2, path: (p, c) => `/projects/${p}/changes/${c}/decisions` },
  createTrial: { ids: 1, path: p => `/projects/${p}/trials` },
  createKey: { ids: 0, path: () => '/keys' },
  revokeKey: { ids: 1, path: key => `/keys/${key}/revoke` },
  createSourceUpload: { ids: 1, path: p => `/projects/${p}/source-uploads` },
  completeSourceUpload: { ids: 2, path: (p, u) => `/projects/${p}/source-uploads/${u}/complete`, timeoutMs: 300000 },
  abortSourceUpload: { ids: 2, path: (p, u) => `/projects/${p}/source-uploads/${u}/abort` },
});

export function createProjectsClient({ apiKey = '', baseUrl = '/api/world/v1', fetchImpl = globalThis.fetch,
  timeoutMs = 30000, maxResponseBytes = DEFAULT_RESPONSE_BYTES } = {}) {
  if (typeof apiKey !== 'string' || /\s/.test(apiKey) || apiKey.length > 4096) {
    throw new ProjectsApiError('Use a provisioned API key without whitespace.', { code: 'invalid_api_key' });
  }
  if (typeof fetchImpl !== 'function') throw new ProjectsApiError('A fetch implementation is required.', { code: 'fetch_unavailable' });
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new ProjectsApiError('timeoutMs must be between 1 and 120000.', { code: 'invalid_timeout' });
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 64 * 1024 * 1024) {
    throw new ProjectsApiError('maxResponseBytes must be between 1 and 64 MiB.', { code: 'invalid_response_limit' });
  }
  const base = normalizeBase(baseUrl);
  let secret = apiKey;

  async function request(path, { method = 'GET', body, signal, idempotencyKey, requestId, publicRequest = false,
    timeoutMs: requestTimeout = timeoutMs, raw = false, binaryResponse = false, responseLimit = maxResponseBytes, extraHeaders = {} } = {}) {
    const mutation = method === 'POST';
    const key = mutation ? (idempotencyKey ?? createIdempotencyKey()) : null;
    const rid = requestId ?? createIdempotencyKey();
    const context = { requestId: rid, idempotencyKey: key };
    if (mutation && (typeof key !== 'string' || !KEY_PATTERN.test(key))) throw new ProjectsApiError('Use a 16–128 character Idempotency-Key containing letters, numbers, colon, underscore, or hyphen.', { ...context, code: 'invalid_idempotency_key' });
    if (typeof rid !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(rid)) {
      throw new ProjectsApiError('Invalid request ID.', { code: 'invalid_request_id' });
    }
    const maximumTimeout = method === 'POST' && /^\/projects\/[A-Za-z0-9_-]+\/source-uploads\/[A-Za-z0-9_-]+\/complete$/.test(path) ? 300000 : 120000;
    if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > maximumTimeout) {
      throw new ProjectsApiError(`timeoutMs must be between 1 and ${maximumTimeout}.`, { ...context, code: 'invalid_timeout' });
    }
    if (!publicRequest && !secret) throw new ProjectsApiError('Connect a provisioned API key first.', { ...context, code: 'missing_api_key' });
    if (signal?.aborted) throw new ProjectsApiError('Request cancelled before sending.', { ...context, code: 'aborted' });
    const credential = secret;
    const redact = value => typeof value === 'string' && credential ? value.split(credential).join('[redacted]') : value;
    let serialized;
    try { serialized = body === undefined ? undefined : raw ? body : JSON.stringify(body); }
    catch { throw new ProjectsApiError('Request body must be JSON serializable.', { ...context, code: 'invalid_body' }); }

    const controller = new AbortController();
    let timedOut = false, timer, rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = reject; });
    const cancel = () => {
      const error = new ProjectsApiError(timedOut ? 'Request timed out. A submitted mutation may still have completed; reuse its idempotency key when retrying.' : 'Request cancelled. A submitted mutation may still have completed; reuse its idempotency key when retrying.',
        { ...context, code: timedOut ? 'timeout' : 'aborted' });
      controller.abort(error);
      rejectAbort(error);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => { timedOut = true; cancel(); }, requestTimeout);
    if (signal?.aborted) cancel();
    try {
      return await Promise.race([aborted, (async () => {
        if (controller.signal.aborted) throw controller.signal.reason;
        const response = await fetchImpl(base + path, {
          method, body: serialized,
          headers: {
            Accept: 'application/json',
            ...extraHeaders,
            'X-Request-Id': rid,
            ...(publicRequest ? {} : { Authorization: `Bearer ${credential}` }),
            ...(serialized === undefined ? {} : { 'Content-Type': raw ? 'application/octet-stream' : 'application/json' }),
            ...(mutation ? { 'Idempotency-Key': key } : {}),
          },
          signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        });
        if (response.ok && binaryResponse) return readBytes(response, responseLimit);
        const data = await readJson(response, maxResponseBytes);
        if (!response.ok) {
          const remote = data?.error;
          const remoteId = response.headers?.get('x-request-id') || remote?.request_id || rid;
          let details = null;
          if (remote?.details != null) {
            try { details = JSON.parse(redact(JSON.stringify(remote.details)).slice(0,4096)); } catch { /* Do not leak malformed diagnostics. */ }
          }
          throw new ProjectsApiError(typeof remote?.message === 'string' ? redact(remote.message).slice(0,1000) : `API request failed (${response.status}).`, {
            status: response.status,
            code: typeof remote?.code === 'string' ? redact(remote.code).slice(0,100) : 'http_error',
            requestId: redact(String(remoteId)).slice(0,128), idempotencyKey: key, details,
          });
        }
        return data;
      })()]);
    } catch (error) {
      if (error instanceof ProjectsApiError) {
        if (!error.requestId) error.requestId = rid;
        if (!error.idempotencyKey) error.idempotencyKey = key;
        throw error;
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      // Native/network error strings can contain URLs or headers. Return bounded,
      // credential-free diagnostics instead of exposing the upstream error object.
      throw new ProjectsApiError('Could not reach the Projects API. A submitted mutation may still have completed; reuse its idempotency key when retrying.', { ...context, code: 'network_error' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      controller.abort();
    }
  }

  const client = {
    status: options => request('/status', { ...options, publicRequest: true }),
    me: options => request('/me', options),
    listProjects: options => request('/projects', options),
    getProject: (projectId, options) => request(`/projects/${identifier(projectId)}`, options),
    exportProject: (projectId, options) => request(`/projects/${identifier(projectId)}/export`, options),
    getSource: (projectId, sourceId, options) => request(`/projects/${identifier(projectId)}/sources/${identifier(sourceId)}`, options),
    listSourceUploads: (projectId, options) => request(`/projects/${identifier(projectId)}/source-uploads`, options),
    getSourceUpload: (projectId, uploadId, options) => request(`/projects/${identifier(projectId)}/source-uploads/${identifier(uploadId)}`, options),
    hashSourceFile,
    putSourcePart(projectId, uploadId, number, bytes, { sha256, ...options } = {}) {
      if (!Number.isSafeInteger(number) || number < 1 || number > Math.ceil(MAX_PROJECT_OBJECT_BYTES / PROJECT_SOURCE_PART_BYTES) || !validHash(sha256)) {
        return Promise.reject(new ProjectsApiError('Use a valid part number and its lowercase SHA-256.', { code: 'invalid_source_part' }));
      }
      const size = bytes instanceof ArrayBuffer ? bytes.byteLength : ArrayBuffer.isView(bytes) ? bytes.byteLength : bytes?.size;
      if (!Number.isSafeInteger(size) || size < 1 || size > PROJECT_SOURCE_PART_BYTES) {
        return Promise.reject(new ProjectsApiError('Upload one nonempty part of at most 4 MiB.', { code: 'invalid_source_part' }));
      }
      return request(`/projects/${identifier(projectId)}/source-uploads/${identifier(uploadId)}/parts/${number}`, {
        ...options, method: 'PUT', body: bytes, raw: true, extraHeaders: { 'X-Content-SHA256': sha256 },
      });
    },
    /**
     * Explicit one-pass transfer/resume. Hashes the selected file first, compares
     * every stored part before skipping it, and stops on the first failed request.
     * Does NOT finalize: explicitly complete with a current project version/key.
     */
    async uploadSourceFile(projectId, file, { uploadId, expectedVersion, name = file?.name || 'capture.bin',
      mediaType = file?.type || 'application/octet-stream', sha256: expectedHash, createIdempotencyKey: creationKey = createIdempotencyKey(),
      signal, onProgress, onUpload, onPart } = {}) {
      sourceFile(file); identifier(projectId); cancelled(signal);
      let upload;
      try {
        if (expectedHash !== undefined && !validHash(expectedHash)) throw new ProjectsApiError('Use a lowercase expected SHA-256.', { code: 'invalid_source_hash' });
        if (uploadId) upload = (await client.getSourceUpload(projectId, uploadId, { signal })).upload;
        const hash = await hashSourceFile(file, { signal, onProgress });
        if (expectedHash !== undefined && hash !== expectedHash) throw new ProjectsApiError('The selected file does not match its expected SHA-256.', { code: 'source_hash_mismatch' });
        if (!uploadId) {
          if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ProjectsApiError('Use the current project version when creating an upload.', { code: 'invalid_version' });
          upload = (await client.createSourceUpload(projectId, {
            expected_version: expectedVersion, name, media_type: mediaType, bytes: file.size, sha256: hash,
          }, { signal, idempotencyKey: creationKey })).upload;
          uploadId = upload?.id;
        }
        if (!upload || upload.id !== uploadId || upload.project_id !== projectId || upload.sha256 !== hash || upload.bytes !== file.size) {
          throw new ProjectsApiError('Reselect the exact original file; the upload size or SHA-256 differs.', { code: 'source_upload_mismatch' });
        }
        const partBytes = upload.part_bytes;
        if (!Number.isSafeInteger(partBytes) || partBytes < 1 || partBytes > PROJECT_SOURCE_PART_BYTES ||
            !Number.isSafeInteger(upload.part_count) || upload.part_count < 1 || upload.part_count > 512 ||
            upload.part_count !== Math.ceil(file.size / partBytes) || !Array.isArray(upload.parts) || upload.parts.length > upload.part_count) {
          throw new ProjectsApiError('The server returned an invalid bounded upload manifest.', { code: 'invalid_upload_manifest' });
        }
        onUpload?.(upload);
        if (['ready', 'retained', 'verifying'].includes(upload.status)) return { upload };
        if (upload.status !== 'uploading') throw new ProjectsApiError(`This upload is ${upload.status}; start a new upload after reviewing its state.`, { code: 'source_upload_closed' });
        const stored = new Map();
        for (const part of upload.parts) {
          if (!Number.isSafeInteger(part.number) || part.number < 1 || part.number > upload.part_count || stored.has(part.number)) {
            throw new ProjectsApiError('The upload manifest contains invalid or duplicate parts.', { code: 'invalid_upload_manifest' });
          }
          stored.set(part.number, part);
        }
        onProgress?.({ phase: 'uploading', completedBytes: 0, totalBytes: file.size, partCount: upload.part_count });
        for (let number = 1; number <= upload.part_count; number++) {
          cancelled(signal);
          const offset = (number - 1) * partBytes, end = Math.min(file.size, offset + partBytes);
          const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
          cancelled(signal);
          if (bytes.byteLength !== end - offset) throw new ProjectsApiError('A file slice changed while reading.', { code: 'source_read_mismatch' });
          const sha256 = hex(incrementalSha256(bytes));
          const known = stored.get(number);
          if (known && (known.bytes !== bytes.byteLength || known.sha256 !== sha256 || !['reserved', 'stored'].includes(known.status))) {
            throw new ProjectsApiError('The reselected file differs from a reserved or stored part.', { code: 'source_part_mismatch' });
          }
          if (known?.status !== 'stored') {
            const result = await client.putSourcePart(projectId, uploadId, number, bytes, { sha256, signal });
            if (result.part?.number !== number || result.part?.bytes !== bytes.byteLength || result.part?.sha256 !== sha256 || result.part?.status !== 'stored' || result.upload?.id !== uploadId) {
              throw new ProjectsApiError('The server part receipt does not match the uploaded bytes.', { code: 'source_part_receipt_mismatch' });
            }
            upload = result.upload;
            onUpload?.(upload); onPart?.(result.part);
          }
          onProgress?.({ phase: 'uploading', completedBytes: end, totalBytes: file.size, partNumber: number, partCount: upload.part_count });
        }
        cancelled(signal);
        if (upload.uploaded_bytes !== file.size) throw new ProjectsApiError('The upload is not completely stored; reload its state before resuming.', { code: 'source_upload_incomplete' });
        return { upload };
      } catch (error) {
        const failure = error instanceof Error ? error : new ProjectsApiError('Source upload failed.', { code: 'source_upload_failed' });
        if (uploadId) failure.uploadId = uploadId;
        throw failure;
      }
    },
    /** Stream exact source bytes with backpressure; close the sink only after verification. */
    async downloadSourceToSink(projectId, sourceId, { sink, signal, onProgress, maxBytes = MAX_PROJECT_OBJECT_BYTES,
      idleTimeoutMs = 30000, requestId = createIdempotencyKey() } = {}) {
      identifier(projectId); identifier(sourceId);
      if (!sink || typeof sink.write !== 'function' || typeof sink.close !== 'function' || typeof sink.abort !== 'function') {
        throw new ProjectsApiError('Supply an asynchronous sink with write, close, and abort.', { code: 'invalid_download_sink' });
      }
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PROJECT_OBJECT_BYTES ||
          !Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < 1 || idleTimeoutMs > 120000) {
        throw new ProjectsApiError('Use bounded source size and idle timeout limits.', { code: 'invalid_download_limit' });
      }
      if (typeof requestId !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(requestId)) {
        throw new ProjectsApiError('Invalid request ID.', { code: 'invalid_request_id' });
      }
      const controller = new AbortController();
      let timer, reader, count = 0;
      const hash = incrementalSha256.create();
      let rejectAbort;
      const aborted = new Promise((_, reject) => { rejectAbort = reject; });
      // Keep cancellation observed even when it arrives between awaited operations.
      aborted.catch(() => {});
      const rejectOnAbort = () => rejectAbort(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
      const wait = promise => Promise.race([Promise.resolve(promise), aborted]);
      const abort = () => controller.abort(new ProjectsApiError('Source download cancelled.', { code: 'aborted', requestId }));
      const deadline = () => {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(new ProjectsApiError('Source download stalled.', { code: 'timeout', requestId })), idleTimeoutMs);
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      try {
        cancelled(controller.signal);
        const { source } = await wait(client.getSource(projectId, sourceId, { signal: controller.signal }));
        if (!source || source.id !== sourceId || !validHash(source.sha256) || !Number.isSafeInteger(source.bytes) || source.bytes < 1 || source.bytes > maxBytes) {
          throw new ProjectsApiError('The source metadata exceeds the download limit or lacks a valid digest.', { code: 'invalid_source_manifest' });
        }
        if (!secret) throw new ProjectsApiError('Connect a provisioned API key first.', { code: 'missing_api_key' });
        const credential = secret;
        const redact = value => String(value).split(credential).join('[redacted]');
        deadline();
        const response = await wait(fetchImpl(`${base}/projects/${projectId}/sources/${sourceId}/content`, {
          method: 'GET', headers: { Authorization: `Bearer ${credential}`, 'X-Request-Id': requestId, Accept: 'application/octet-stream' },
          signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        }));
        if (!response.ok) {
          let data;
          try { data = await wait(readJson(response, Math.min(maxResponseBytes, 65536))); }
          catch { /* Fall back to bounded status-only diagnostics for non-JSON errors. */ }
          const remote = data?.error;
          throw new ProjectsApiError(typeof remote?.message === 'string' ? redact(remote.message).slice(0, 1000) : `Source download refused (${response.status}).`, {
            code: typeof remote?.code === 'string' ? redact(remote.code).slice(0, 100) : 'source_download_failed',
            status: response.status, requestId: redact(response.headers.get('x-request-id') || remote?.request_id || requestId).slice(0, 128),
          });
        }
        const declared = response.headers.get('content-length');
        if (!declared || !/^\d+$/.test(declared) || Number(declared) !== source.bytes || response.headers.get('x-content-sha256') !== source.sha256 || !response.body?.getReader) {
          throw new ProjectsApiError('Source download headers do not match its saved size and SHA-256.', { code: 'source_header_mismatch' });
        }
        reader = response.body.getReader();
        onProgress?.({ phase: 'downloading', completedBytes: 0, totalBytes: source.bytes });
        while (true) {
          cancelled(controller.signal); deadline();
          const { value, done } = await wait(reader.read());
          if (done) break;
          count += value.byteLength;
          if (count > source.bytes || count > maxBytes) throw new ProjectsApiError('The source stream exceeded its declared length.', { code: 'source_size_mismatch' });
          hash.update(value);
          await wait(sink.write(value));
          cancelled(controller.signal);
          onProgress?.({ phase: 'downloading', completedBytes: count, totalBytes: source.bytes });
        }
        if (count !== source.bytes) throw new ProjectsApiError('The source stream ended before its declared length.', { code: 'source_size_mismatch' });
        const sha256 = hex(hash.digest());
        if (sha256 !== source.sha256) throw new ProjectsApiError('The downloaded source SHA-256 does not match its saved digest.', { code: 'source_hash_mismatch' });
        cancelled(controller.signal); deadline();
        await wait(sink.close()); clearTimeout(timer);
        return { source, bytes: count, sha256, verified: true };
      } catch (error) {
        const failure = controller.signal.aborted ? controller.signal.reason : error instanceof ProjectsApiError ? error : new ProjectsApiError('The source stream or destination failed.', { code: 'source_download_failed', requestId });
        await Promise.resolve(sink.abort(failure)).catch(() => {});
        throw failure;
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        controller.signal.removeEventListener('abort', rejectOnAbort);
        if (reader) await reader.cancel().catch(() => {});
        hash.destroy(); controller.abort();
      }
    },
    usage: options => request('/usage', options),
    listKeys: options => request('/keys', options),
    clearApiKey: () => { secret = ''; },
    /** Native worker JSON behind tenant-scoped project authentication. Never retries. */
    processingRequest(path, { method = 'GET', body, raw = false, signal, idempotencyKey, requestId, timeoutMs: requestTimeout } = {}) {
      if (typeof path !== 'string' || !/^\/(?:capabilities|uploads(?:\/[A-Za-z0-9_-]{1,128})?|jobs(?:\/[A-Za-z0-9_-]{1,128}(?:\/(?:start|ticket|artifacts))?)?)(?:\?offset=\d+)?$/.test(path) ||
          !['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
        return Promise.reject(new ProjectsApiError('Use a supported relative processing route.', { code: 'invalid_processing_path' }));
      }
      if (raw && method !== 'PUT') return Promise.reject(new ProjectsApiError('Raw bodies are only supported for upload chunks.', { code: 'invalid_body' }));
      return request(`/processing${path}`, { method, body, raw, signal, idempotencyKey, requestId,
        ...(requestTimeout === undefined ? {} : { timeoutMs: requestTimeout }) });
    },
    /**
     * Download a worker artifact with authentication, a decoded-byte bound, and a
     * required manifest SHA-256. The default fits the durable source limit.
     */
    async processingDownload(ticketOrUrl, { sha256, expectedBytes, maxBytes = MAX_PROJECT_SOURCE_BYTES, signal, ...options } = {}) {
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(sha256)) {
        throw new ProjectsApiError('Use the artifact manifest SHA-256 before downloading.', { code: 'invalid_artifact_hash' });
      }
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024 ||
          (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > maxBytes))) {
        throw new ProjectsApiError('Artifact size must fit a positive download limit of at most 64 MiB.', { code: 'artifact_too_large' });
      }
      if (typeof ticketOrUrl !== 'string') throw new ProjectsApiError('Invalid artifact ticket.', { code: 'invalid_download_url' });
      let ticket = ticketOrUrl;
      if (ticketOrUrl.includes('/')) {
        let originBase, url;
        try {
          originBase = new URL(base, globalThis.location?.href ?? 'https://projects.invalid');
          url = new URL(ticketOrUrl, originBase);
        } catch { throw new ProjectsApiError('Invalid artifact URL.', { code: 'invalid_download_url' }); }
        const prefix = `${originBase.pathname}/processing/download/`;
        if (url.origin !== originBase.origin || !url.pathname.startsWith(prefix) || url.username || url.password || url.search || url.hash) {
          throw new ProjectsApiError('Artifact downloads must remain inside the configured Projects API.', { code: 'invalid_download_url' });
        }
        ticket = url.pathname.slice(prefix.length);
      }
      if (!/^[A-Za-z0-9._-]{1,4096}$/.test(ticket)) throw new ProjectsApiError('Invalid artifact ticket.', { code: 'invalid_download_url' });
      const bytes = await request(`/processing/download/${ticket}`, { ...options, signal, binaryResponse: true, responseLimit: maxBytes });
      if (expectedBytes !== undefined && bytes.byteLength !== expectedBytes) {
        throw new ProjectsApiError('Artifact byte count does not match its manifest.', { code: 'artifact_size_mismatch' });
      }
      if (signal?.aborted) throw new ProjectsApiError('Artifact download cancelled.', { code: 'aborted' });
      if (!globalThis.crypto?.subtle) throw new ProjectsApiError('SHA-256 verification is unavailable in this environment.', { code: 'crypto_unavailable' });
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
      if (signal?.aborted) throw new ProjectsApiError('Artifact download cancelled.', { code: 'aborted' });
      if (actual !== sha256.toLowerCase()) throw new ProjectsApiError('Artifact SHA-256 does not match its manifest.', { code: 'artifact_hash_mismatch' });
      return bytes;
    },
    /**
     * Snapshot one intent. Calling run() again sends the exact same body and key,
     * even if the caller edits the original form while the request is in flight.
     * After a 409 version conflict, refresh and create a NEW prepared mutation.
     */
    prepareMutation(action, args, { idempotencyKey = createIdempotencyKey(), requestId, ...options } = {}) {
      if (!Object.hasOwn(MUTATIONS, action) || !Array.isArray(args)) {
        throw new ProjectsApiError('Use a known mutation name and its argument array.', { code: 'invalid_mutation' });
      }
      const spec = MUTATIONS[action];
      if (args.length !== spec.ids + 1) throw new ProjectsApiError('Mutation arguments must include resource IDs followed by one body.', { code: 'invalid_mutation' });
      if (typeof idempotencyKey !== 'string' || !KEY_PATTERN.test(idempotencyKey)) throw new ProjectsApiError('Invalid Idempotency-Key.', { code: 'invalid_idempotency_key' });
      let snapshot;
      try { snapshot = JSON.stringify(args); }
      catch { throw new ProjectsApiError('Mutation arguments must be JSON serializable.', { code: 'invalid_body' }); }
      return Object.freeze({
        idempotencyKey,
        run: ({ signal, timeoutMs: attemptTimeout } = {}) => client[action](...JSON.parse(snapshot), {
          ...options, ...(signal ? { signal } : {}), ...(attemptTimeout === undefined ? {} : { timeoutMs: attemptTimeout }),
          idempotencyKey, ...(requestId ? { requestId } : {}),
        }),
      });
    },
  };
  for (const [action, spec] of Object.entries(MUTATIONS)) {
    client[action] = (...args) => {
      const ids = args.slice(0, spec.ids).map(identifier);
      const body = args[spec.ids] ?? (action === 'revokeKey' ? {} : undefined);
      const options = args[spec.ids + 1] ?? {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return Promise.reject(new ProjectsApiError('Mutation body must be a JSON object.', { code: 'invalid_body' }));
      }
      if (spec.source) {
        try { checkSource(body); } catch (error) { return Promise.reject(error); }
      }
      return request(spec.path(...ids), { ...(spec.timeoutMs ? { timeoutMs: spec.timeoutMs } : {}), ...options, method: 'POST', body });
    };
  }
  return Object.freeze(client);
}
