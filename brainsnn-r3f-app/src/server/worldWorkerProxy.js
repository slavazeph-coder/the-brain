import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

/**
 * brainsnn.com's own World Builder processing: the site holds the worker credentials and hands each browser a short
 * session instead, so nobody types a worker address or token.
 *
 * - Owner sessions need WORLD_SITE_PASSCODE and use the worker tenant "site-owner".
 * - Visitor sessions are on whenever their tenant credential exists (the owner turned them on, November 1 2026);
 *   WORLD_SITE_VISITORS=0 turns them off. They use the tenant "site-visitors", and get a daily job cap per connection
 *   and overall.
 * - Both tenant credentials derive from the passcode (derivedCredential), so the site and the worker share one secret.
 *   WORLD_WORKER_SITE_OWNER_TOKEN and WORLD_WORKER_SITE_VISITOR_TOKEN override that on both sides.
 *
 * Every session reaches only the uploads and jobs it created: visitors share one worker tenant, so the worker's own
 * owner checks cannot keep them apart. One process only (Railway runs one replica): sessions and counters live in
 * memory, and a restart ends them.
 */
const ID = /^[a-f0-9]{32}$/;
const TICKET = /^[A-Za-z0-9_-]{1,1000}\.[a-f0-9]{64}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{43,128}$/;
const JSON_BYTES = 16 * 1024;  // the worker's own JSON body limit
const CHUNK_BYTES = 4 * 1024 ** 2;  // and its upload chunk limit
const RESPONSE_JSON_BYTES = 1024 ** 2;
const MAX_SESSIONS = 2000;
const SESSION_MS = { owner: 12 * 3600_000, visitor: 2 * 3600_000 };
const PASSCODE_FAILURES = 10;  // per address per hour, then the passcode is not checked at all
// photo-metric is one photo to a 3D preview in estimated metres: one upload and about ten seconds of CPU.
const VISITOR_ENGINES = new Set(['colmap-sparse', 'photo-metric', 'scene-usd']);
// A visitor job needs at most one batch of uploads: a video, or up to 12 photos (COLMAP needs 3 or more), then a cloud
// for the scene. So a session holds at most one unused batch, and a connection gets a batch and a cloud per job allowed.
// All visitors together stay inside their tenant's 20 uploads, which leaves the owner's room in the worker's 50.
const VISITOR_OPEN_UPLOADS = 12;
const VISITOR_UPLOADS_PER_JOB = 13;
// The worker counts a created but unstarted job as active, and allows one per tenant. The page starts a job straight
// after creating it, so one still unstarted after this long was abandoned (a closed tab, a lost connection): cancel it.
const PREPARED_LEASE_MS = 120_000;

const digest = (value) => createHash('sha256').update(String(value)).digest();
const day = (now) => new Date(now).toISOString().slice(0, 10);
const integer = (value, fallback, low, high) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed >= low && parsed <= high ? parsed : fallback;
};

/** A worker tenant credential from the passcode; robotics/world_worker/deploy/railway/tenants.py derives the same. */
export function derivedCredential(passcode, tenant) {
  return createHmac('sha256', String(passcode)).update(`brainsnn.world.${tenant}.v1`).digest('base64url');
}

function reply(res, status, body) {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared === undefined || !/^\d+$/.test(declared)) return reject(Object.assign(new Error('Content-Length is required.'), { status: 411 }));
    if (Number(declared) > limit) return reject(Object.assign(new Error('Request exceeds the body limit.'), { status: 413 }));
    const chunks = []; let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { req.destroy(); reject(Object.assign(new Error('Request exceeds the body limit.'), { status: 413 })); }
      else chunks.push(chunk);
    });
    req.once('end', () => resolve(Buffer.concat(chunks)));
    req.once('error', () => reject(Object.assign(new Error('The request was closed.'), { status: 400 })));
  });
}

