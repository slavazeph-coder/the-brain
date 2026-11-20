import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

/**
 * API access waitlist.
 *
 * Public signup for the World Builder API does not exist yet, so this records
 * who wants access and what they would build. It shares the World Projects
 * PostgreSQL database and never falls back to memory or the filesystem: when
 * storage is unavailable the visitor is told so rather than silently dropped.
 *
 * The response never says whether an address was already listed, so the form
 * cannot be used to test who has signed up.
 */

export const WAITLIST_USE_CASES = Object.freeze([
  'scan-to-sim', 'saved-projects', 'processing-api', 'bim-export', 'robot-testing', 'other',
]);
export const WAITLIST_VOLUMES = Object.freeze(['', 'under-10', '10-100', '100-1000', 'over-1000']);
export const WAITLIST_SOURCES = Object.freeze(['', 'api', 'projects', 'world', 'home']);
export const WAITLIST_LIMITS = Object.freeze({ name: 120, company: 160, details: 1000, email: 254 });

const FIELDS = new Set(['email', 'name', 'company', 'use_case', 'monthly_volume', 'details', 'source', 'consent', 'website']);
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export class WaitlistError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = message => { throw new WaitlistError(400, 'invalid-request', message); };

function text(value, label, maximum) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > maximum || CONTROL.test(value)) bad(`Use ${label} of at most ${maximum} characters.`);
  return value.trim();
}

