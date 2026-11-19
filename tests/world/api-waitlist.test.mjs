import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createApiWaitlist, validateWaitlistEntry, WaitlistError, WAITLIST_MESSAGE, WAITLIST_USE_CASES } from '../../brainsnn-r3f-app/src/server/apiWaitlist.js';
import { LIMITS, routeTier } from '../../brainsnn-r3f-app/src/lib/rateLimit.js';
import { createProjectTestPool } from './helpers/project-test-pool.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const express = require('express');
const entry = (overrides = {}) => ({ email: 'Builder@Example.com', name: 'Ada Builder', company: 'Site Robotics',
  use_case: 'scan-to-sim', monthly_volume: '10-100', details: 'Scan warehouses and test cleaning routes.', source: 'api', consent: true, ...overrides });
const rejects = async (promise, code) => { await assert.rejects(promise, error => error instanceof WaitlistError && error.code === code); };

async function fixture(options = {}) {
  const pool = await createProjectTestPool();
  let clock = Date.parse('2026-11-19T12:00:00Z');
  const waitlist = createApiWaitlist({ pool, env: {}, now: () => clock, ...options });
  await pool.query('DROP TABLE IF EXISTS brainsnn_api_waitlist');
  return { pool, waitlist, advance: ms => { clock += ms; }, close: () => pool.end() };
}

test('waitlist validation: accepts a complete sign-up and normalizes the address', () => {
  const value = validateWaitlistEntry(entry({ name: '  Ada Builder  ' }));
  assert.equal(value.email, 'builder@example.com');
  assert.equal(value.name, 'Ada Builder');
  assert.deepEqual(validateWaitlistEntry({ email: 'a@b.co', use_case: 'other', consent: true }),
    { email: 'a@b.co', name: '', company: '', use_case: 'other', monthly_volume: '', details: '', source: '' });
});

test('waitlist validation: rejects what a person could not have meant to send', () => {
  const invalid = [
    entry({ email: 'not-an-address' }), entry({ email: 'a@b' }), entry({ email: `${'x'.repeat(250)}@example.com` }),
    entry({ consent: false }), entry({ consent: 'true' }), entry({ use_case: 'everything' }), entry({ use_case: undefined }),
    entry({ monthly_volume: 'lots' }), entry({ source: 'elsewhere' }), entry({ details: 'x'.repeat(1001) }),
    entry({ name: 'Bell\u0007' }), entry({ company: 42 }), entry({ admin: true }), [], null, 'email=a@b.co',
  ];
  for (const body of invalid) assert.throws(() => validateWaitlistEntry(body), error => error instanceof WaitlistError && error.status === 400, JSON.stringify(body));
  assert.ok(WAITLIST_USE_CASES.length >= 5);
});

test('waitlist validation: a filled honeypot is accepted without being stored', async () => {
  assert.equal(validateWaitlistEntry(entry({ website: 'https://spam.example' })), null);
  const f = await fixture();
  try {
    assert.deepEqual(await f.waitlist.join(entry({ website: 'https://spam.example' })), { ok: true, message: WAITLIST_MESSAGE });
    assert.equal((await f.waitlist.list()).length, 0);
  } finally { await f.close(); }
});

test('waitlist storage: one row per address, latest details win, same reply either way', async () => {
  const f = await fixture();
  try {
    const first = await f.waitlist.join(entry());
    f.advance(60000);
    const second = await f.waitlist.join(entry({ email: 'builder@EXAMPLE.com', company: 'Site Robotics Ltd', use_case: 'saved-projects' }));
    assert.deepEqual(first, second, 'the reply must not reveal whether the address was already listed');
    await f.waitlist.join(entry({ email: 'second@example.org', use_case: 'bim-export', monthly_volume: '' }));
    const rows = await f.waitlist.list();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].email, 'builder@example.com');
    assert.equal(rows[0].company, 'Site Robotics Ltd');
    assert.equal(rows[0].use_case, 'saved-projects');
    assert.equal(rows[0].submissions, 2);
    assert.equal(rows[0].created_at, '2026-11-19T12:00:00.000Z');
    assert.equal(rows[0].updated_at, '2026-11-19T12:01:00.000Z');
    assert.equal(await f.waitlist.remove('SECOND@example.org'), true);
    assert.equal(await f.waitlist.remove('second@example.org'), false);
    assert.deepEqual((await f.waitlist.list()).map(row => row.email), ['builder@example.com']);
  } finally { await f.close(); }
});

