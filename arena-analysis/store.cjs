'use strict';

const {DatabaseSync} = require('node:sqlite');
const {randomBytes, createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {QUOTE_TTL_MS} = require('./pricing.cjs');

const DAY = 86400000;
const SESSION_TTL = 30 * DAY;
const RESULT_TTL = 7 * DAY;
const id = prefix => `${prefix}_${randomBytes(18).toString('base64url')}`;
const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
function problem(code, message, status = 409) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function cents(value, name = 'amount') {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100000000) problem('INVALID_AMOUNT', `Invalid ${name}`, 400);
  return value;
}
function text(value, name, max = 250) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) problem('INVALID_INPUT', `Invalid ${name}`, 400);
  return value;
}
function digest(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) problem('INVALID_INPUT', 'Invalid evidence digest', 400);
  return value;
}

function createStore(options = {}) {
  const dbPath = text(options.dbPath, 'database path', 4096);
  const now = options.now || Date.now;
  const failureReserveCents = cents(options.failureReserveCents ?? 0, 'failure reserve');
  const maxOutstandingCostCents = cents(options.maxOutstandingCostCents ?? failureReserveCents, 'outstanding cost limit');
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), {recursive: true, mode: 0o700});
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ':memory:') fs.chmodSync(dbPath, 0o600);
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=FULL;
    PRAGMA secure_delete=ON;
    PRAGMA foreign_keys=ON;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS aa_workspaces (id TEXT PRIMARY KEY, recovery_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, frozen INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS aa_sessions (token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES aa_workspaces(id), csrf_token TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_payments (payment_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES aa_workspaces(id), amount_cents INTEGER NOT NULL, payment_fee_cents INTEGER NOT NULL, reversed_cents INTEGER NOT NULL DEFAULT 0, disputed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_payment_changes (payment_id TEXT PRIMARY KEY, reversed_cents INTEGER NOT NULL DEFAULT 0, disputed INTEGER NOT NULL DEFAULT 0, payment_fee_cents INTEGER);
    CREATE TABLE IF NOT EXISTS aa_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, digest TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_checkouts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES aa_workspaces(id), request_id TEXT NOT NULL, session_id TEXT UNIQUE, url TEXT, created_at INTEGER NOT NULL, UNIQUE(workspace_id, request_id));
    CREATE TABLE IF NOT EXISTS aa_quotes (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES aa_workspaces(id), input_digest TEXT NOT NULL, amount_cents INTEGER NOT NULL, max_cost_cents INTEGER NOT NULL, provider_cost_ceiling_cents INTEGER NOT NULL, fixed_cost_cents INTEGER NOT NULL, payment_fee_bps INTEGER NOT NULL, pricing_version TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_jobs (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE REFERENCES aa_quotes(id), workspace_id TEXT NOT NULL REFERENCES aa_workspaces(id), status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL, completed_at INTEGER, result TEXT, result_expires_at INTEGER, outstanding_cost_cents INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_allocations (job_id TEXT NOT NULL REFERENCES aa_jobs(id), payment_id TEXT NOT NULL REFERENCES aa_payments(payment_id), amount_cents INTEGER NOT NULL, PRIMARY KEY(job_id, payment_id));
    CREATE TABLE IF NOT EXISTS aa_ledger (id INTEGER PRIMARY KEY, entry_key TEXT NOT NULL UNIQUE, workspace_id TEXT REFERENCES aa_workspaces(id), kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, payment_id TEXT, job_id TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_expenses (job_id TEXT PRIMARY KEY REFERENCES aa_jobs(id), provider_cents INTEGER NOT NULL, fixed_cents INTEGER NOT NULL, failure INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS aa_admin_audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, subject TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS aa_jobs_workspace ON aa_jobs(workspace_id, created_at);
    CREATE INDEX IF NOT EXISTS aa_jobs_status ON aa_jobs(status);
    CREATE INDEX IF NOT EXISTS aa_ledger_workspace ON aa_ledger(workspace_id, created_at);
  `);

  // Additive migrations keep persisted pilot databases usable across releases.
  for (const table of ['aa_payments', 'aa_payment_changes']) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(column => column.name === 'additional_fee_cents')) db.exec(`ALTER TABLE ${table} ADD COLUMN additional_fee_cents INTEGER NOT NULL DEFAULT 0`);
  }

  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(action) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = action(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function workspace(workspaceId) {
    const row = get('SELECT * FROM aa_workspaces WHERE id=?', workspaceId);
    if (!row) problem('NOT_FOUND', 'Workspace not found', 404);
    return row;
  }
  function ledger(entryKey, workspaceId, kind, amount, paymentId = null, jobId = null) {
    run('INSERT INTO aa_ledger(entry_key,workspace_id,kind,amount_cents,payment_id,job_id,created_at) VALUES(?,?,?,?,?,?,?)', entryKey, workspaceId, kind, amount, paymentId, jobId, now());
  }
  function event(eventId, kind, payload) {
    text(eventId, 'event ID');
    const payloadDigest = hash(JSON.stringify(payload));
    const existing = get('SELECT * FROM aa_events WHERE id=?', eventId);
    if (existing) {
      if (existing.kind !== kind || existing.digest !== payloadDigest) problem('IDEMPOTENCY_CONFLICT', 'Event ID already used with different content');
      return false;
    }
    run('INSERT INTO aa_events(id,kind,digest,created_at) VALUES(?,?,?,?)', eventId, kind, payloadDigest, now());
    return true;
  }
  function pause(reason) { run("INSERT INTO aa_settings(key,value) VALUES('pause',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", reason); }
  function audit(action, subject, reason) {
    text(reason, 'owner review reason', 500);
    run('INSERT INTO aa_admin_audit(action,subject,reason,created_at) VALUES(?,?,?,?)', action, subject, reason, now());
  }
  function availableLots(workspaceId) {
    return all(`SELECT p.*, p.amount_cents-p.reversed_cents-COALESCE((SELECT SUM(a.amount_cents) FROM aa_allocations a JOIN aa_jobs j ON j.id=a.job_id WHERE a.payment_id=p.payment_id AND j.status IN ('running','succeeded','expired')),0) AS available_cents FROM aa_payments p WHERE p.workspace_id=? ORDER BY p.created_at,p.payment_id`, workspaceId);
  }
  function wallet(workspaceId) {
    const owner = workspace(workspaceId);
    const funding = get('SELECT COALESCE(SUM(amount_cents-reversed_cents),0) AS total,COALESCE(MAX(disputed),0) AS disputed FROM aa_payments WHERE workspace_id=?', workspaceId);
    const spent = get("SELECT COALESCE(SUM(q.amount_cents),0) AS total FROM aa_jobs j JOIN aa_quotes q ON q.id=j.quote_id WHERE j.workspace_id=? AND j.status IN ('succeeded','expired')", workspaceId).total;
    const reservedCents = get("SELECT COALESCE(SUM(q.amount_cents),0) AS total FROM aa_jobs j JOIN aa_quotes q ON q.id=j.quote_id WHERE j.workspace_id=? AND j.status='running'", workspaceId).total;
    const balanceCents = funding.total - spent;
    const lots = availableLots(workspaceId).filter(row => row.available_cents > 0);
    const uncertain = get("SELECT 1 AS present FROM aa_jobs WHERE workspace_id=? AND status='uncertain' LIMIT 1", workspaceId);
    // Nonrefunded funding must cover the retained payment fee. Keeping the old
    // denominator after a partial refund would silently underprice future work.
    return {balanceCents, reservedCents, availableCents: Math.max(0, balanceCents - reservedCents), frozen: Boolean(owner.frozen || funding.disputed || uncertain || balanceCents < reservedCents), maxPaymentFeeBps: lots.reduce((max, p) => Math.max(max, Math.ceil((p.payment_fee_cents + p.additional_fee_cents) * 10000 / (p.amount_cents - p.reversed_cents))), 0)};
  }
  function session(workspaceId) {
    const sessionToken = secret(), csrfToken = secret();
    run('INSERT INTO aa_sessions(token_hash,workspace_id,csrf_token,expires_at) VALUES(?,?,?,?)', hash(sessionToken), workspaceId, csrfToken, now() + SESSION_TTL);
    return {workspaceId, sessionToken, csrfToken};
  }
  function getBudget() {
    const failureSpentCents = get('SELECT COALESCE(SUM(provider_cents+fixed_cents),0) AS total FROM aa_expenses WHERE failure=1').total;
    const outstandingCostCents = get('SELECT COALESCE(SUM(outstanding_cost_cents),0) AS total FROM aa_jobs').total;
    const paused = get("SELECT value FROM aa_settings WHERE key='pause'")?.value || null;
    return {failureReserveCents, failureSpentCents, outstandingCostCents, failureReserveRemainingCents: Math.max(0, failureReserveCents - failureSpentCents - outstandingCostCents), maxOutstandingCostCents, paused, uncertainJobs: get("SELECT COUNT(*) AS total FROM aa_jobs WHERE status='uncertain'").total};
  }
  function getAccounting() {
    const funding = get('SELECT COALESCE(SUM(amount_cents),0) AS funded,COALESCE(SUM(reversed_cents),0) AS reversed,COALESCE(SUM(payment_fee_cents),0) AS paymentFees FROM aa_payments');
    const refundedPaymentFeeBoundCents = all('SELECT payment_fee_cents,reversed_cents,amount_cents FROM aa_payments WHERE reversed_cents>0').reduce((sum, p) => sum + Math.ceil(p.payment_fee_cents * p.reversed_cents / p.amount_cents), 0);
    const earned = get("SELECT COALESCE(SUM(q.amount_cents),0) AS revenue FROM aa_jobs j JOIN aa_quotes q ON q.id=j.quote_id WHERE j.status IN ('succeeded','expired')").revenue;
    const expenses = get('SELECT COALESCE(SUM(provider_cents),0) AS provider,COALESCE(SUM(fixed_cents),0) AS fixed FROM aa_expenses');
    const additionalFees = get('SELECT COALESCE(SUM(additional_fee_cents),0) AS total FROM aa_payment_changes').total;
    const wallets = all('SELECT id FROM aa_workspaces').map(row => wallet(row.id));
    return {fundedCents: funding.funded, reversedCents: funding.reversed, unspentLiabilityCents: wallets.reduce((sum, w) => sum + Math.max(0, w.balanceCents), 0), customerReservedCents: wallets.reduce((sum, w) => sum + w.reservedCents, 0), earnedRevenueCents: earned, providerExpenseCents: expenses.provider, allocatedFixedExpenseCents: expenses.fixed, paymentFeeBoundCents: funding.paymentFees, refundedPaymentFeeBoundCents, additionalPaymentFeeCents: additionalFees, unknownCostReserveCents: getBudget().outstandingCostCents};
  }
  function publicJob(row) {
    if (!row) problem('NOT_FOUND', 'Analysis job not found', 404);
    const q = get('SELECT amount_cents FROM aa_quotes WHERE id=?', row.quote_id);
    return {id: row.id, status: row.status, amountCents: q.amount_cents, createdAt: row.created_at, ...(row.completed_at === null ? {} : {completedAt: row.completed_at}), ...(row.error ? {error: row.error} : {}), ...(row.result ? {result: JSON.parse(row.result)} : {})};
  }
  function expireResults() {
    run("UPDATE aa_jobs SET result=NULL,status='expired' WHERE status='succeeded' AND result_expires_at<=?", now());
    run('DELETE FROM aa_sessions WHERE expires_at<=?', now());
  }
  function quoteRow(workspaceId, quoteId) {
    const row = get('SELECT * FROM aa_quotes WHERE id=? AND workspace_id=?', quoteId, workspaceId);
    if (!row) problem('NOT_FOUND', 'Quote not found', 404);
    return row;
  }
  function jobRow(jobId) {
    const row = get('SELECT * FROM aa_jobs WHERE id=?', jobId);
    if (!row) problem('NOT_FOUND', 'Analysis job not found', 404);
    return row;
  }
  function recordExpense(job, actualProviderCostCents, failure) {
    cents(actualProviderCostCents, 'actual provider cost');
    const q = get('SELECT * FROM aa_quotes WHERE id=?', job.quote_id);
    const total = actualProviderCostCents + q.fixed_cost_cents;
    run('INSERT INTO aa_expenses(job_id,provider_cents,fixed_cents,failure,created_at) VALUES(?,?,?,?,?)', job.id, actualProviderCostCents, q.fixed_cost_cents, failure ? 1 : 0, now());
    ledger(`expense:${job.id}`, null, failure ? 'failure_expense' : 'service_expense', total, null, job.id);
    if (actualProviderCostCents > q.provider_cost_ceiling_cents) pause('Provider cost exceeded its accepted bound; reconcile pricing before resuming.');
    return total;
  }
  function recoverPendingJobs() {
    return transaction(() => {
      const pending = all("SELECT j.*,q.amount_cents FROM aa_jobs j JOIN aa_quotes q ON q.id=j.quote_id WHERE j.status='running'");
      for (const job of pending) {
        run("UPDATE aa_jobs SET status='uncertain',error='Execution interrupted; no charge. Provider expense awaits reconciliation.',completed_at=? WHERE id=?", now(), job.id);
        ledger(`release:${job.id}`, job.workspace_id, 'release', job.amount_cents, null, job.id);
      }
      return pending.length;
    });
  }
  const store = {
    assertPaymentMode(mode) {
      if (!['test', 'live'].includes(mode)) problem('PAYMENT_MODE_INVALID', 'Payment mode must be test or live', 503);
      return transaction(() => {
        const stored = get("SELECT value FROM aa_settings WHERE key='payment_mode'")?.value;
        if (stored && stored !== mode) problem('PAYMENT_MODE_MISMATCH', 'The ledger belongs to a different payment mode; use a separate database', 503);
        if (!stored) {
          const records = get('SELECT (SELECT COUNT(*) FROM aa_payments)+(SELECT COUNT(*) FROM aa_jobs)+(SELECT COUNT(*) FROM aa_payment_changes) AS total').total;
          if (records) problem('PAYMENT_MODE_UNPINNED', 'Existing financial records have no payment-mode provenance; use a new database', 503);
          run("INSERT INTO aa_settings(key,value) VALUES('payment_mode',?)", mode);
        }
        return mode;
      });
    },
    getPaymentMode() { return get("SELECT value FROM aa_settings WHERE key='payment_mode'")?.value || null; },
    createWorkspace() {
      return transaction(() => {
        const workspaceId = id('ws'), recoveryCode = secret();
        run('INSERT INTO aa_workspaces(id,recovery_hash,created_at) VALUES(?,?,?)', workspaceId, hash(recoveryCode), now());
        return {...session(workspaceId), recoveryCode};
      });
    },
    recoverWorkspace(recoveryCode) {
      text(recoveryCode, 'recovery code', 128);
      return transaction(() => {
        const owner = get('SELECT id FROM aa_workspaces WHERE recovery_hash=?', hash(recoveryCode));
        if (!owner) problem('UNAUTHORIZED', 'Recovery credential is not valid', 401);
        run('DELETE FROM aa_sessions WHERE workspace_id=?', owner.id);
        return session(owner.id);
      });
    },
    getSession(token) {
      if (typeof token !== 'string' || token.length > 128) return null;
      const row = get('SELECT * FROM aa_sessions WHERE token_hash=? AND expires_at>?', hash(token), now());
      return row ? {workspaceId: row.workspace_id, csrfToken: row.csrf_token} : null;
    },
    logout(token) { if (typeof token === 'string') run('DELETE FROM aa_sessions WHERE token_hash=?', hash(token)); },
    getWorkspace(workspaceId) {
      expireResults();
      return {workspaceId, wallet: wallet(workspaceId), history: all('SELECT kind,amount_cents AS amountCents,created_at AS createdAt,payment_id AS paymentId,job_id AS jobId FROM aa_ledger WHERE workspace_id=? ORDER BY id DESC LIMIT 100', workspaceId)};
    },
    freezeWorkspace(workspaceId, {reason} = {}) {
      return transaction(() => { workspace(workspaceId); run('UPDATE aa_workspaces SET frozen=1 WHERE id=?', workspaceId); if (reason !== undefined) audit('freeze', workspaceId, reason); return wallet(workspaceId); });
    },
    unfreezeWorkspace(workspaceId, {reason} = {}) {
      return transaction(() => {
        workspace(workspaceId);
        run('UPDATE aa_workspaces SET frozen=0 WHERE id=?', workspaceId);
        const current = wallet(workspaceId);
        if (reason !== undefined) {
          if (current.frozen) problem('WORKSPACE_STILL_BLOCKED', 'Unresolved provider expenses, disputes, or reversed funding still block this workspace');
          audit('unfreeze', workspaceId, reason);
        }
        return current;
      });
    },
    beginCheckout({workspaceId, requestId}) {
      text(requestId, 'checkout request ID', 128);
      return transaction(() => {
        workspace(workspaceId);
        const existing = store.getCheckout(workspaceId, requestId);
        if (existing) return existing;
        run('INSERT INTO aa_checkouts(id,workspace_id,request_id,created_at) VALUES(?,?,?,?)', id('checkout'), workspaceId, requestId, now());
        return store.getCheckout(workspaceId, requestId);
      });
    },
    getCheckout(workspaceId, requestId) { return get('SELECT id,workspace_id AS workspaceId,request_id AS requestId,session_id AS sessionId,url,created_at AS createdAt FROM aa_checkouts WHERE workspace_id=? AND request_id=?', workspaceId, requestId) || null; },
    getCheckoutById(checkoutId) { return get('SELECT id,workspace_id AS workspaceId,request_id AS requestId,session_id AS sessionId,url,created_at AS createdAt FROM aa_checkouts WHERE id=?', checkoutId) || null; },
    getCheckoutBySession(sessionId) { return get('SELECT id,workspace_id AS workspaceId,request_id AS requestId,session_id AS sessionId,url,created_at AS createdAt FROM aa_checkouts WHERE session_id=?', sessionId) || null; },
    bindCheckout({checkoutId, sessionId, url}) {
      text(sessionId, 'checkout session ID'); text(url, 'checkout URL', 4096);
      return transaction(() => {
        const row = get('SELECT * FROM aa_checkouts WHERE id=?', checkoutId);
        if (!row) problem('NOT_FOUND', 'Checkout not found', 404);
        if (row.session_id && (row.session_id !== sessionId || (row.url !== url && row.url !== 'https://checkout.stripe.com/'))) problem('IDEMPOTENCY_CONFLICT', 'Checkout is already bound');
        run('UPDATE aa_checkouts SET session_id=?,url=? WHERE id=?', sessionId, url, checkoutId);
        return store.getCheckoutBySession(sessionId);
      });
    },
    creditFunding({eventId, paymentId, workspaceId, amountCents, currency, paymentFeeCents = 430}) {
      text(paymentId, 'payment ID'); cents(paymentFeeCents, 'payment fee');
      if (amountCents !== 5000 || currency !== 'cad') problem('INVALID_PAYMENT', 'Only a paid C$50 top-up can fund this balance', 400);
      return transaction(() => {
        workspace(workspaceId);
        if (!event(eventId, 'funding', {paymentId, workspaceId, amountCents, currency, paymentFeeCents})) return {credited: false};
        const previous = get('SELECT * FROM aa_payments WHERE payment_id=?', paymentId);
        if (previous) {
          if (previous.workspace_id !== workspaceId || previous.amount_cents !== amountCents) problem('IDEMPOTENCY_CONFLICT', 'Payment is already credited elsewhere');
          return {credited: false};
        }
        const adjustment = get('SELECT * FROM aa_payment_changes WHERE payment_id=?', paymentId);
        const reversed = Math.min(amountCents, adjustment?.reversed_cents || 0);
        const fee = Math.max(paymentFeeCents, adjustment?.payment_fee_cents ?? 0);
        const additionalFee = adjustment?.additional_fee_cents || 0;
        run('INSERT INTO aa_payments(payment_id,workspace_id,amount_cents,payment_fee_cents,reversed_cents,disputed,created_at,additional_fee_cents) VALUES(?,?,?,?,?,?,?,?)', paymentId, workspaceId, amountCents, fee, reversed, adjustment?.disputed || 0, now(), additionalFee);
        ledger(`fund:${paymentId}`, workspaceId, 'topup', amountCents, paymentId);
        ledger(`payment-fee:${paymentId}`, null, 'payment_fee_bound', fee, paymentId);
        if (reversed) ledger(`pre-reversal:${paymentId}`, workspaceId, 'reversal', -reversed, paymentId);
        return {credited: true};
      });
    },
    reverseFunding({eventId, paymentId, reversedCents, disputed = false, reason = 'reversal', additionalFeeCents = 0}) {
      text(paymentId, 'payment ID'); cents(reversedCents, 'cumulative reversed amount'); text(reason, 'reversal reason');
      cents(additionalFeeCents, 'cumulative additional payment fee');
      if (reversedCents > 5000 || typeof disputed !== 'boolean') problem('INVALID_PAYMENT', 'Invalid funding reversal', 400);
      return transaction(() => {
        if (!event(eventId, 'reversal', {paymentId, reversedCents, disputed, reason, additionalFeeCents})) return {changed: false};
        const previous = get('SELECT * FROM aa_payment_changes WHERE payment_id=?', paymentId);
        const nextReversed = Math.max(previous?.reversed_cents || 0, reversedCents);
        const nextDisputed = disputed || previous?.disputed ? 1 : 0;
        const nextFee = Math.max(previous?.additional_fee_cents || 0, additionalFeeCents);
        run('INSERT INTO aa_payment_changes(payment_id,reversed_cents,disputed,additional_fee_cents) VALUES(?,?,?,?) ON CONFLICT(payment_id) DO UPDATE SET reversed_cents=excluded.reversed_cents,disputed=excluded.disputed,additional_fee_cents=excluded.additional_fee_cents', paymentId, nextReversed, nextDisputed, nextFee);
        const feeDifference = nextFee - (previous?.additional_fee_cents || 0);
        if (feeDifference) ledger(`additional-fee:${eventId}`, null, 'additional_payment_fee', feeDifference, paymentId);
        const funding = get('SELECT * FROM aa_payments WHERE payment_id=?', paymentId);
        if (funding) {
          const difference = nextReversed - funding.reversed_cents;
          run('UPDATE aa_payments SET reversed_cents=?,disputed=?,additional_fee_cents=? WHERE payment_id=?', nextReversed, nextDisputed, nextFee, paymentId);
          if (difference) ledger(`reversal:${eventId}`, funding.workspace_id, 'reversal', -difference, paymentId);
        }
        return {changed: true};
      });
    },
    updateFundingFee({eventId, paymentId, paymentFeeCents}) {
      text(paymentId, 'payment ID'); cents(paymentFeeCents, 'payment fee');
      return transaction(() => {
        if (!event(eventId, 'payment_fee', {paymentId, paymentFeeCents})) return {changed: false};
        // Keep the greatest observed fee: late/out-of-order events cannot lower a bound.
        run('INSERT INTO aa_payment_changes(payment_id,payment_fee_cents) VALUES(?,?) ON CONFLICT(payment_id) DO UPDATE SET payment_fee_cents=MAX(COALESCE(payment_fee_cents,0),excluded.payment_fee_cents)', paymentId, paymentFeeCents);
        const p = get('SELECT * FROM aa_payments WHERE payment_id=?', paymentId);
        if (p) {
          run('UPDATE aa_payments SET payment_fee_cents=MAX(payment_fee_cents,?) WHERE payment_id=?', paymentFeeCents, paymentId);
          if (paymentFeeCents > p.payment_fee_cents) ledger(`payment-fee:${eventId}`, null, 'payment_fee_adjustment', paymentFeeCents - p.payment_fee_cents, paymentId);
          const underpriced = get(`SELECT 1 AS present FROM aa_allocations a JOIN aa_jobs j ON j.id=a.job_id JOIN aa_quotes q ON q.id=j.quote_id WHERE a.payment_id=? AND j.status IN ('running','succeeded','expired') AND q.payment_fee_bps<? LIMIT 1`, paymentId, Math.ceil((paymentFeeCents + p.additional_fee_cents) * 10000 / p.amount_cents));
          if (underpriced) pause('Payment fees exceeded a reserved quote; reconcile funding fees before resuming.');
        }
        return {changed: true};
      });
    },
    createQuote(input) {
      const {workspaceId, inputDigest, amountCents, maxCostCents, providerCostCeilingCents, fixedCostCents, paymentFeeBps, pricingVersion, expiresAt} = input;
      digest(inputDigest); text(pricingVersion, 'pricing version', 160);
      for (const [key, value] of Object.entries({amountCents, maxCostCents, providerCostCeilingCents, fixedCostCents, paymentFeeBps})) cents(value, key);
      if (amountCents < 200 || providerCostCeilingCents + fixedCostCents !== maxCostCents || paymentFeeBps >= 5000 || maxCostCents + Math.ceil(amountCents * paymentFeeBps / 10000) > Math.floor(amountCents / 2)) problem('INVALID_QUOTE', 'Quote violates the 50% contribution margin floor', 400);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= now() || expiresAt > now() + QUOTE_TTL_MS) problem('INVALID_QUOTE', 'Invalid quote expiry', 400);
      const payload = JSON.stringify(input);
      if (payload.length > 32768) problem('INVALID_QUOTE', 'Quote metadata is too large', 400);
      return transaction(() => {
        if (wallet(workspaceId).frozen) problem('WORKSPACE_FROZEN', 'This balance requires owner review');
        const quoteId = id('quote');
        run('INSERT INTO aa_quotes(id,workspace_id,input_digest,amount_cents,max_cost_cents,provider_cost_ceiling_cents,fixed_cost_cents,payment_fee_bps,pricing_version,expires_at,created_at,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', quoteId, workspaceId, inputDigest, amountCents, maxCostCents, providerCostCeilingCents, fixedCostCents, paymentFeeBps, pricingVersion, expiresAt, now(), payload);
        return {id: quoteId, amountCents, currency: 'cad', expiresAt, inputDigest, pricingVersion};
      });
    },
    getQuote(workspaceId, quoteId) { const row = quoteRow(workspaceId, quoteId); return {...JSON.parse(row.payload), id: row.id}; },
    reserveJob({workspaceId, quoteId, inputDigest}) {
      digest(inputDigest);
      return transaction(() => {
        const q = quoteRow(workspaceId, quoteId);
        if (q.input_digest !== inputDigest) problem('EVIDENCE_CHANGED', 'Evidence changed; request a new quote', 400);
        const existing = get('SELECT * FROM aa_jobs WHERE quote_id=?', quoteId);
        if (existing) return {job: publicJob(existing), created: false};
        if (q.expires_at <= now()) problem('QUOTE_EXPIRED', 'Quote expired; request a new quote');
        const w = wallet(workspaceId);
        if (w.frozen) problem('WORKSPACE_FROZEN', 'This balance requires owner review');
        if (w.availableCents < q.amount_cents) problem('INSUFFICIENT_BALANCE', 'Top up before accepting this quote', 402);
        if (w.maxPaymentFeeBps > q.payment_fee_bps) problem('FEE_CHANGED', 'Payment fee bound changed; request a new quote');
        const b = getBudget();
        if (b.paused) problem('EXECUTION_PAUSED', 'Paid execution is paused for cost reconciliation', 503);
        if (get("SELECT 1 AS present FROM aa_jobs WHERE status='running' LIMIT 1")) problem('BUSY', 'Another analysis is in progress', 429);
        if (b.failureReserveRemainingCents < q.max_cost_cents || b.outstandingCostCents + q.max_cost_cents > maxOutstandingCostCents) problem('COST_RESERVE_EXHAUSTED', 'Analysis capacity is awaiting cost reconciliation', 503);
        const counts = get('SELECT SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) AS hourly,COUNT(*) AS daily FROM aa_jobs WHERE created_at>?', now() - 3600000, now() - DAY);
        if (counts.hourly >= 6 || counts.daily >= 20) problem('RATE_LIMITED', 'Analysis attempt limit reached', 429);
        const jobId = id('job');
        run("INSERT INTO aa_jobs(id,quote_id,workspace_id,status,created_at,outstanding_cost_cents) VALUES(?,?,?,'running',?,?)", jobId, quoteId, workspaceId, now(), q.max_cost_cents);
        let remaining = q.amount_cents;
        for (const lot of availableLots(workspaceId)) {
          const amount = Math.min(remaining, Math.max(0, lot.available_cents));
          if (amount) run('INSERT INTO aa_allocations(job_id,payment_id,amount_cents) VALUES(?,?,?)', jobId, lot.payment_id, amount);
          remaining -= amount;
          if (!remaining) break;
        }
        if (remaining) problem('INSUFFICIENT_BALANCE', 'Balance cannot fund this quote', 402);
        ledger(`reserve:${jobId}`, workspaceId, 'reservation', -q.amount_cents, null, jobId);
        return {job: publicJob(jobRow(jobId)), created: true};
      });
    },
    getJob(workspaceId, jobId) { expireResults(); return publicJob(get('SELECT * FROM aa_jobs WHERE id=? AND workspace_id=?', jobId, workspaceId)); },
    getJobByQuote(workspaceId, quoteId) {
      expireResults();
      const job = get('SELECT * FROM aa_jobs WHERE quote_id=? AND workspace_id=?', quoteId, workspaceId);
      return job ? publicJob(job) : null;
    },
    completeJob({jobId, result, actualProviderCostCents}) {
      const resultJson = JSON.stringify(result);
      if (!resultJson || resultJson.length > 262144) problem('INVALID_RESULT', 'Result is missing or too large', 400);
      cents(actualProviderCostCents, 'actual provider cost');
      return transaction(() => {
        const job = jobRow(jobId);
        if (job.status === 'succeeded' || job.status === 'expired') return publicJob(job);
        if (job.status !== 'running') problem('JOB_NOT_RUNNING', 'Analysis is no longer running');
        const q = get('SELECT * FROM aa_quotes WHERE id=?', job.quote_id);
        recordExpense(job, actualProviderCostCents, false);
        run("UPDATE aa_jobs SET status='succeeded',result=?,result_expires_at=?,completed_at=?,outstanding_cost_cents=0 WHERE id=?", resultJson, now() + RESULT_TTL, now(), jobId);
        ledger(`release:${jobId}`, job.workspace_id, 'release', q.amount_cents, null, jobId);
        ledger(`charge:${jobId}`, job.workspace_id, 'charge', -q.amount_cents, null, jobId);
        return publicJob(jobRow(jobId));
      });
    },
    failJob({jobId, error = 'Analysis could not produce a usable result. No charge.', actualProviderCostCents, uncertain = actualProviderCostCents === undefined}) {
      text(error, 'public error', 500);
      if (!uncertain) cents(actualProviderCostCents, 'actual provider cost');
      return transaction(() => {
        const job = jobRow(jobId);
        if (job.status !== 'running') return publicJob(job);
        const q = get('SELECT amount_cents FROM aa_quotes WHERE id=?', job.quote_id);
        if (!uncertain) recordExpense(job, actualProviderCostCents, true);
        run('UPDATE aa_jobs SET status=?,error=?,completed_at=?,outstanding_cost_cents=? WHERE id=?', uncertain ? 'uncertain' : 'failed', error, now(), uncertain ? job.outstanding_cost_cents : 0, jobId);
        ledger(`release:${jobId}`, job.workspace_id, 'release', q.amount_cents, null, jobId);
        return publicJob(jobRow(jobId));
      });
    },
    reconcileJob({jobId, actualProviderCostCents, reason, confirmedNoResultNoCharge}) {
      cents(actualProviderCostCents, 'actual provider cost');
      if (reason !== undefined && confirmedNoResultNoCharge !== true) problem('REVIEW_REQUIRED', 'Confirm that no usable result was delivered and no customer charge is due', 400);
      return transaction(() => {
        const job = jobRow(jobId);
        if (job.status === 'failed') {
          const expense = get('SELECT provider_cents FROM aa_expenses WHERE job_id=?', jobId);
          if (expense?.provider_cents !== actualProviderCostCents) problem('IDEMPOTENCY_CONFLICT', 'This job already has a different reconciled expense');
          return publicJob(job);
        }
        if (job.status !== 'uncertain') problem('JOB_NOT_UNCERTAIN', 'Only uncertain execution can be reconciled');
        recordExpense(job, actualProviderCostCents, true);
        run("UPDATE aa_jobs SET status='failed',outstanding_cost_cents=0 WHERE id=?", jobId);
        if (reason !== undefined) audit('reconcile_no_result', jobId, reason);
        return publicJob(jobRow(jobId));
      });
    },
    listUncertainJobs() { return all("SELECT id,workspace_id AS workspaceId,created_at AS createdAt,outstanding_cost_cents AS reservedCostCents FROM aa_jobs WHERE status='uncertain' ORDER BY created_at,id LIMIT 100"); },
    getAdminAudit() { return all('SELECT action,subject,reason,created_at AS createdAt FROM aa_admin_audit ORDER BY id DESC LIMIT 100'); },
    getBudget,
    getAccounting,
    recoverPendingJobs,
    expireResults,
    close() { db.close(); },
  };
  try {
    if (options.paymentMode !== undefined) store.assertPaymentMode(options.paymentMode);
    expireResults();
    if (options.recoverOnOpen !== false) recoverPendingJobs();
  } catch (error) { db.close(); throw error; }
  return store;
}

module.exports = {createStore, SESSION_TTL, RESULT_TTL};
