/**
 * Browser/Node client for the durable World Projects API.
 * Credentials live only in this instance's closure. Nothing is logged or persisted.
 * Network failures are deliberately not retried: reuse a prepared mutation or its
 * Idempotency-Key after checking whether the first request completed.
 */
export const PROJECTS_API_VERSION = 'v1';
export const MAX_PROJECT_SOURCE_BYTES = 512 * 1024;
const DEFAULT_RESPONSE_BYTES = 64 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9:_-]{16,128}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

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
    timeoutMs: requestTimeout = timeoutMs, raw = false, binaryResponse = false, responseLimit = maxResponseBytes } = {}) {
    const mutation = method === 'POST';
    const key = mutation ? (idempotencyKey ?? createIdempotencyKey()) : null;
    const rid = requestId ?? createIdempotencyKey();
    const context = { requestId: rid, idempotencyKey: key };
    if (mutation && (typeof key !== 'string' || !KEY_PATTERN.test(key))) throw new ProjectsApiError('Use a 16–128 character Idempotency-Key containing letters, numbers, colon, underscore, or hyphen.', { ...context, code: 'invalid_idempotency_key' });
    if (typeof rid !== 'string' || !/^[A-Za-z0-9:_-]{8,128}$/.test(rid)) {
      throw new ProjectsApiError('Invalid request ID.', { code: 'invalid_request_id' });
    }
    if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 120000) {
      throw new ProjectsApiError('timeoutMs must be between 1 and 120000.', { ...context, code: 'invalid_timeout' });
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
      return request(spec.path(...ids), { ...options, method: 'POST', body });
    };
  }
  return Object.freeze(client);
}