/** Which call this is, and the upload or job it names: anything else is not the site's to forward. */
export function route(method, path, query) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'v1') return null;
  const [, kind, id, action] = parts;
  if (query && !(method === 'PUT' && kind === 'uploads' && /^offset=\d{1,12}$/.test(query))) return null;
  if (parts.length === 2 && method === 'GET' && kind === 'capabilities') return { name: 'capabilities' };
  if (parts.length === 2 && method === 'POST' && kind === 'uploads') return { name: 'create-upload' };
  if (parts.length === 2 && method === 'POST' && kind === 'jobs') return { name: 'create-job' };
  if (parts.length === 3 && kind === 'download' && ['GET', 'HEAD'].includes(method) && TICKET.test(id)) return { name: 'download' };
  if (!ID.test(id ?? '')) return null;
  if (parts.length === 3 && kind === 'uploads' && ['GET', 'PUT', 'DELETE'].includes(method)) {
    if (method === 'PUT' && !query) return null;
    return { name: 'upload', upload: id };
  }
  if (kind !== 'jobs') return null;
  if (parts.length === 3 && ['GET', 'DELETE'].includes(method)) return { name: 'job', job: id };
  if (parts.length === 4 && method === 'POST' && action === 'ticket') return { name: 'ticket', job: id };
  if (parts.length === 4 && ((method === 'POST' && action === 'start') || (method === 'DELETE' && action === 'artifacts')))
    return { name: 'job', job: id };
  return null;
}