test('waitlist storage: a full list refuses new addresses but still lets listed people correct details', async () => {
  const f = await fixture({ maxEntries: 2 });
  try {
    await f.waitlist.join(entry({ email: 'one@example.com' }));
    await f.waitlist.join(entry({ email: 'two@example.com' }));
    await rejects(f.waitlist.join(entry({ email: 'three@example.com' })), 'waitlist-full');
    await f.waitlist.join(entry({ email: 'two@example.com', details: 'Corrected.' }));
    const rows = await f.waitlist.list();
    assert.deepEqual(rows.map(row => row.email), ['one@example.com', 'two@example.com']);
    assert.equal(rows[1].details, 'Corrected.');
  } finally { await f.close(); }
});

test('waitlist storage: a process-wide hourly ceiling bounds a distributed flood', async () => {
  const f = await fixture({ hourlyCeiling: 2 });
  try {
    await f.waitlist.join(entry({ email: 'one@example.com' }));
    await f.waitlist.join(entry({ email: 'two@example.com' }));
    await rejects(f.waitlist.join(entry({ email: 'three@example.com' })), 'waitlist-busy');
    f.advance(3600000);
    await f.waitlist.join(entry({ email: 'three@example.com' }));
    assert.equal((await f.waitlist.list()).length, 3);
  } finally { await f.close(); }
});

test('waitlist storage: no database or a disabled switch is reported, never kept in memory', async () => {
  const none = createApiWaitlist({ env: {} });
  await rejects(none.join(entry()), 'waitlist-unavailable');
  assert.deepEqual(await none.status(), { available: false });
  const pool = await createProjectTestPool();
  try {
    const off = createApiWaitlist({ pool, env: { API_WAITLIST_ENABLED: '0' } });
    await rejects(off.join(entry()), 'waitlist-unavailable');
    // Invalid input is still answered as invalid, before storage is consulted.
    await rejects(none.join(entry({ consent: false })), 'invalid-request');
  } finally { await pool.end(); }
});

test('waitlist routes: public sign-up and owner-only export over HTTP', async () => {
  const f = await fixture();
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.post('/api/world/waitlist', f.waitlist.submit);
  app.get('/api/world/waitlist/entries', f.waitlist.exporter(req => req.headers.authorization === 'Bearer owner' ? { kind: 'owner' } : null));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/world/waitlist`;
  const post = body => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const ok = await post(entry());
    assert.equal(ok.status, 202);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await ok.json(), { ok: true, message: WAITLIST_MESSAGE });
    const invalid = await post(entry({ email: 'nope' }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, 'invalid-request');
    const anonymous = await fetch(`${base}/entries`);
    assert.equal(anonymous.status, 401);
    const visitor = await fetch(`${base}/entries`, { headers: { Authorization: 'Bearer visitor' } });
    assert.equal(visitor.status, 401);
    const owner = await fetch(`${base}/entries`, { headers: { Authorization: 'Bearer owner' } });
    assert.equal(owner.status, 200);
    const data = await owner.json();
    assert.equal(data.count, 1);
    assert.equal(data.entries[0].email, 'builder@example.com');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await f.close();
  }
});

test('waitlist routes: sign-ups have their own strict rate tier', () => {
  assert.equal(routeTier('/api/world/waitlist'), 'waitlist');
  assert.equal(routeTier('/api/world/waitlist/entries'), 'general');
  assert.ok(LIMITS.waitlist.limit <= 10 && LIMITS.waitlist.windowMs >= 60 * 60_000);
});