/** Validates one sign-up. Returns null for a filled honeypot, which is accepted and discarded. */
export function validateWaitlistEntry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) bad('Send one JSON object.');
  if (Object.keys(body).some(key => !FIELDS.has(key))) bad('The request contains unsupported fields.');
  if (typeof body.website === 'string' && body.website.trim()) return null;
  const email = text(body.email, 'an email address', WAITLIST_LIMITS.email).toLowerCase();
  if (!EMAIL.test(email)) bad('Enter a valid email address.');
  const useCase = body.use_case;
  if (!WAITLIST_USE_CASES.includes(useCase)) bad('Choose what you want to build.');
  const volume = body.monthly_volume ?? '';
  if (!WAITLIST_VOLUMES.includes(volume)) bad('Choose a supported monthly volume.');
  const source = body.source ?? '';
  if (!WAITLIST_SOURCES.includes(source)) bad('Unsupported sign-up source.');
  if (body.consent !== true) bad('Agree to be contacted about API access.');
  return {
    email,
    name: text(body.name, 'a name', WAITLIST_LIMITS.name),
    company: text(body.company, 'a company name', WAITLIST_LIMITS.company),
    use_case: useCase,
    monthly_volume: volume,
    details: text(body.details, 'details', WAITLIST_LIMITS.details),
    source,
  };
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS brainsnn_api_waitlist (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  use_case text NOT NULL,
  monthly_volume text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  submissions integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
)`;

// Any fixed 64-bit key; it names this table's count-and-insert critical section.
const WAITLIST_LOCK = 7316402;

export const WAITLIST_MESSAGE = 'Thanks. You are on the API access waitlist. We will email you when access opens; nothing else is sent to this address.';

/**
 * @param {{pool?: any, env?: Record<string,string|undefined>, now?: () => number, maxEntries?: number, hourlyCeiling?: number}} options
 */
export function createApiWaitlist({ pool: suppliedPool, env = process.env, now = Date.now, maxEntries = 50000, hourlyCeiling = 300 } = {}) {
  const enabled = env.API_WAITLIST_ENABLED !== '0';
  const databaseUrl = env.WORLD_PROJECT_DATABASE_URL || env.DATABASE_URL;
  const ownPool = !suppliedPool && enabled && !!databaseUrl;
  const pool = suppliedPool || (ownPool ? new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000 }) : null);
  if (ownPool) pool.on('error', () => { console.warn('API waitlist database connection became unavailable.'); });

  let ready = null;
  // A process-wide ceiling under the per-address limiter, so a distributed flood
  // cannot fill the table faster than a person could read it.
  let windowStart = now(), accepted = 0;

  async function initialize() {
    if (!enabled || !pool) throw new WaitlistError(503, 'waitlist-unavailable', 'The waitlist is not available right now.');
    if (!ready) ready = pool.query(SCHEMA).catch(error => { ready = null; throw error; });
    await ready;
  }

  async function join(body) {
    const entry = validateWaitlistEntry(body);
    if (!entry) return { ok: true, message: WAITLIST_MESSAGE };
    await initialize();
    const at = now();
    if (at - windowStart >= 3600000) { windowStart = at; accepted = 0; }
    // Reserve hourly capacity before any await, so concurrent requests cannot all see the same headroom.
    if (accepted >= hourlyCeiling) throw new WaitlistError(503, 'waitlist-busy', 'The waitlist is busy. Please try again in an hour.');
    accepted++;
    const window = windowStart;
    let stored = false;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize count-and-insert across connections and processes for the length of this transaction.
      await client.query('SELECT pg_advisory_xact_lock($1)', [WAITLIST_LOCK]);
      const total = Number((await client.query('SELECT count(*) AS n FROM brainsnn_api_waitlist')).rows[0].n);
      const stamp = new Date(at).toISOString();
      // Latest details win so a person can correct a typo by submitting again.
      const result = await client.query(`INSERT INTO brainsnn_api_waitlist
          (id,email,name,company,use_case,monthly_volume,details,source,created_at,updated_at)
        SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$9 WHERE $10::integer < $11::integer
          OR EXISTS (SELECT 1 FROM brainsnn_api_waitlist WHERE email=$2)
        ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, company=EXCLUDED.company, use_case=EXCLUDED.use_case,
          monthly_volume=EXCLUDED.monthly_volume, details=EXCLUDED.details, source=EXCLUDED.source,
          submissions=brainsnn_api_waitlist.submissions+1, updated_at=EXCLUDED.updated_at`,
        [`wl_${randomUUID()}`, entry.email, entry.name, entry.company, entry.use_case, entry.monthly_volume, entry.details, entry.source, stamp, total, maxEntries]);
      await client.query('COMMIT');
      if (result.rowCount === 0) throw new WaitlistError(503, 'waitlist-full', 'The waitlist is full. Please email hello@brainsnn.com instead.');
      stored = true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      // A refused or failed sign-up gives its reservation back, unless the hour has already rolled over.
      if (!stored && windowStart === window && accepted > 0) accepted--;
    }
    return { ok: true, message: WAITLIST_MESSAGE };
  }

  async function list() {
    await initialize();
    const { rows } = await pool.query(`SELECT email,name,company,use_case,monthly_volume,details,source,submissions,created_at,updated_at
      FROM brainsnn_api_waitlist ORDER BY created_at ASC, email ASC`);
    return rows.map(row => ({ ...row, submissions: Number(row.submissions),
      created_at: new Date(row.created_at).toISOString(), updated_at: new Date(row.updated_at).toISOString() }));
  }

  async function remove(email) {
    await initialize();
    const normalized = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(normalized)) bad('Enter a valid email address.');
    const result = await pool.query('DELETE FROM brainsnn_api_waitlist WHERE email=$1', [normalized]);
    return result.rowCount > 0;
  }

  async function status() {
    try { await initialize(); await pool.query('SELECT 1'); return { available: true }; }
    catch { return { available: false }; }
  }

  function send(res, error) {
    if (error instanceof WaitlistError) return res.status(error.status).json({ error: error.message, code: error.code });
    console.warn('API waitlist request failed.');
    return res.status(503).json({ error: 'The waitlist is not available right now.', code: 'waitlist-unavailable' });
  }

  /** Express handlers. Mount `submit` after the JSON parser and a dedicated rate limit. */
  async function submit(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    try { return res.status(202).json(await join(req.body)); } catch (error) { return send(res, error); }
  }
  /** Owner-only export: `authorize(req)` must return a truthy owner session. */
  function exporter(authorize) {
    return async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (!authorize(req)) return res.status(401).json({ error: 'Sign in as the site owner to read the waitlist.', code: 'owner-required' });
      try { const entries = await list(); return res.json({ count: entries.length, entries }); } catch (error) { return send(res, error); }
    };
  }
  async function close() { if (ownPool) await pool.end(); }

  return { initialize, join, list, remove, status, submit, exporter, close, enabled };
}