export function createWorldWorkerProxy(env = {}, { now = Date.now, token = () => randomBytes(32).toString('base64url'),
  preparedLeaseMs = PREPARED_LEASE_MS } = {}) {
  let upstream = null;
  try {
    const url = new URL(String(env.WORLD_WORKER_INTERNAL_URL || ''));
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search) upstream = url;
  } catch { /* not configured */ }
  const passcode = String(env.WORLD_SITE_PASSCODE || ''), derive = (tenant) => passcode.length >= 12 ? derivedCredential(passcode, tenant) : '';
  const ownerToken = String(env.WORLD_WORKER_SITE_OWNER_TOKEN || derive('site-owner'));
  const visitorToken = String(env.WORLD_WORKER_SITE_VISITOR_TOKEN || derive('site-visitors'));
  const ownerReady = Boolean(upstream && CREDENTIAL.test(ownerToken) && passcode.length >= 12);
  const visitorsReady = Boolean(upstream && env.WORLD_SITE_VISITORS !== '0' && CREDENTIAL.test(visitorToken) && visitorToken !== ownerToken);
  const perConnection = integer(env.WORLD_SITE_VISITOR_JOBS_PER_DAY, 2, 1, 20);
  const perDay = integer(env.WORLD_SITE_VISITOR_JOBS_TOTAL, 20, 1, 500);
  const sessions = new Map(), failures = new Map(), visitorJobs = new Map(), leases = new Map();
  const client = upstream?.protocol === 'https:' ? https : http;

  // Why visitors cannot process, as a reason code (never a value), so the owner knows which site variable to change.
  const visitorsOff = visitorsReady ? null : !upstream ? 'no-worker' : env.WORLD_SITE_VISITORS === '0' ? 'switched-off'
    : !CREDENTIAL.test(visitorToken) ? (env.WORLD_WORKER_SITE_VISITOR_TOKEN ? 'visitor-token-invalid' : 'no-passcode')
      : 'visitor-token-is-owner-token';
  const status = () => ({ available: ownerReady || visitorsReady, passcode: ownerReady, visitors: visitorsReady,
    visitorJobsPerDay: visitorsReady ? perConnection : null, visitorsOff });

  function prune() {
    const time = now();
    for (const [key, session] of sessions) if (session.expires <= time) sessions.delete(key);
    for (const [key, entry] of failures) if (entry.until <= time) failures.delete(key);
    for (const key of visitorJobs.keys()) if (!key.startsWith(day(time))) visitorJobs.delete(key);
  }

  function session(req) {
    const header = req.headers.authorization || '';
    const value = header.startsWith('Bearer ') ? header.slice(7) : '';
    const found = CREDENTIAL.test(value) ? sessions.get(value) : null;
    return found && found.expires > now() ? found : null;
  }

  async function openSession(req, res) {
    prune();
    let body;
    try { body = JSON.parse((await readBody(req, 1024)).toString('utf8') || '{}'); }
    catch (error) { return reply(res, error.status || 400, { detail: error.status ? error.message : 'Send JSON.' }); }
    const address = req.ip || req.socket?.remoteAddress || 'unknown';
    let kind;
    if (typeof body?.passcode === 'string' && body.passcode) {
      if (!ownerReady) return reply(res, 404, { detail: 'Owner processing is not set up on this site.' });
      const strikes = failures.get(address);
      if (strikes && strikes.count >= PASSCODE_FAILURES) return reply(res, 429, { detail: 'Too many wrong passcodes. Try again in an hour.' });
      if (!timingSafeEqual(digest(body.passcode), digest(passcode))) {
        failures.set(address, { count: (strikes?.count || 0) + 1, until: strikes?.until || now() + 3600_000 });
        return reply(res, 403, { detail: 'Wrong passcode.' });
      }
      kind = 'owner';
    } else if (visitorsReady) kind = 'visitor';
    else return reply(res, 403, { detail: ownerReady ? 'Enter the passcode.' : 'Processing on this site is not open.' });
    // A flood of visitor sessions never locks the owner out.
    if (kind === 'visitor' && sessions.size >= MAX_SESSIONS) return reply(res, 503, { detail: 'Too many people are processing right now. Try again later.' });
    const key = token();
    sessions.set(key, { kind, address, expires: now() + SESSION_MS[kind], uploads: new Set(), used: new Set(), jobs: new Set() });
    return reply(res, 201, { token: key, kind, expiresInSeconds: SESSION_MS[kind] / 1000 });
  }

  /** A small JSON call the site makes on its own behalf, outside any browser request. */
  function own(method, path, credential) {
    return new Promise((resolve) => {
      const outgoing = client.request(new URL(path, upstream), { method, headers: { authorization: `Bearer ${credential}` }, timeout: 30_000 }, (answer) => {
        const chunks = [];
        answer.on('data', (chunk) => chunks.push(chunk));
        answer.once('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(null); } });
      });
      outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
      outgoing.on('error', () => resolve(null));
      outgoing.end();
    });
  }

  function lease(job, credential) {
    const timer = setTimeout(async () => {
      leases.delete(job);
      if ((await own('GET', `/v1/jobs/${job}`, credential))?.status === 'prepared') await own('DELETE', `/v1/jobs/${job}`, credential);
    }, preparedLeaseMs);
    timer.unref?.();
    leases.set(job, timer);
  }

  function forward(req, res, path, { credential, body, inspect }) {
    const headers = {};
    if (credential) headers.authorization = `Bearer ${credential}`;
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    if (body) headers['content-length'] = String(body.length);
    else if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
    const outgoing = client.request(new URL(path, upstream), { method: req.method, headers, timeout: 120_000 }, (answer) => {
      const status = answer.statusCode || 502;
      if (inspect && status < 300) {
        const chunks = []; let size = 0;
        answer.on('data', (chunk) => { size += chunk.length; if (size <= RESPONSE_JSON_BYTES) chunks.push(chunk); });
        answer.once('end', () => {
          let data;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(res, 502, { detail: 'The processing worker sent an invalid reply.' }); }
          inspect(data);
          reply(res, status, data);
        });
        return;
      }
      const pass = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
      for (const name of ['content-type', 'content-length', 'content-disposition', 'content-security-policy'])
        if (answer.headers[name]) pass[name] = answer.headers[name];
      res.writeHead(status, pass);
      answer.pipe(res);
    });
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
    outgoing.on('error', () => reply(res, 502, { detail: 'BrainSNN processing is unavailable right now. Try again in a few minutes.' }));
    if (body) outgoing.end(body);
    else if (req.method === 'PUT') req.pipe(outgoing);
    else outgoing.end();
  }

  async function proxy(req, res, path, query, prefix) {
    const call = route(req.method, path, query);
    if (!call) return reply(res, 404, { detail: 'Not a BrainSNN processing call.' });
    const target = path + (query ? `?${query}` : '');
    if (call.name === 'download') return forward(req, res, target, {});  // the signed, 60-second ticket is the credential
    const current = session(req);
    if (!current) return reply(res, 401, { detail: 'Your processing session ended. Reconnect to BrainSNN processing.' });
    const credential = current.kind === 'owner' ? ownerToken : visitorToken;
    if (call.upload && !current.uploads.has(call.upload)) return reply(res, 404, { detail: 'Upload not found.' });
    if (call.job && !current.jobs.has(call.job)) return reply(res, 404, { detail: 'Job not found.' });
    if (call.name === 'upload' && req.method === 'PUT') {
      const declared = req.headers['content-length'];
      if (declared === undefined || !/^\d+$/.test(declared)) return reply(res, 411, { detail: 'Content-Length is required.' });
      if (Number(declared) > CHUNK_BYTES) return reply(res, 413, { detail: 'Request exceeds the body limit.' });
      return forward(req, res, target, { credential });
    }
    let body;
    if (req.method === 'POST') {
      try { body = await readBody(req, JSON_BYTES); } catch (error) { return reply(res, error.status, { detail: error.message }); }
    }
    if (call.name === 'create-upload') {
      let counted = null;
      if (current.kind === 'visitor') {
        prune();
        const key = `${day(now())}|uploads|${current.address}`;
        const open = [...current.uploads].filter((id) => !current.used.has(id)).length;  // not yet given to a job
        if (open >= VISITOR_OPEN_UPLOADS || (visitorJobs.get(key) || 0) >= perConnection * VISITOR_UPLOADS_PER_JOB)
          return reply(res, 429, { detail: 'Free processing takes one video at a time. Process it, or try again tomorrow.' });
        counted = key;
      }
      return forward(req, res, target, { credential, body, inspect: (data) => {
        if (!ID.test(data?.id)) return;
        current.uploads.add(data.id);
        if (counted) visitorJobs.set(counted, (visitorJobs.get(counted) || 0) + 1);
      } });
    }
    if (call.name === 'create-job') {
      let request;
      try { request = JSON.parse(body.toString('utf8')); } catch { return reply(res, 400, { detail: 'Send JSON.' }); }
      const uploads = Array.isArray(request?.upload_ids) ? request.upload_ids : [];
      if (!uploads.length || uploads.some((id) => !current.uploads.has(id))) return reply(res, 404, { detail: 'Upload not found.' });
      if (request.source_job != null && !current.jobs.has(request.source_job)) return reply(res, 404, { detail: 'Job not found.' });
      let counted = null;
      if (current.kind === 'visitor') {
        if (!VISITOR_ENGINES.has(request.engine)) return reply(res, 403, { detail: 'That engine is not open to visitors.' });
        prune();
        const today = day(now()), mine = `${today}|${current.address}`, all = `${today}|*`;
        if ((visitorJobs.get(mine) || 0) >= perConnection) return reply(res, 429, { detail: `Free processing is ${perConnection} job${perConnection === 1 ? '' : 's'} a day per connection. Try again tomorrow.` });
        if ((visitorJobs.get(all) || 0) >= perDay) return reply(res, 429, { detail: "Today's free processing is used up. Try again tomorrow." });
        counted = [mine, all];
      }
      return forward(req, res, target, { credential, body, inspect: (data) => {
        if (!ID.test(data?.id)) return;
        current.jobs.add(data.id);
        for (const upload of uploads) current.used.add(upload);
        lease(data.id, credential);
        for (const key of counted || []) visitorJobs.set(key, (visitorJobs.get(key) || 0) + 1);
      } });
    }
    if (call.name === 'job' && req.method === 'POST' && path.endsWith('/start'))
      return forward(req, res, target, { credential, body, inspect: () => { clearTimeout(leases.get(call.job)); leases.delete(call.job); } });
    if (call.name === 'ticket')  // the worker signs /v1/download/...; the browser reaches it under this site's prefix
      return forward(req, res, target, { credential, body, inspect: (data) => {
        if (typeof data?.url === 'string' && data.url.startsWith('/v1/download/')) data.url = prefix + data.url;
      } });
    return forward(req, res, target, { credential, body });
  }

  /** Mount at /api/world, before any body parser or general rate limiter: uploads stream through in 4 MiB chunks. */
  function handle(req, res, next) {
    const [path, query = ''] = req.url.split('?');
    if (path === '/processing' && req.method === 'GET') return reply(res, 200, status());
    if (path === '/session' && req.method === 'POST') return openSession(req, res);
    if (path.startsWith('/worker/')) {
      if (!status().available) return reply(res, 404, { detail: 'BrainSNN processing is not set up on this site.' });
      return proxy(req, res, path.slice('/worker'.length), query, `${req.baseUrl || ''}/worker`);
    }
    return next();
  }

  return { handle, status, sessions, leases };
}
