import { randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_BYTES = 64 * 1024;
const MAX_JOBS = 2;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json'
      || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
      reject(Object.assign(new Error('json_required'), { status: 415 }));
      return;
    }
    let chunks = [], size = 0, finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('aborted', onAbort);
      req.removeListener('error', onAbort);
      chunks = [];
      if (error) { req.pause(); reject(error); } else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) return done(Object.assign(new Error('body_too_large'), { status: 413 }));
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { done(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { done(Object.assign(new Error('invalid_json'), { status: 400 })); }
    };
    const onAbort = () => done(Object.assign(new Error('request_closed'), { status: 400 }));
    const timer = setTimeout(() => done(Object.assign(new Error('body_timeout'), { status: 408 })), 2500);
    timer.unref();
    req.on('data', onData).once('end', onEnd).once('aborted', onAbort).once('error', onAbort);
  });
}

/** One process/replica only. Jobs are transient requests, never a durable work ledger. */
export function createGpuBridge(env = {}, { deadlineMs = 14_000, pollMs = 20_000, staleMs = 30_000 } = {}) {
  const enabled = env.GPU_INFERENCE_TRANSPORT === 'outbound';
  const key = String(env.GPU_BRIDGE_WORKER_KEY || '');
  const configured = enabled && env.GPU_BRIDGE_SINGLE_REPLICA === '1'
    && key.length >= 32 && key.length <= 256 && !/[\r\n]/.test(key);
  const jobs = new Map(), waiters = new Set();
  let lastSeen = 0, closed = false;
  const alive = () => !closed && lastSeen > 0 && Date.now() - lastSeen < staleMs;
  const snapshot = () => ({ configured, workerOnline: alive(), outstanding: jobs.size });

  function finish(job, result) {
    if (!jobs.delete(job.id)) return;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    job.body = null;
    job.resolve(result);
  }

  function assign(waiter, job) {
    waiter.remove();
    job.worker = waiter.worker;
    reply(waiter.res, 200, { id: job.id, operation: job.operation, body: job.body,
      timeoutMs: Math.max(1, job.expires - Date.now()) });
  }

  function dispatch() {
    for (const job of jobs.values()) {
      if (job.worker || !waiters.size) continue;
      assign(waiters.values().next().value, job);
    }
  }

  async function request(operation, options = {}) {
    if (!configured || !alive()) return response({ error: 'worker_offline' }, 503);
    if (!['models', 'chat/completions'].includes(operation)
      || (operation === 'models' ? options.method !== 'GET' : options.method !== 'POST')) {
      return response({ error: 'operation_not_allowed' }, 400);
    }
    if (jobs.size >= MAX_JOBS) return response({ error: 'busy' }, 429);
    if (options.signal?.aborted) return response({ error: 'cancelled' }, 504);
    let body = null;
    if (operation === 'chat/completions') {
      if (typeof options.body !== 'string' || Buffer.byteLength(options.body) > MAX_BYTES) {
        return response({ error: 'body_too_large' }, 413);
      }
      try { body = JSON.parse(options.body); } catch { return response({ error: 'invalid_json' }, 400); }
    }
    return new Promise((resolve) => {
      const job = { id: randomUUID(), operation, body, resolve, signal: options.signal,
        expires: Date.now() + deadlineMs, worker: null, timer: null, abort: null };
      job.abort = () => finish(job, response({ error: 'cancelled' }, 504));
      job.timer = setTimeout(() => finish(job, response({ error: 'expired' }, 504)), deadlineMs);
      job.timer.unref();
      jobs.set(job.id, job);
      job.signal?.addEventListener('abort', job.abort, { once: true });
      if (job.signal?.aborted) job.abort();
      dispatch();
    });
  }

  async function handle(req, res) {
    if (!configured || closed) return reply(res, 503, { error: 'bridge_unavailable' });
    const supplied = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from('Bearer ' + key);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.setHeader('Connection', 'close');
      return reply(res, 401, { error: 'unauthorized' });
    }
    const worker = String(req.headers['x-brainsnn-worker'] || '');
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(worker)) return reply(res, 400, { error: 'worker_id_required' });
    const path = req.url;
    if (req.method === 'GET' && path === '/next') {
      if (waiters.size >= MAX_JOBS) return reply(res, 429, { error: 'poll_limit' });
      lastSeen = Date.now();
      const waiter = { worker, res, timer: null, remove: null };
      waiter.remove = () => { clearTimeout(waiter.timer); waiters.delete(waiter); res.removeListener('close', waiter.remove); };
      waiter.timer = setTimeout(() => { waiter.remove(); reply(res, 200, { idle: true }); }, pollMs);
      waiter.timer.unref();
      waiters.add(waiter);
      res.once('close', waiter.remove);
      dispatch();
      return;
    }
    const match = /^\/jobs\/([0-9a-f-]{36})$/.exec(path);
    if (!match || !['GET', 'POST'].includes(req.method)) return reply(res, 404, { error: 'not_found' });
    const job = jobs.get(match[1]);
    if (!job || job.worker !== worker || Date.now() >= job.expires) return reply(res, 410, { error: 'job_gone' });
    lastSeen = Date.now();
    if (req.method === 'GET') return reply(res, 200, { active: true });
    try {
      const value = await readBody(req);
      if (!value || !Number.isInteger(value.status) || (value.status !== 200 && (value.status < 400 || value.status > 599))
        || !value.body || typeof value.body !== 'object' || Array.isArray(value.body)) {
        return reply(res, 400, { error: 'invalid_result' });
      }
      // Reading a slow body can outlive cancellation/deadline: check ownership again.
      if (jobs.get(job.id) !== job || Date.now() >= job.expires) return reply(res, 410, { error: 'job_gone' });
      finish(job, response(value.body, value.status));
      return reply(res, 200, { accepted: true });
    } catch (error) {
      res.setHeader('Connection', 'close');
      return reply(res, error.status || 400, { error: error.message });
    }
  }

  function close() {
    closed = true;
    for (const waiter of waiters) { waiter.remove(); reply(waiter.res, 503, { error: 'bridge_stopped' }); }
    for (const job of jobs.values()) finish(job, response({ error: 'bridge_stopped' }, 503));
  }
  return { enabled, configured, request, handle, snapshot, close };
}
