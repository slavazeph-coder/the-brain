import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { route as workerRoute } from './worldWorkerProxy.js';

const KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{15,127}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{43,128}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const JSON_LIMIT = 1024 * 1024;
const DOWNLOAD_LIMIT = 1024 ** 3;
// A worker that is restarting or unreachable must not hold a customer request
// (and one of the 16 shared slots) for two minutes. The preflight and control
// calls are small database operations on the worker; transfers get longer, and
// a download is bounded by stalls between chunks rather than total wall time,
// so a full 1 GiB artifact can finish on a slow client connection.
export const PROCESSING_TIMEOUTS = Object.freeze({ preflightMs: 10_000, requestMs: 30_000, transferMs: 120_000, stallMs: 30_000 });

function problem(status, code, message) { return Object.assign(new Error(message), { status, code }); }

async function readRequest(req, limit) {
  const length = req.headers['content-length'];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit))
    throw problem(413, 'body_too_large', 'Request exceeds the processing body limit.');
  const pieces = []; let size = 0;
  for await (const piece of req) {
    size += piece.length;
    if (size > limit) throw problem(413, 'body_too_large', 'Request exceeds the processing body limit.');
    pieces.push(piece);
  }
  return Buffer.concat(pieces);
}

async function readJSON(response) {
  const chunks = []; let size = 0;
  if (!response.body) throw problem(502, 'worker_response', 'The processing worker returned an empty response.');
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw problem(502, 'worker_response', 'The processing response exceeded its limit.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw problem(502, 'worker_response', 'The processing worker returned invalid JSON.'); }
}

/** Dedicated worker tenants share a stable project API credential boundary.
 * Never forward a site-owner/visitor credential or accept a client worker URL.
 * The worker's SQLite ledger owns idempotent compute admission and job state.
 */
export function createProjectProcessingBridge({ env = {}, projects = null, fetchImpl = fetch, timeouts = {} } = {}) {
  const limits = { ...PROCESSING_TIMEOUTS, ...timeouts };
  let upstream, tokens = new Map(), configurationError = false;
  try {
    if (env.WORLD_WORKER_INTERNAL_URL && env.WORLD_PROJECT_WORKER_TOKENS_JSON) {
      const url = new URL(env.WORLD_WORKER_INTERNAL_URL);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
        throw new Error('configuration');
      const raw = String(env.WORLD_PROJECT_WORKER_TOKENS_JSON);
      if (raw.length > 32768) throw new Error('configuration');
      const entries = JSON.parse(raw);
      if (!entries || Array.isArray(entries) || typeof entries !== 'object' || Object.keys(entries).length > 100) throw new Error('configuration');
      const seen = new Set();
      for (const [owner, token] of Object.entries(entries)) {
        if (!OWNER.test(owner) || ['operator', 'site-owner', 'site-visitors', '__proto__', 'constructor'].includes(owner) ||
            typeof token !== 'string' || !CREDENTIAL.test(token) || seen.has(token)) throw new Error('configuration');
        seen.add(token); tokens.set(owner, token);
      }
      upstream = url;
    }
  } catch { configurationError = true; upstream = null; tokens = new Map(); }
  const admission = new Map();
  let activeRequests = 0;

  async function handle(req, res) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let gate, controller, timer, timedOut = false;
    const send = (status, data) => {
      if (res.destroyed || res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
    };
    const abort = () => controller?.abort();
    const expire = () => { timedOut = true; abort(); };
    // One active deadline at a time; re-arming replaces the previous one.
    const arm = (ms) => { clearTimeout(timer); timer = setTimeout(expire, ms); timer.unref?.(); };
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const path = '/v1' + parsed.pathname;
      const call = workerRoute(req.method, path, parsed.search.slice(1)) ||
        (req.method === 'GET' && path === '/v1/jobs' && !parsed.search ? { name: 'list-jobs' } : null);
      if (!call) throw problem(404, 'not_found', 'Unknown processing endpoint.');
      const reading = ['GET', 'HEAD'].includes(req.method) || call.name === 'ticket';
      const scope = reading ? 'processing:read' : 'processing:write';
      let principal = await projects.authenticate(req, { scopes: [scope] });
      if (!upstream || configurationError || !tokens.has(principal.tenant_id))
        throw problem(503, 'processing_unconfigured', 'Dedicated processing is not configured for this organization.');
      const time = Date.now();
      gate = admission.get(principal.tenant_id);
      if (!gate) { gate = { count: 0, active: 0, reset: time + 60000 }; admission.set(principal.tenant_id, gate); }
      if (gate.reset <= time) { gate.count = 0; gate.reset = time + 60000; }
      if (gate.count >= 120 || gate.active >= 4 || activeRequests >= 16) {
        gate = null; res.setHeader('Retry-After', '60');
        throw problem(429, 'processing_rate_limit', 'Processing request limit reached. Retry after one minute.');
      }
      gate.count++; gate.active++; activeRequests++;
      const keyed = ['create-upload', 'create-job'].includes(call.name) || path.endsWith('/start');
      const key = req.headers['idempotency-key'];
      if (keyed && (typeof key !== 'string' || !KEY.test(key)))
        throw problem(422, 'idempotency_key_required', 'Use an Idempotency-Key of 16–128 safe ASCII characters for this operation.');
      let body;
      if (['POST', 'PUT'].includes(req.method)) {
        body = await readRequest(req, req.method === 'PUT' ? 4 * 1024 ** 2 : 16384);
        if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || '')))
          throw problem(415, 'content_type', 'Send application/json for processing operations.');
        // Identity may have been revoked while the client streamed its body.
        principal = await projects.authenticate(req, { scopes: [scope], meter: false });
      }
      const token = tokens.get(principal.tenant_id);
      controller = new AbortController();
      arm(limits.preflightMs);
      req.once('aborted', abort); res.once('close', abort);
      const headers = { Authorization: `Bearer ${token}` };
      const options = { redirect: 'error', signal: controller.signal, cache: 'no-store' };
      // Check on every operation. Misconfigured credentials must not expose a
      // different organization's resources, even with a valid site API key.
      const capabilities = await fetchImpl(new URL('/v1/capabilities', upstream), { ...options, headers });
      const caps = await readJSON(capabilities);
      if (!capabilities.ok || caps.access_mode !== 'tenant' || caps.owner_id !== principal.tenant_id)
        throw problem(503, 'worker_tenant_mismatch', 'Dedicated processing credentials do not match this organization.');
      if (keyed && caps.idempotency?.supported !== true)
        throw problem(503, 'worker_upgrade_required', 'The processing worker must support durable retries before API jobs can be submitted.');
      if (call.name === 'capabilities') return send(200, caps);
      if (call.name === 'download') {
        let owner;
        try { owner = JSON.parse(Buffer.from(path.split('/').at(-1).split('.')[0], 'base64url').toString('utf8')).owner; }
        catch { throw problem(404, 'not_found', 'Download not found.'); }
        if (owner !== principal.tenant_id) throw problem(404, 'not_found', 'Download not found.');
      }
      if (body !== undefined) {
        headers['Content-Type'] = req.method === 'PUT' ? 'application/octet-stream' : 'application/json';
        headers['Content-Length'] = String(body.length);
      }
      if (keyed) headers['Idempotency-Key'] = key;
      arm(req.method === 'PUT' || call.name === 'download' ? limits.transferMs : limits.requestMs);
      const response = await fetchImpl(new URL(path + parsed.search, upstream), { ...options, headers, method: req.method, body });
      const replayed = response.headers.get('idempotency-replayed') === 'true';
      // Billing meter: count work the worker accepted, once. A failed meter write never fails the customer's request.
      const meter = (metric, quantity) => Promise.resolve(projects.meterUsage?.(principal.tenant_id, metric, quantity)).catch(() => {});
      if (call.name === 'download' && response.ok) {
        const declared = response.headers.get('content-length');
        if (declared === null || !/^\d+$/.test(declared))
          throw problem(502, 'worker_response', 'The worker must declare the exact artifact length.');
        const length = Number(declared);
        if (!Number.isSafeInteger(length) || length < 0 || length > DOWNLOAD_LIMIT)
          throw problem(413, 'artifact_limit', 'API artifact downloads are limited to 1 GiB.');
        let bytes = 0;
        arm(limits.stallMs);
        const limiter = new Transform({ transform(chunk, encoding, callback) {
          arm(limits.stallMs);
          bytes += chunk.length;
          callback(bytes > length || bytes > DOWNLOAD_LIMIT ? new Error('artifact limit') : null, chunk);
        }, flush(callback) { callback(bytes !== length ? new Error('incomplete artifact') : null); } });
        const pass = { 'Content-Type': 'application/octet-stream', 'Content-Length': String(length), 'Content-Security-Policy': 'sandbox' };
        const disposition = response.headers.get('content-disposition');
        if (disposition) pass['Content-Disposition'] = disposition;
        res.writeHead(200, pass);
        if (req.method === 'HEAD') return res.end();
        await pipeline(Readable.fromWeb(response.body), limiter, res);
        if (req.method === 'GET') await meter('processing_artifact_bytes', length);
        return;
      }
      const data = await readJSON(response);
      if (!response.ok) {
        if (response.status === 429) res.setHeader('Retry-After', '60');
        throw problem(response.status, 'worker_request_failed', typeof data.detail === 'string' ? data.detail.slice(0,350) : 'The worker refused this processing request.');
      }
      if (call.name === 'ticket') {
        if (typeof data.url !== 'string' || !/^\/v1\/download\/[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(data.url))
          throw problem(502, 'worker_response', 'The worker returned an invalid download ticket.');
        data.url = '/api/world/v1/processing' + data.url.slice(3);
        data.authorization_required = true;
      }
      if (replayed) res.setHeader('Idempotency-Replayed', 'true');
      if (!replayed && req.method === 'PUT' && call.name === 'upload') await meter('processing_upload_bytes', body.length);
      if (!replayed && req.method === 'POST' && path.endsWith('/start')) await meter('processing_jobs_started', 1);
      send(response.status, data);
    } catch (error) {
      if (res.headersSent) { if (!res.writableEnded) res.destroy(); }
      else if (timedOut && !error.status) {
        res.setHeader('Retry-After', '30');
        send(504, { error: {
          code: 'worker_timeout',
          message: 'The processing worker did not answer in time. Retry with the same Idempotency-Key or read job status.',
          request_id: requestId,
        } });
      } else send(error.status || 502, { error: {
        code: error.code || 'processing_unavailable',
        message: error.status ? error.message : 'Processing is unavailable. Retry with the same Idempotency-Key or read job status.',
        request_id: requestId,
      } });
    } finally {
      if (gate) { gate.active--; activeRequests--; }
      clearTimeout(timer); req.removeListener('aborted', abort); res.removeListener('close', abort); controller?.abort();
    }
  }
  return { handle };
}
