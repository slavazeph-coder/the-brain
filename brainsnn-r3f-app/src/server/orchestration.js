import { assessReadiness } from './readiness.js';
import { availability } from '../generation/catalog/index.js';
import { readRequest, submitGeneration } from './studio-contract.js';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isAbsolute, dirname } from 'node:path';
import { chmodSync, existsSync } from 'node:fs';

const MAX_BODY = 256 * 1024;
const MAX_ATTEMPTS = 3;
const MAX_PENDING = 200;
const WARMUP_DEADLINE_MS = 180_000;
// How long a paid order may sit undelivered before it is reported as overdue.
// The point of a deadline is that silence becomes visible without anyone
// remembering to look: an order that is merely "old" is invisible, while an
// order that is OVERDUE is a fact the owner view can count.
const DELIVERY_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;
const activeStatuses = new Set(['generating', 'decoding']);
const json = value => JSON.stringify(value);
const parse = value => value === null ? null : JSON.parse(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function error(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function response(body, status = 200) { return new Response(json(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(json(body));
}
function equalKey(actual, key) {
  const supplied = Buffer.from(String(actual || '')), expected = Buffer.from(`Bearer ${key}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json' || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) return reject(Object.assign(new Error('json_required'), { status: 415 }));
    let chunks = [], size = 0, done = false;
    const finish = (err, value) => {
      if (done) return; done = true; clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', end); req.removeListener('aborted', abort); req.removeListener('error', abort);
      chunks = []; if (err) { req.pause(); reject(err); } else resolve(value);
    };
    const data = chunk => { size += chunk.length; if (size > MAX_BODY) finish(Object.assign(new Error('body_too_large'), { status: 413 })); else chunks.push(chunk); };
    const end = () => { try { const value = parse(Buffer.concat(chunks).toString('utf8')); if (!object(value)) error('object_required'); finish(null, value); } catch (err) { finish(Object.assign(err, { status: 400 })); } };
    const abort = () => finish(Object.assign(new Error('request_closed'), { status: 400 }));
    const timer = setTimeout(() => finish(Object.assign(new Error('body_timeout'), { status: 408 })), 2500); timer.unref();
    req.on('data', data).once('end', end).once('aborted', abort).once('error', abort);
  });
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}

function validateResearch(payload) {
  const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0');
  if (!(exact(payload, ['objective', 'sources']) || (exact(payload, ['objective', 'sources', 'engine']) && ['crewai', 'swarms-crewai'].includes(payload.engine))) || !text(payload.objective, 2000) || !Array.isArray(payload.sources) || payload.sources.length < 1 || payload.sources.length > 4) error('invalid_research_payload');
  const seen = new Set();
  for (const source of payload.sources) {
    if (!exact(source, ['id', 'title', 'url', 'content']) || typeof source.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(source.id)
      || seen.has(source.id) || !text(source.title, 200) || !text(source.content, 6000) || !text(source.url, 1000)) error('invalid_research_payload');
    seen.add(source.id);
    let url; try { url = new URL(source.url); } catch { error('invalid_research_payload'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) error('invalid_research_payload');
  }
  if (Buffer.byteLength(json(payload)) > 24_000) error('invalid_research_payload');
}

/**
 * Canonical single-GPU scheduler. The DB must live on an operator-mounted durable
 * local filesystem and be used by exactly one website replica. SQLite WAL +
 * BEGIN IMMEDIATE protects dispatch against concurrent requests/connections;
 * ORCHESTRATION_SINGLE_REPLICA is a deployment assertion, not a distributed lock.
 * Lost leases quarantine the physical GPU: expiry never means it stopped running.
 */
export function createOrchestration(env = {}, { now = Date.now, leaseMs = 30_000, deadlineMs = 14_000, responsePollMs = 40 } = {}) {
  const enabled = env.ORCHESTRATION_ENABLED === '1';
  const ownerKey = String(env.ORCHESTRATION_OWNER_KEY || ''), workerKey = String(env.ORCHESTRATION_WORKER_KEY || '');
  const validKey = key => key.length >= 32 && key.length <= 256 && !/[\r\n]/.test(key);
  const dbPath = String(env.ORCHESTRATION_DB_PATH || '');
  let configured = enabled && validKey(ownerKey) && validKey(workerKey) && ownerKey !== workerKey
    && env.ORCHESTRATION_SINGLE_REPLICA === '1' && isAbsolute(dbPath) && existsSync(dirname(dbPath));
  let db = null, closed = false;
  const pending = new Set();
  if (configured) {
    try {
      db = new DatabaseSync(dbPath); chmodSync(dbPath, 0o600);
      db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS orchestration_control (
          id INTEGER PRIMARY KEY CHECK(id=1), paused INTEGER NOT NULL DEFAULT 0,
          killed INTEGER NOT NULL DEFAULT 0, hardware INTEGER NOT NULL DEFAULT 0,
          quarantine INTEGER NOT NULL DEFAULT 0, quarantine_worker TEXT,
          reason TEXT NOT NULL DEFAULT '', fence INTEGER NOT NULL DEFAULT 0,
          resident_worker TEXT, warm_required INTEGER NOT NULL DEFAULT 1, warmup_job_id TEXT);
        INSERT OR IGNORE INTO orchestration_control(id) VALUES(1);
        CREATE TABLE IF NOT EXISTS orchestration_jobs (
          id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
          payload TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'generating',
          checkpoint TEXT, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deadline INTEGER,
          lease_token TEXT, lease_expires INTEGER, worker TEXT, warmup INTEGER NOT NULL DEFAULT 0);
        CREATE UNIQUE INDEX IF NOT EXISTS orchestration_one_gpu ON orchestration_jobs((1)) WHERE lease_token IS NOT NULL;
        CREATE TABLE IF NOT EXISTS orchestration_checkpoints (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES orchestration_jobs(id),
          stage TEXT NOT NULL, checkpoint TEXT NOT NULL, created_at INTEGER NOT NULL, fence TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS orchestration_artifacts (
          sha256 TEXT PRIMARY KEY, uri TEXT NOT NULL UNIQUE, bytes INTEGER NOT NULL, media_type TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS orchestration_job_artifacts (
          job_id TEXT NOT NULL REFERENCES orchestration_jobs(id), sha256 TEXT NOT NULL REFERENCES orchestration_artifacts(sha256), PRIMARY KEY(job_id,sha256));
        CREATE TABLE IF NOT EXISTS orchestration_approvals (
          id TEXT PRIMARY KEY, job_id TEXT NOT NULL, category TEXT NOT NULL, decision TEXT NOT NULL,
          artifact_sha256 TEXT NOT NULL, note TEXT NOT NULL, created_at INTEGER NOT NULL,
          FOREIGN KEY(job_id,artifact_sha256) REFERENCES orchestration_job_artifacts(job_id,sha256));
        CREATE TABLE IF NOT EXISTS orchestration_worker_contacts (worker TEXT PRIMARY KEY, last_seen_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS orchestration_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS billing_events (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, received_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS billing_orders (
          session_id TEXT PRIMARY KEY, kind TEXT NOT NULL, email TEXT, customer TEXT,
          amount INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL, job_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS billing_subscriptions (
          subscription_id TEXT PRIMARY KEY, customer TEXT, email TEXT, plan TEXT,
          status TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS delivery_receipts (
          operation_id TEXT PRIMARY KEY, session_id TEXT, kind TEXT NOT NULL,
          promised_artifact TEXT NOT NULL, state TEXT NOT NULL,
          evidence_locator TEXT, artifact_sha256 TEXT, job_id TEXT,
          deadline_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL, delivered_at INTEGER);
        -- One job satisfies at most one promise. Without this, two orders can
        -- link to the same render: approval discharges whichever it finds first
        -- and the other is stranded undelivered forever.
        CREATE UNIQUE INDEX IF NOT EXISTS delivery_receipts_one_job
          ON delivery_receipts(job_id) WHERE job_id IS NOT NULL;
        CREATE TRIGGER IF NOT EXISTS artifacts_immutable_update BEFORE UPDATE ON orchestration_artifacts BEGIN SELECT RAISE(ABORT,'immutable_artifact'); END;
        CREATE TRIGGER IF NOT EXISTS artifacts_immutable_delete BEFORE DELETE ON orchestration_artifacts BEGIN SELECT RAISE(ABORT,'immutable_artifact'); END;
        CREATE TRIGGER IF NOT EXISTS approvals_immutable_update BEFORE UPDATE ON orchestration_approvals BEGIN SELECT RAISE(ABORT,'immutable_approval'); END;
        CREATE TRIGGER IF NOT EXISTS approvals_immutable_delete BEFORE DELETE ON orchestration_approvals BEGIN SELECT RAISE(ABORT,'immutable_approval'); END;
        CREATE TRIGGER IF NOT EXISTS checkpoints_immutable_update BEFORE UPDATE ON orchestration_checkpoints BEGIN SELECT RAISE(ABORT,'immutable_checkpoint'); END;
        CREATE TRIGGER IF NOT EXISTS checkpoints_immutable_delete BEFORE DELETE ON orchestration_checkpoints BEGIN SELECT RAISE(ABORT,'immutable_checkpoint'); END;
      `);
      const controlColumns = db.prepare('PRAGMA table_info(orchestration_control)').all().map(row => row.name);
      for (const [column, definition] of [['resident_worker', 'TEXT'], ['warm_required', 'INTEGER NOT NULL DEFAULT 1'], ['warmup_job_id', 'TEXT']]) {
        if (!controlColumns.includes(column)) db.exec(`ALTER TABLE orchestration_control ADD COLUMN ${column} ${definition}`);
      }
      if (!db.prepare('PRAGMA table_info(orchestration_jobs)').all().some(row => row.name === 'warmup')) db.exec('ALTER TABLE orchestration_jobs ADD COLUMN warmup INTEGER NOT NULL DEFAULT 0');
      // Guarded so a database created before the link column existed still opens.
      if (!db.prepare('PRAGMA table_info(delivery_receipts)').all().some(row => row.name === 'job_id')) db.exec('ALTER TABLE delivery_receipts ADD COLUMN job_id TEXT');
      // A restart requires a real backend health result before assuming warmth.
      db.exec('UPDATE orchestration_control SET warm_required=1 WHERE id=1');
    } catch { db?.close(); db = null; configured = false; }
  }
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args).map(row => ({ ...row }));
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const event = (type, detail) => run('INSERT INTO orchestration_events(type,detail,created_at) VALUES(?,?,?)', type, json(detail), now());
  const control = () => {
    const row = get('SELECT * FROM orchestration_control WHERE id=1');
    return { paused: !!row.paused, kill: !!row.killed, hardwarePaused: !!row.hardware, gpuQuarantined: !!row.quarantine, idleResident: !!row.resident_worker, warmRequired: !!row.warm_required, externalExecution: false, reason: row.reason };
  };
  const transaction = callback => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = callback(); db.exec('COMMIT'); return result; } catch (err) { db.exec('ROLLBACK'); throw err; }
  };

  // ----------------------------------------------------------------
  // BILLING
  // ----------------------------------------------------------------
  // The Stripe webhook verified its signature correctly and then only
  // console.log'd the event, so a customer could pay and the application had no
  // record that they had. Nothing here talks to Stripe: it records what Stripe
  // already told us, so money that was taken can actually be honoured.
  //
  // Idempotency is structural rather than incidental. Stripe redelivers events,
  // so the event id is the primary key, and a paid order's render job is keyed on
  // the session id -- submit() already rejects a repeated idempotency key, so a
  // redelivery can never queue a second render.

  function upsertSubscription(subscriptionId, customer, email, plan, status) {
    run(`INSERT INTO billing_subscriptions(subscription_id,customer,email,plan,status,updated_at)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(subscription_id) DO UPDATE SET
           customer=excluded.customer, email=COALESCE(excluded.email,email),
           plan=COALESCE(excluded.plan,plan), status=excluded.status, updated_at=excluded.updated_at`,
      subscriptionId, customer ? String(customer) : null, email ? String(email) : null,
      plan ? String(plan) : null, status, now());
  }

  function recordBillingEvent(value) {
    if (!configured || closed) return { recorded: false, reason: 'unconfigured' };
    const id = String(value?.id ?? ''), type = String(value?.type ?? '');
    if (!id || !type) return { recorded: false, reason: 'malformed_event' };
    // A non-numeric amount is a payload we do not understand. Recording it as
    // $0 files a real sale as worthless; refusing it instead lets Stripe retry.
    const rawAmount = value?.data?.object?.amount_total;
    if (rawAmount !== undefined && rawAmount !== null && !Number.isFinite(rawAmount)) {
      return { recorded: false, reason: 'invalid_amount' };
    }
    if (get('SELECT id FROM billing_events WHERE id=?', id)) {
      return { recorded: false, duplicate: true, type };
    }
    const obj = value?.data?.object ?? {};
    const meta = obj.metadata ?? {};
    const out = { recorded: true, type, order: null, subscription: null, delivery: null };

    transaction(() => {
      run('INSERT INTO billing_events(id,type,received_at) VALUES(?,?,?)', id, type, now());

      // Delayed payment methods complete a Checkout Session BEFORE the money
      // settles, reporting payment_status 'unpaid'. Recording one of those as a
      // paid sale would open a promise for money that never arrived and then
      // report it as an overdue paid delivery. The async event is what says it
      // finally settled.
      const settled = type === 'checkout.session.async_payment_succeeded'
        || (type === 'checkout.session.completed' && obj.payment_status !== 'unpaid');

      if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
        const sessionId = String(obj.id ?? '');
        if (!sessionId) return;
        const email = String(obj.customer_details?.email ?? obj.customer_email ?? '') || null;
        const kind = String(meta.kind ?? (obj.mode === 'subscription' ? 'subscription' : 'one_off'));
        const amount = Number.isFinite(rawAmount) ? rawAmount : null;
        const currency = String(obj.currency ?? '');
        const status = settled ? (kind === 'video-order' ? 'paid_awaiting_assets' : 'paid') : 'awaiting_payment';
        // NO render job is created here, deliberately. A video job needs a
        // payload.workflowId, and that workflow cannot exist yet: it is built by
        // order intake from the photo the buyer has not sent us. The order is
        // recorded as paid-and-awaiting-assets instead; fulfilment starts when
        // the asset arrives, and job_id is linked then.
        //
        // Only a PENDING order may be advanced. A redelivered event must not
        // rewind a status the intake path has already moved on from.
        run(`INSERT INTO billing_orders(session_id,kind,email,customer,amount,currency,status,job_id,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,NULL,?,?)
             ON CONFLICT(session_id) DO UPDATE SET
               status=CASE WHEN billing_orders.status='awaiting_payment' THEN excluded.status
                           ELSE billing_orders.status END,
               updated_at=excluded.updated_at`,
          sessionId, kind, email, String(obj.customer ?? '') || null, amount, currency, status, now(), now());
        out.order = { sessionId, kind, email, amount, currency, jobId: null, settled };
        // Only a SETTLED one-off sale opens a promise. Recurring access is not a
        // one-shot deliverable: opening a receipt per subscription would put
        // every subscriber permanently in the overdue list and destroy the
        // signal the gap exists to provide.
        if (settled && kind !== 'subscription') {
          const promised = String(meta.deliverable ?? (kind === 'video-order'
            ? 'AI product b-roll video built from the buyer-supplied product photo'
            : 'purchased deliverable'));
          out.delivery = openDeliveryReceipt({
            operationId: `session:${sessionId}`, sessionId, kind, promisedArtifact: promised });
        }
        if (obj.subscription) {
          // Do not stamp a fresh 'active' over a lifecycle already on record: a
          // delayed checkout completing after a cancellation must not revive it.
          const known = get('SELECT status FROM billing_subscriptions WHERE subscription_id=?', String(obj.subscription));
          upsertSubscription(String(obj.subscription), obj.customer, email, meta.plan, known?.status ?? 'active');
        }
      } else if (type.startsWith('customer.subscription.')) {
        const subscriptionId = String(obj.id ?? '');
        if (subscriptionId) {
          const incoming = String(obj.status ?? 'unknown');
          const current = get('SELECT status FROM billing_subscriptions WHERE subscription_id=?', subscriptionId)?.status;
          // Stripe does not guarantee event ordering, so a delayed 'active' can
          // arrive after a cancellation. Cancellation is terminal for a given
          // subscription id; a genuine reactivation comes back as a new one.
          const terminal = current === 'canceled' || current === 'incomplete_expired';
          const status = terminal && incoming !== 'canceled' ? current : incoming;
          upsertSubscription(subscriptionId, obj.customer, obj.customer_email ?? null, meta.plan, status);
          out.subscription = { subscriptionId, status };
        }
      }

      event('billing_event', { type, eventId: id, order: out.order, subscription: out.subscription });
    });
    return out;
  }

  function billingSummary() {
    if (!configured || closed) return { configured: false, orders: 0, activeSubscriptions: 0, recent: [] };
    return {
      configured: true,
      orders: get('SELECT COUNT(*) AS n FROM billing_orders').n,
      activeSubscriptions: get("SELECT COUNT(*) AS n FROM billing_subscriptions WHERE status='active'").n,
      // Deliberately no customer email here: this rides in the owner snapshot,
      // and there is no reason to spray personal data through it.
      recent: all(`SELECT session_id, kind, amount, currency, status, job_id, created_at
                   FROM billing_orders ORDER BY created_at DESC LIMIT 10`),
    };
  }
  // ----------------------------------------------------------------
  // DELIVERY ATTESTATION
  // ----------------------------------------------------------------
  // Recording that a payment ARRIVED is only half the job. An operator who
  // watches payment volume sees "18 confirmed transactions" and never notices
  // that zero artifacts were produced -- the whole failure lives in the gap
  // between payment accepted and work delivered. Settlement proves the money
  // moved; it proves nothing about the thing that was sold.
  //
  // So every paid order opens a receipt naming what was promised and by when,
  // and reconciliation counts the gap by operation id. Two deliberate rules:
  // a receipt is never marked delivered without an evidence locator (an
  // unverifiable claim of delivery is worth exactly as much as no claim), and
  // deadlines are evaluated on READ, so a stalled order surfaces without a
  // background timer anyone has to remember to keep alive.

  function receiptView(row) {
    if (!row) return null;
    return { operationId: row.operation_id, sessionId: row.session_id, kind: row.kind,
      promisedArtifact: row.promised_artifact, state: row.state,
      evidenceLocator: row.evidence_locator, artifactSha256: row.artifact_sha256,
      jobId: row.job_id,
      deadlineAt: row.deadline_at, createdAt: row.created_at, updatedAt: row.updated_at,
      deliveredAt: row.delivered_at };
  }

  function openDeliveryReceipt({ operationId, sessionId, kind, promisedArtifact, deadlineAt = null }) {
    if (!configured || closed) return null;
    const id = String(operationId ?? '');
    if (!id) return null;
    const existing = get('SELECT * FROM delivery_receipts WHERE operation_id=?', id);
    if (existing) return receiptView(existing);
    run(`INSERT INTO delivery_receipts(operation_id,session_id,kind,promised_artifact,state,
             evidence_locator,artifact_sha256,deadline_at,created_at,updated_at,delivered_at)
         VALUES(?,?,?,?,'awaiting_assets',NULL,NULL,?,?,?,NULL)`,
      id, sessionId ? String(sessionId) : null, String(kind ?? 'order'),
      String(promisedArtifact ?? 'unspecified deliverable'),
      Number.isFinite(deadlineAt) ? deadlineAt : now() + DELIVERY_DEADLINE_MS, now(), now());
    event('delivery_opened', { operationId: id, kind: kind ?? null, sessionId: sessionId ?? null });
    return receiptView(get('SELECT * FROM delivery_receipts WHERE operation_id=?', id));
  }

  // Which render is meant to satisfy this order. Without the link a receipt can
  // only ever age: there would be nothing for a completed job to reconcile
  // against, which is the original blindness wearing a different hat.
  function linkDeliveryJob(operationId, jobId) {
    if (!configured || closed) return { linked: false, reason: 'unconfigured' };
    const id = String(operationId ?? ''), job = String(jobId ?? '');
    const row = get('SELECT * FROM delivery_receipts WHERE operation_id=?', id);
    if (!row) return { linked: false, reason: 'unknown_operation' };
    if (!job || !get('SELECT id FROM orchestration_jobs WHERE id=?', job)) return { linked: false, reason: 'unknown_job' };
    // Refuse to repoint a promise at different work: silently swapping what an
    // order is measured against is how a gap gets made to look closed. The one
    // exception is a REJECTED attempt -- the operator has explicitly said that
    // artifact is not acceptable, and trapping the order on it would make the
    // promise impossible to ever honour.
    if (row.job_id && row.job_id !== job) {
      const rejected = get(`SELECT 1 AS ok FROM orchestration_approvals WHERE job_id=? AND decision='rejected'`, row.job_id);
      const approved = get(`SELECT 1 AS ok FROM orchestration_approvals WHERE job_id=? AND decision='approved'`, row.job_id);
      if (!rejected || approved) return { linked: false, reason: 'already_linked' };
    }
    // ...and refuse to point a SECOND promise at the same job, which would
    // strand one of them (approval discharges only the first it finds).
    const bound = get('SELECT operation_id FROM delivery_receipts WHERE job_id=?', job);
    if (bound && bound.operation_id !== id) return { linked: false, reason: 'job_already_linked' };
    run('UPDATE delivery_receipts SET job_id=?, updated_at=? WHERE operation_id=?', job, now(), id);
    event('delivery_linked', { operationId: id, jobId: job });
    return { linked: true, receipt: receiptView(get('SELECT * FROM delivery_receipts WHERE operation_id=?', id)) };
  }

  // Discharging a promise requires PROOF bound to this specific order. A
  // nonempty string is not proof: `claimDelivery(op, {evidenceLocator:'x'})`
  // used to clear the gap with no job, no artifact and no approval attached --
  // which is the original failure wearing a receipt. The evidence must be a
  // persisted artifact of the LINKED job, one a human APPROVED, and the FINAL
  // deliverable rather than an intermediate. That last clause matters because
  // the worker registers both the generated latent and the rendered video, and
  // approving the latent is not what the buyer paid for.
  function claimDelivery(operationId, value = {}) {
    if (!configured || closed) return { claimed: false, reason: 'unconfigured' };
    const id = String(operationId ?? '');
    const row = get('SELECT * FROM delivery_receipts WHERE operation_id=?', id);
    if (!row) return { claimed: false, reason: 'unknown_operation' };
    // Idempotent: a replayed webhook or a retried caller cannot double-deliver.
    if (row.state === 'delivered') return { claimed: false, duplicate: true, receipt: receiptView(row) };
    const locator = typeof value.evidenceLocator === 'string' ? value.evidenceLocator.trim() : '';
    if (!locator) return { claimed: false, reason: 'evidence_required' };
    // A locator has to actually LOCATE the thing: a scheme-qualified URI or a
    // content-addressed digest. A placeholder like 'x' names nothing, so it is
    // rejected as input before any state is consulted.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(locator)) return { claimed: false, reason: 'invalid_locator' };
    const sha = typeof value.sha256 === 'string' ? value.sha256 : '';
    if (!/^[a-f0-9]{64}$/.test(sha)) return { claimed: false, reason: 'invalid_digest' };
    if (!row.job_id) return { claimed: false, reason: 'no_linked_job' };
    const artifact = get(`SELECT a.media_type AS mediaType FROM orchestration_artifacts a
                          JOIN orchestration_job_artifacts j ON a.sha256=j.sha256
                          WHERE j.job_id=? AND a.sha256=?`, row.job_id, sha);
    if (!artifact) return { claimed: false, reason: 'unknown_artifact' };
    const approved = get(`SELECT 1 AS ok FROM orchestration_approvals
                          WHERE job_id=? AND artifact_sha256=? AND decision='approved'`, row.job_id, sha);
    if (!approved) return { claimed: false, reason: 'artifact_not_approved' };
    const wantsVideo = row.kind === 'video-order' || row.kind === 'video';
    if (wantsVideo && !String(artifact.mediaType || '').startsWith('video/')) {
      return { claimed: false, reason: 'not_final_deliverable' };
    }
    run(`UPDATE delivery_receipts SET state='delivered', evidence_locator=?, artifact_sha256=?,
             delivered_at=?, updated_at=? WHERE operation_id=?`,
      locator.slice(0, 2000), sha, now(), now(), id);
    event('delivery_claimed', { operationId: id, evidenceLocator: locator.slice(0, 2000), sha256: sha });
    return { claimed: true, receipt: receiptView(get('SELECT * FROM delivery_receipts WHERE operation_id=?', id)) };
  }

  // Visual approval means the work is acceptable and ready to hand over. It is
  // NOT evidence the buyer received anything, so it advances the receipt to
  // 'ready' and stops there. Only an explicit handoff discharges a promise.
  function markDeliveryReady(operationId) {
    if (!configured || closed) return null;
    const row = get('SELECT * FROM delivery_receipts WHERE operation_id=?', String(operationId ?? ''));
    if (!row || row.state === 'delivered') return receiptView(row);
    run("UPDATE delivery_receipts SET state='ready', updated_at=? WHERE operation_id=?", now(), row.operation_id);
    event('delivery_ready', { operationId: row.operation_id });
    return receiptView(get('SELECT * FROM delivery_receipts WHERE operation_id=?', row.operation_id));
  }

  // Intentionally NOT wrapped in transaction(): snapshot() already holds one, and
  // a nested BEGIN throws. The UPDATE is a single atomic statement anyway.
  function reconcileDeliveries(at = now()) {
    if (!configured || closed) return { configured: false };
    run(`UPDATE delivery_receipts SET state='overdue', updated_at=?
         WHERE state IN ('awaiting_assets','in_production') AND deadline_at<=?`, at, at);
    const counts = {};
    for (const row of all('SELECT state, COUNT(*) AS n FROM delivery_receipts GROUP BY state')) counts[row.state] = row.n;
    return counts;
  }

  // The number that matters: paid minus delivered. Counting payments alone is how
  // an operator can take 18 of them, publish nothing, and not find out for days.
  function deliveryLedger() {
    if (!configured || closed) {
      return { configured: false, paid: 0, delivered: 0, undelivered: 0, unreceipted: 0, overdue: 0, states: {}, gap: [] };
    }
    // Counted from RECEIPTS, not as `paid - delivered`. Those are two different
    // populations (orders vs promises), so subtracting them lets the ledger
    // report a gap of zero while unreceipted orders rot, or go negative.
    const undelivered = get("SELECT COUNT(*) AS n FROM delivery_receipts WHERE state<>'delivered'").n;
    const paid = get('SELECT COUNT(*) AS n FROM billing_orders').n;
    // Orders with no promise at all. Reported explicitly instead of folded into
    // the arithmetic, so the two sources can never silently disagree.
    const unreceipted = get(`SELECT COUNT(*) AS n FROM billing_orders o
                             WHERE NOT EXISTS (SELECT 1 FROM delivery_receipts r
                                               WHERE r.session_id=o.session_id)`).n;
    // Runs the read-time deadline promotion, so overdue is a fact on read.
    const states = reconcileDeliveries();
    const delivered = states.delivered ?? 0;
    const gap = all(`SELECT operation_id AS operationId, session_id AS sessionId, kind,
                            promised_artifact AS promisedArtifact, state,
                            deadline_at AS deadlineAt, created_at AS createdAt
                     FROM delivery_receipts WHERE state<>'delivered'
                     ORDER BY deadline_at ASC LIMIT 50`);
    return { configured: true, paid, delivered, undelivered, unreceipted,
             overdue: states.overdue ?? 0, states, gap };
  }

  const rawJob = id => get('SELECT * FROM orchestration_jobs WHERE id=?', id);
  function quarantine(job, reason, hardware = false) {
    run('UPDATE orchestration_jobs SET status=?,error=?,lease_token=NULL,lease_expires=NULL,updated_at=? WHERE id=?', 'paused', reason, now(), job.id);
    run('UPDATE orchestration_control SET quarantine=1,quarantine_worker=?,reason=?,hardware=MAX(hardware,?) WHERE id=1', job.worker, reason, hardware ? 1 : 0);
    cold();
    event('gpu_quarantined', { jobId: job.id, worker: job.worker, reason, hardware });
  }
  function cold({ stopped = false } = {}) {
    run('UPDATE orchestration_control SET warm_required=1,resident_worker=CASE WHEN ? THEN NULL ELSE resident_worker END WHERE id=1', stopped ? 1 : 0);
    const pointer = get('SELECT warmup_job_id FROM orchestration_control WHERE id=1').warmup_job_id;
    if (pointer && rawJob(pointer)?.status === 'ready-for-review') run('UPDATE orchestration_control SET warmup_job_id=NULL WHERE id=1');
  }
  function ensureWarmup() {
    if (!env.GPU_INFERENCE_MODEL || !get('SELECT warm_required FROM orchestration_control WHERE id=1').warm_required) return;
    // Demand starts one durable warmup. Once started it survives a short web
    // health timeout; an empty idle queue must never reload models in a loop.
    if (!get("SELECT id FROM orchestration_jobs WHERE status='queued' AND kind='inference' AND warmup=0 LIMIT 1")) return;
    const pointer = get('SELECT warmup_job_id FROM orchestration_control WHERE id=1').warmup_job_id;
    // A failed/paused warmup stays visible for explicit owner recovery; polling
    // never starts a fresh batch after the three transport attempts are spent.
    if (pointer && rawJob(pointer)?.status !== 'ready-for-review') return;
    const created = submit({ idempotencyKey: `warmup:${randomUUID()}`, kind: 'inference', payload: { operation: 'models', body: null } }, now() + WARMUP_DEADLINE_MS, true);
    run('UPDATE orchestration_control SET warmup_job_id=? WHERE id=1', created.job.id);
  }
  function reap() {
    const active = get('SELECT * FROM orchestration_jobs WHERE lease_token IS NOT NULL');
    if (active && (active.lease_expires <= now() || (active.deadline !== null && active.deadline <= now()))) quarantine(active, active.deadline !== null && active.deadline <= now() ? 'request_deadline' : 'lease_expired');
    run("UPDATE orchestration_jobs SET status='failed',error='request_deadline',updated_at=? WHERE status='queued' AND deadline IS NOT NULL AND deadline<=?", now(), now());
  }
  function jobView(row, includeLease = false) {
    if (!row) return null;
    const artifacts = all('SELECT a.sha256,a.uri,a.bytes,a.media_type AS mediaType FROM orchestration_artifacts a JOIN orchestration_job_artifacts j ON a.sha256=j.sha256 WHERE j.job_id=? ORDER BY a.sha256', row.id);
    const job = { id: row.id, kind: row.kind, payload: parse(row.payload), status: row.status, stage: row.stage,
      checkpoint: parse(row.checkpoint), result: parse(row.result), error: row.error, attempts: row.attempts,
      createdAt: row.created_at, updatedAt: row.updated_at, internalWarmup: !!row.warmup, artifacts,
      checkpoints: all('SELECT sequence,stage,checkpoint,created_at AS createdAt FROM orchestration_checkpoints WHERE job_id=? ORDER BY sequence', row.id).map(c => ({ ...c, checkpoint: parse(c.checkpoint) })) };
    if (includeLease) job.lease = { token: row.lease_token, expiresAt: row.lease_expires };
    return job;
  }
  function snapshot() {
    if (!configured || closed) return { enabled, configured: configured && !closed, jobs: [], approvals: [], control: { paused: true, kill: false, hardwarePaused: false, gpuQuarantined: true, externalExecution: false, reason: 'orchestration_unavailable' } };
    return transaction(() => {
      reap();
      const state = { enabled, configured,
        // Orders/subscriptions ride along with the owner status, so the ops view
        // can show money that actually came in rather than only jobs that ran.
        billing: billingSummary(),
        // Paid vs delivered, so the ops view can show the GAP rather than only
        // the money that came in. A payment count with no delivery count is the
        // blind spot that lets orders be taken and silently never fulfilled.
        deliveries: deliveryLedger(),
        jobs: all('SELECT * FROM orchestration_jobs ORDER BY created_at DESC,rowid DESC LIMIT 200').map(row => jobView(row)),
        control: control(),
        workerContacts: all('SELECT worker AS workerId,last_seen_at AS lastSeenAt FROM orchestration_worker_contacts ORDER BY last_seen_at DESC'),
        metrics: {
          source: 'persisted_jobs', scope: 'all_retained_jobs_excluding_internal_warmups',
          readyForReview: get("SELECT COUNT(*) AS n FROM orchestration_jobs WHERE status='ready-for-review' AND warmup=0").n,
          failed: get("SELECT COUNT(*) AS n FROM orchestration_jobs WHERE status='failed' AND warmup=0").n,
        },
        approvals: all('SELECT id,job_id AS jobId,category,decision,artifact_sha256 AS artifactSha256,note,created_at AS createdAt FROM orchestration_approvals ORDER BY created_at DESC,rowid DESC LIMIT 1000'),
      };
      // No operator evidence is inferred from environment flags or successful polls.
      return { ...state, readiness: assessReadiness(state, {}, now()) };
    });
  }
  function submit(value, deadline = null, warmup = false) {
    if (typeof value.idempotencyKey !== 'string' || !/^[\w.:-]{1,128}$/.test(value.idempotencyKey)) error('invalid_idempotency_key');
    if (!['video', 'research', 'inference'].includes(value.kind) || !object(value.payload)) error('invalid_job');
    if (value.kind === 'video' && (typeof value.payload.workflowId !== 'string' || !/^[\w.-]{1,80}$/.test(value.payload.workflowId))) error('workflow_id_required');
    if (value.kind === 'research') validateResearch(value.payload);
    if (value.kind === 'inference' && !['models', 'chat/completions'].includes(value.payload.operation)) error('operation_not_allowed');
    const payload = json(stable(value.payload));
    if (Buffer.byteLength(payload) > MAX_BODY - 1024) error('body_too_large', 413);
    const existing = get('SELECT * FROM orchestration_jobs WHERE idempotency_key=?', value.idempotencyKey);
    if (existing) { if (existing.kind !== value.kind || existing.payload !== payload) error('idempotency_conflict', 409); return { job: jobView(existing), duplicate: true }; }
    if (get("SELECT COUNT(*) AS n FROM orchestration_jobs WHERE status IN ('queued','generating','decoding','paused')").n >= MAX_PENDING) error('queue_full', 429);
    const id = randomUUID();
    run('INSERT INTO orchestration_jobs(id,idempotency_key,kind,payload,status,created_at,updated_at,deadline,warmup) VALUES(?,?,?,?,?,?,?,?,?)', id, value.idempotencyKey, value.kind, payload, 'queued', now(), now(), deadline, warmup ? 1 : 0);
    event('job_submitted', { jobId: id, kind: value.kind }); return { job: jobView(rawJob(id)), duplicate: false };
  }
  function requireLease(id, token, worker) {
    const row = rawJob(id), state = control();
    if (!row || !activeStatuses.has(row.status) || !row.lease_token || typeof token !== 'string' || row.lease_token !== token || row.worker !== worker || row.lease_expires <= now() || state.kill || state.hardwarePaused || state.gpuQuarantined) error('lease_fenced', 409);
    return row;
  }
  function validateArtifact(a) {
    if (!object(a) || !/^[a-f0-9]{64}$/.test(a.sha256) || a.uri !== `sha256:${a.sha256}`
      || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || typeof a.mediaType !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(a.mediaType)) error('invalid_artifact');
  }
  function ownerAction(method, path, value) {
    if (method === 'GET' && path === '/status') return { status: 200, body: snapshot() };
    if (method === 'GET' && path === '/billing') return { status: 200, body: billingSummary() };
    return transaction(() => {
      reap();
      // Indoors on purpose: deliveryLedger() promotes overdue deadlines, which is
      // a write. In autocommit that write can collide with the worker's
      // BEGIN IMMEDIATE and fail an owner status read.
      if (method === 'GET' && path === '/deliveries') return { status: 200, body: deliveryLedger() };
      if (method === 'GET' && path === '/deliveries/gap') return { status: 200, body: deliveryLedger().gap };
      if (method === 'POST' && path === '/deliveries/link') {
        const linked = linkDeliveryJob(value?.operationId, value?.jobId);
        return { status: linked.linked ? 200 : 400, body: linked };
      }
      // The handoff: the one place a promise can be discharged, and only with an
      // approved final artifact from the linked job as evidence.
      if (method === 'POST' && path === '/deliveries/handoff') {
        const claimed = claimDelivery(value?.operationId, {
          evidenceLocator: value?.evidenceLocator, sha256: value?.sha256 });
        return { status: claimed.claimed || claimed.duplicate ? 200 : 400, body: claimed };
      }
      // The studio contract: same shape as upstream's POST /{model} +
      // GET /requests/{id}/status, served by OUR plane. These live on the owner
      // surface so they inherit the existing credential check -- no new auth.
      if (method === 'GET' && path === '/studio/models') {
        return { status: 200, body: { models: availability(process.env) } };
      }
      if (method === 'GET' && path.startsWith('/studio/requests/')) {
        const requestId = decodeURIComponent(path.slice('/studio/requests/'.length));
        const found = requestId ? get('SELECT * FROM orchestration_jobs WHERE id=?', requestId) : null;
        const result = readRequest(requestId, {
          find: () => found && {
            id: found.id, model: found.kind, status: found.status,
            artifacts: parse(found.artifacts) || [],
          },
        });
        return { status: result.status, body: result.body };
      }
      if (method === 'POST' && path.startsWith('/studio/')) {
        // env comes from process.env, so an unpinned workflow refuses (503) here
        // rather than being asserted available somewhere else in the stack.
        const modelId = decodeURIComponent(path.slice('/studio/'.length));
        const result = submitGeneration(modelId, value || {}, { env: process.env, submit });
        return { status: result.status, body: result.body };
      }
      if (method === 'POST' && path === '/jobs') { const result = submit(value); return { status: result.duplicate ? 200 : 201, body: result }; }
      if (method === 'POST' && path === '/control') {
        const reason = typeof value.reason === 'string' ? value.reason.slice(0, 1000) : '';
        if (value.action === 'pause') run('UPDATE orchestration_control SET paused=1,reason=? WHERE id=1', reason || 'owner_pause');
        else if (value.action === 'kill') {
          const job = get('SELECT * FROM orchestration_jobs WHERE lease_token IS NOT NULL');
          if (job) quarantine(job, 'owner_kill');
          else {
            const resident = get('SELECT resident_worker FROM orchestration_control WHERE id=1').resident_worker;
            if (resident) {
              run("UPDATE orchestration_control SET quarantine=1,quarantine_worker=?,reason='owner_kill' WHERE id=1", resident);
              cold();
            }
          }
          run('UPDATE orchestration_control SET paused=1,killed=1,reason=? WHERE id=1', reason || 'owner_kill');
        } else if (value.action === 'resume') {
          const state = control(); if (state.hardwarePaused || state.gpuQuarantined) error('clearance_required', 409);
          run("UPDATE orchestration_control SET paused=0,killed=0,reason='' WHERE id=1");
        } else if (value.action === 'clear-hardware') {
          if (reason.trim().length < 8) error('clearance_reason_required');
          if (get('SELECT id FROM orchestration_jobs WHERE lease_token IS NOT NULL')) error('active_lease', 409);
          run('UPDATE orchestration_control SET hardware=0,quarantine=0,quarantine_worker=NULL,resident_worker=NULL,paused=1,reason=? WHERE id=1', reason);
          cold({ stopped: true });
        } else error('action_not_allowed');
        event('owner_control', { action: value.action, reason }); return { status: 200, body: { control: control() } };
      }
      const match = /^\/jobs\/([0-9a-f-]{36})\/(resume|cancel|approvals)$/.exec(path);
      if (method !== 'POST' || !match) error('not_found', 404);
      const job = rawJob(match[1]); if (!job) error('job_not_found', 404);
      // Retiring superseded work. A queued job whose output already exists -- a
      // re-submission, or a clip superseded by a higher-quality re-render -- is
      // otherwise immortal: no other route can remove it, so it is rendered
      // again at full GPU cost the moment a worker returns. Only a job that has
      // NOT started may be cancelled; retracting work under a lease would race
      // the worker running it, and a job that already ran belongs in the
      // failed/ready history rather than being quietly erased.
      if (match[2] === 'cancel') {
        if (job.lease_token || job.status !== 'queued') error('job_not_cancellable', 409);
        if (typeof value?.reason !== 'string' || value.reason.trim().length < 8) error('cancel_reason_required');
        const reason = value.reason.slice(0, 1000);
        run("UPDATE orchestration_jobs SET status='cancelled',error=?,updated_at=? WHERE id=?", 'cancelled: ' + reason, now(), job.id);
        event('job_cancelled', { jobId: job.id, reason });
        return { status: 200, body: { cancelled: true, job: jobView(rawJob(job.id)) } };
      }
      if (match[2] === 'resume') {
        const state = control(); if (state.hardwarePaused || state.gpuQuarantined || state.kill) error('clearance_required', 409);
        if (!['paused', 'failed'].includes(job.status) || (job.kind === 'inference' && !job.warmup)) error('job_not_resumable', 409);
        run("UPDATE orchestration_jobs SET status='queued',error=NULL,attempts=0,deadline=?,updated_at=? WHERE id=?", job.warmup ? now() + WARMUP_DEADLINE_MS : null, now(), job.id);
        event('owner_resume', { jobId: job.id }); return { status: 200, body: { job: jobView(rawJob(job.id)) } };
      }
      if (job.status !== 'ready-for-review' || !['visual', 'outreach', 'publication', 'spend'].includes(value.category)
        || !['approved', 'rejected'].includes(value.decision) || typeof value.artifactSha256 !== 'string'
        || !get('SELECT 1 FROM orchestration_job_artifacts WHERE job_id=? AND sha256=?', job.id, value.artifactSha256)) error('invalid_approval');
      if (value.category === 'visual' && job.kind !== 'video') error('visual_requires_video');
      if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 2000)) error('invalid_note');
      const approval = { id: randomUUID(), jobId: job.id, category: value.category, decision: value.decision, artifactSha256: value.artifactSha256, note: value.note || '', createdAt: now() };
      run('INSERT INTO orchestration_approvals(id,job_id,category,decision,artifact_sha256,note,created_at) VALUES(?,?,?,?,?,?,?)', approval.id, job.id, approval.category, approval.decision, approval.artifactSha256, approval.note, approval.createdAt);
      // Visual approval marks the work READY; it deliberately does NOT discharge
      // the promise. Clearing internal review is not evidence that the buyer
      // received anything, and conflating the two let one internal step silently
      // close the gap. Only an explicit handoff (POST /deliveries/handoff with
      // the approved artifact) can do that. Jobs with no linked receipt
      // (internal renders, evolution candidates) are untouched.
      if (value.decision === 'approved' && value.category === 'visual') {
        const receipt = get('SELECT * FROM delivery_receipts WHERE job_id=?', job.id);
        if (receipt) approval.delivery = markDeliveryReady(receipt.operation_id);
      }
      return { status: 201, body: { approval, externalExecution: false } };
    });
  }
  function workerAction(method, path, value, worker, query = new URLSearchParams()) {
    return transaction(() => {
      reap();
      if (method === 'GET' && path === '/next') {
        const state = control();
        if (state.paused || state.kill || state.hardwarePaused || state.gpuQuarantined || get('SELECT id FROM orchestration_jobs WHERE lease_token IS NOT NULL')) return { job: null, control: state };
        const resident = get('SELECT resident_worker FROM orchestration_control WHERE id=1').resident_worker;
        if (resident && resident !== worker) return { job: null, control: state };
        if (!get("SELECT id FROM orchestration_jobs WHERE status='queued' AND kind IN ('video','research') LIMIT 1")) ensureWarmup();
        // A worker may declare the KIND it can actually perform. Without this a
        // worker with no GPU is always offered the first VIDEO job and can never
        // reach the research work it is able to do, so the queue stays blocked
        // on the one machine that happens to be holding the video lease.
        const only = query.get('kind') || '';
        if (only && !['video', 'research', 'inference'].includes(only)) error('invalid_kind_filter');
        const row = get("SELECT * FROM orchestration_jobs WHERE status='queued' AND (?='' OR kind=?) ORDER BY CASE WHEN kind='video' THEN 0 WHEN kind='research' THEN 1 WHEN warmup=1 THEN 2 ELSE 3 END,created_at,rowid LIMIT 1", only, only);
        if (!row) return { job: null, control: state };
        const warming = get('SELECT warm_required,warmup_job_id FROM orchestration_control WHERE id=1');
        if (env.GPU_INFERENCE_MODEL && warming.warm_required && row.kind === 'inference' && !row.warmup
          && ['failed', 'paused'].includes(rawJob(warming.warmup_job_id)?.status)) return { job: null, control: { ...state, reason: state.reason || 'warmup_recovery_required' } };
        if (['video', 'research'].includes(row.kind)) {
          // A long render must not consume the warmup deadline while it waits.
          run("UPDATE orchestration_jobs SET status='failed',error='warmup_deferred',updated_at=? WHERE warmup=1 AND status='queued'", now());
          run('UPDATE orchestration_control SET warmup_job_id=NULL WHERE id=1');
        }
        run('UPDATE orchestration_control SET fence=fence+1 WHERE id=1');
        const token = `${get('SELECT fence FROM orchestration_control WHERE id=1').fence}:${randomUUID()}`;
        const expires = Math.min(now() + leaseMs, row.deadline ?? Number.MAX_SAFE_INTEGER);
        run('UPDATE orchestration_jobs SET status=stage,attempts=attempts+1,lease_token=?,lease_expires=?,worker=?,updated_at=? WHERE id=?', token, expires, worker, now(), row.id);
        event('lease_granted', { jobId: row.id, worker, fence: token.split(':')[0] });
        return { job: jobView(rawJob(row.id), true), control: state };
      }
      if (method === 'POST' && path === '/reconcile') {
        if (value.quiescent !== true || typeof value.reason !== 'string' || !value.reason.trim()) error('quiescence_required');
        if (get('SELECT id FROM orchestration_jobs WHERE lease_token IS NOT NULL')) error('active_lease', 409);
        const state = get('SELECT * FROM orchestration_control WHERE id=1');
        if ((state.quarantine_worker && state.quarantine_worker !== worker) || (state.resident_worker && state.resident_worker !== worker)) error('worker_mismatch', 409);
        for (const job of all("SELECT id FROM orchestration_jobs WHERE kind='inference' AND warmup=0 AND status='paused' AND worker=?", worker)) {
          run("UPDATE orchestration_jobs SET status='failed',updated_at=? WHERE id=?", now(), job.id);
          event('inference_abandoned', { jobId: job.id, worker, reason: value.reason.slice(0, 1000) });
        }
        if (!state.hardware) {
          run("UPDATE orchestration_control SET quarantine=0,quarantine_worker=NULL,reason=CASE WHEN paused=1 THEN reason ELSE '' END WHERE id=1");
          cold({ stopped: true });
        }
        event('worker_quiescent', { worker, reason: value.reason.slice(0, 1000) }); return { reconciled: !state.hardware, control: control() };
      }
      if (method === 'POST' && path === '/fault') {
        if (value.category !== 'hardware' || typeof value.message !== 'string' || !value.message.trim() || typeof value.quiescent !== 'boolean') error('invalid_hardware_fault');
        const state = get('SELECT * FROM orchestration_control WHERE id=1');
        const job = get('SELECT * FROM orchestration_jobs WHERE lease_token IS NOT NULL');
        if ([state.resident_worker, state.quarantine_worker, job?.worker].some(identity => identity && identity !== worker)) error('worker_mismatch', 409);
        const reason = value.message.slice(0, 2000);
        if (job) quarantine(job, reason, true);
        run('UPDATE orchestration_control SET hardware=1,quarantine=1,quarantine_worker=?,reason=? WHERE id=1', worker, reason);
        cold({ stopped: value.quiescent });
        event('worker_hardware_fault', { worker, reason, quiescent: value.quiescent });
        return { accepted: true, control: control() };
      }
      const match = /^\/jobs\/([0-9a-f-]{36})\/(heartbeat|checkpoint|complete|fail)$/.exec(path);
      if (method !== 'POST' || !match) error('not_found', 404);
      const job = requireLease(match[1], value.token, worker);
      if (match[2] === 'heartbeat') {
        const expires = Math.min(now() + leaseMs, job.deadline ?? Number.MAX_SAFE_INTEGER);
        run('UPDATE orchestration_jobs SET lease_expires=?,updated_at=? WHERE id=?', expires, now(), job.id);
        return { active: true, lease: { token: job.lease_token, expiresAt: expires }, control: control() };
      }
      if (match[2] === 'checkpoint') {
        if (!['generating', 'decoding'].includes(value.stage) || !object(value.checkpoint)) error('invalid_checkpoint');
        if (job.stage === 'decoding' && value.stage !== 'decoding') error('stage_regression', 409);
        run('INSERT INTO orchestration_checkpoints(job_id,stage,checkpoint,created_at,fence) VALUES(?,?,?,?,?)', job.id, value.stage, json(value.checkpoint), now(), job.lease_token);
        run('UPDATE orchestration_jobs SET checkpoint=?,stage=?,status=?,updated_at=? WHERE id=?', json(value.checkpoint), value.stage, value.stage, now(), job.id);
        return { accepted: true, control: control() };
      }
      if (match[2] === 'complete') {
        const resident = value.idleResident === true && value.quiescent === false && ['inference', 'research'].includes(job.kind);
        if (!(value.quiescent === true && value.idleResident !== true) && !resident) error('completion_quiescence_required');
        if (job.warmup && !resident) error('warmup_requires_idle_resident');
        if (!object(value.result) || !Array.isArray(value.artifacts) || value.artifacts.length > 32) error('invalid_completion');
        if (job.kind !== 'inference' && value.artifacts.length === 0) error('artifact_required');
        if (job.kind === 'inference' && (!Number.isInteger(value.result.status) || (value.result.status !== 200 && (value.result.status < 400 || value.result.status > 599)) || !object(value.result.body))) error('invalid_inference_result');
        for (const artifact of value.artifacts) {
          validateArtifact(artifact);
          const existing = get('SELECT * FROM orchestration_artifacts WHERE sha256=? OR uri=?', artifact.sha256, artifact.uri);
          if (existing && (existing.sha256 !== artifact.sha256 || existing.uri !== artifact.uri || existing.bytes !== artifact.bytes || existing.media_type !== artifact.mediaType)) error('immutable_artifact_conflict', 409);
          run('INSERT OR IGNORE INTO orchestration_artifacts(sha256,uri,bytes,media_type) VALUES(?,?,?,?)', artifact.sha256, artifact.uri, artifact.bytes, artifact.mediaType);
          run('INSERT OR IGNORE INTO orchestration_job_artifacts(job_id,sha256) VALUES(?,?)', job.id, artifact.sha256);
        }
        run("UPDATE orchestration_jobs SET status='ready-for-review',result=?,lease_token=NULL,lease_expires=NULL,updated_at=? WHERE id=?", json(value.result), now(), job.id);
        run('UPDATE orchestration_control SET resident_worker=?,warm_required=? WHERE id=1', resident ? worker : null, resident ? 0 : 1);
        if (!resident) cold({ stopped: true });
        event('job_completed', { jobId: job.id, artifactCount: value.artifacts.length }); return { accepted: true, control: control() };
      }
      // Cancellation is terminal like invalid work; only transport opts into retries.
      if (!['transport', 'hardware', 'invalid', 'cancelled'].includes(value.category) || typeof value.message !== 'string' || !value.message.trim()) error('invalid_failure');
      const message = value.message.slice(0, 2000);
      // Hardware signatures dominate worker-provided classification: prompts cannot authorize retries.
      const hardware = value.category === 'hardware' || /NVML|CUDA|Xid\s*\d*|device (?:lost|disconnected)|fallen off the bus/i.test(message);
      if (hardware || value.quiescent !== true) quarantine(job, message, hardware);
      else {
        cold({ stopped: true });
        const status = value.category === 'transport' && job.attempts < MAX_ATTEMPTS ? 'queued' : 'failed';
        run('UPDATE orchestration_jobs SET status=?,error=?,lease_token=NULL,lease_expires=NULL,updated_at=? WHERE id=?', status, message, now(), job.id);
      }
      event('job_failed', { jobId: job.id, category: hardware ? 'hardware' : value.category, quiescent: value.quiescent === true }); return { accepted: true, control: control() };
    });
  }
  async function handle(surface, req, res) {
    if (!configured || closed) return reply(res, 503, { error: 'orchestration_unavailable' });
    if (!equalKey(req.headers.authorization, surface === 'owner' ? ownerKey : workerKey)) { res.setHeader('Connection', 'close'); return reply(res, 401, { error: 'unauthorized' }); }
    const worker = String(req.headers['x-brainsnn-worker'] || '');
    if (surface === 'worker' && !/^[a-zA-Z0-9_-]{8,80}$/.test(worker)) return reply(res, 400, { error: 'worker_id_required' });
    try {
      const value = req.method === 'POST' ? await readBody(req) : {};
      if (closed) error('orchestration_unavailable', 503);
      // Commit expiry before validating a mutation: a rejected stale heartbeat
      // must not roll the quarantine back together with the rejected write.
      transaction(reap);
      const [path, query] = req.url.split('?');
      const result = surface === 'owner' ? ownerAction(req.method, path, value)
        : { status: 200, body: workerAction(req.method, path, value, worker, new URLSearchParams(query || '')) };
      if (surface === 'worker') {
        // The worker action is already committed; advisory evidence cannot hide its result.
        try { run('INSERT INTO orchestration_worker_contacts(worker,last_seen_at) VALUES(?,?) ON CONFLICT(worker) DO UPDATE SET last_seen_at=excluded.last_seen_at', worker, now()); }
        catch { result.body.workerContact = { persisted: false, reason: 'contact_write_failed' }; }
      }
      reply(res, result.status, result.body);
    } catch (err) { reply(res, err.status || 500, { error: err.status ? err.message : 'orchestration_error' }); }
  }
  function request(operation, options = {}) {
    if (!configured || closed) return Promise.resolve(response({ error: 'orchestration_unavailable' }, 503));
    if (!['models', 'chat/completions'].includes(operation) || options.method !== (operation === 'models' ? 'GET' : 'POST')) return Promise.resolve(response({ error: 'operation_not_allowed' }, 400));
    if (options.signal?.aborted) return Promise.resolve(response({ error: 'cancelled' }, 504));
    let body = null, submitted;
    try {
      if (operation !== 'models') { if (typeof options.body !== 'string' || Buffer.byteLength(options.body) > MAX_BODY - 2048) error('invalid_body'); body = parse(options.body); if (!object(body)) error('invalid_body'); }
      transaction(reap);
      submitted = transaction(() => {
        const state = control(); if (state.paused || state.kill || state.hardwarePaused || state.gpuQuarantined) error('gpu_paused', 503);
        const warming = get('SELECT warm_required,warmup_job_id FROM orchestration_control WHERE id=1');
        if (env.GPU_INFERENCE_MODEL && warming.warm_required && ['failed', 'paused'].includes(rawJob(warming.warmup_job_id)?.status)) error('warmup_recovery_required', 503);
        if (get("SELECT COUNT(*) AS n FROM orchestration_jobs WHERE kind='inference' AND status IN ('queued','generating','decoding')").n >= 2) error('busy', 429);
        return submit({ idempotencyKey: `http:${randomUUID()}`, kind: 'inference', payload: { operation, body } }, now() + deadlineMs).job;
      });
    } catch (err) { return Promise.resolve(response({ error: err.status ? err.message : 'invalid_body' }, err.status || 400)); }
    return new Promise(resolve => {
      let finished = false, timer, poll;
      const finish = result => { if (finished) return; finished = true; clearTimeout(timer); clearInterval(poll); options.signal?.removeEventListener('abort', abort); pending.delete(stop); resolve(result); };
      const cancel = reason => {
        if (!closed) transaction(() => {
          const job = rawJob(submitted.id);
          if (job.lease_token) quarantine(job, reason);
          else if (job.status === 'queued') run("UPDATE orchestration_jobs SET status='failed',error=?,updated_at=? WHERE id=?", reason, now(), job.id);
        });
        finish(response({ error: reason }, 504));
      };
      const abort = () => cancel('cancelled');
      const stop = () => finish(response({ error: 'orchestration_stopped' }, 503));
      pending.add(stop); options.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => cancel('request_deadline'), deadlineMs);
      poll = setInterval(() => {
        if (closed) return stop();
        try {
          const row = rawJob(submitted.id);
          if (row.status === 'ready-for-review') { const result = parse(row.result); finish(response(result.body, result.status)); }
          else if (['failed', 'paused'].includes(row.status)) finish(response({ error: row.error || 'worker_failed' }, row.error === 'request_deadline' ? 504 : 503));
        } catch { finish(response({ error: 'orchestration_error' }, 503)); }
      }, responsePollMs);
      if (options.signal?.aborted) abort();
    });
  }
  function close() { if (closed) return; closed = true; for (const stop of [...pending]) stop(); db?.close(); }
  return { enabled, configured, handleOwner: (req, res) => handle('owner', req, res), handleWorker: (req, res) => handle('worker', req, res), request, snapshot, close, recordBillingEvent, billingSummary, openDeliveryReceipt, claimDelivery, linkDeliveryJob, deliveryLedger };
}
