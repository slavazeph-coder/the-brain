'use strict';

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const originalExpress = require('express');
const expressPath = require.resolve('express');

const API_PREFIX = '/api/v1/brand-brain';
const COOKIE_NAME = 'brainsnn_workspace';
const MAX_RECORD_BYTES = 128 * 1024;
const MAX_RECORDS_PER_WORKSPACE = 5000;
const REQUESTS_PER_MINUTE = 120;
const memoryFallback = new Map();
const rateBuckets = new Map();
let tableReady = false;
let tablePromise = null;

function json(res, status, payload) {
  res.status(status).type('application/json').send(JSON.stringify(payload));
}

function cleanToken(value) {
  return /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : null;
}

function workspaceFromRequest(req, res) {
  const cookies = String(req.headers.cookie || '').split(';').map((part) => part.trim());
  const existing = cookies.map((part) => part.split('=')).find(([key]) => key === COOKIE_NAME)?.[1];
  const workspace = cleanToken(existing) || crypto.randomBytes(24).toString('base64url');
  if (!cleanToken(existing)) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${workspace}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
  }
  return workspace;
}

function allowRequest(req) {
  const now = Date.now();
  const key = String(req.socket?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown').slice(0, 128);
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= REQUESTS_PER_MINUTE;
}

function psql(sql, variables = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return Promise.reject(new Error('DATABASE_URL is not configured'));
  const args = ['--no-psqlrc', '--set=ON_ERROR_STOP=1', databaseUrl];
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${String(value)}`);
  args.push('-Atqc', sql);
  return new Promise((resolve, reject) => {
    execFile('psql', args, { timeout: 8_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `Brand Brain database command failed: ${String(stderr || error.message).slice(0, 400)}`;
        reject(error);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function ensureTable() {
  if (tableReady) return;
  if (!tablePromise) {
    tablePromise = psql(`
      CREATE TABLE IF NOT EXISTS brainsnn_brand_outcomes (
        workspace_id TEXT NOT NULL,
        record_id TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (workspace_id, record_id)
      );
      CREATE INDEX IF NOT EXISTS brainsnn_brand_outcomes_workspace_created_idx
        ON brainsnn_brand_outcomes (workspace_id, created_at DESC);
    `).then(() => { tableReady = true; }).finally(() => { tablePromise = null; });
  }
  await tablePromise;
}

function fallbackAllowed() {
  return String(process.env.BRAND_BRAIN_MEMORY_FALLBACK || '').toLowerCase() === 'true';
}

function fallbackRecords(workspace) {
  return memoryFallback.get(workspace) || [];
}

async function listRecords(workspace) {
  try {
    await ensureTable();
    const raw = await psql(`SELECT COALESCE(json_agg(payload ORDER BY created_at DESC), '[]'::json)::text FROM brainsnn_brand_outcomes WHERE workspace_id = :'workspace';`, { workspace });
    return { storage: 'postgres', records: JSON.parse(raw || '[]') };
  } catch (error) {
    if (!fallbackAllowed()) throw error;
    return { storage: 'memory-fallback', records: fallbackRecords(workspace) };
  }
}

async function upsertRecord(workspace, record) {
  const payload = JSON.stringify(record || {});
  if (!record?.id || typeof record.id !== 'string') throw new Error('Outcome record id is required.');
  if (Buffer.byteLength(payload, 'utf8') > MAX_RECORD_BYTES) throw new Error('Outcome record is too large.');
  try {
    await ensureTable();
    const countText = await psql(`SELECT COUNT(*) FROM brainsnn_brand_outcomes WHERE workspace_id = :'workspace';`, { workspace });
    const count = Number(countText) || 0;
    if (count >= MAX_RECORDS_PER_WORKSPACE) {
      const exists = await psql(`SELECT 1 FROM brainsnn_brand_outcomes WHERE workspace_id = :'workspace' AND record_id = :'record_id' LIMIT 1;`, { workspace, record_id: record.id });
      if (!exists) throw new Error('Brand Brain workspace record limit reached.');
    }
    await psql(`
      INSERT INTO brainsnn_brand_outcomes (workspace_id, record_id, payload, created_at, updated_at)
      VALUES (:'workspace', :'record_id', :'payload'::jsonb, COALESCE((:'payload'::jsonb->>'savedAt')::timestamptz, NOW()), NOW())
      ON CONFLICT (workspace_id, record_id)
      DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW();
    `, { workspace, record_id: record.id, payload });
    return 'postgres';
  } catch (error) {
    if (!fallbackAllowed()) throw error;
    const records = fallbackRecords(workspace).filter((item) => item?.id !== record.id);
    memoryFallback.set(workspace, [record, ...records].slice(0, MAX_RECORDS_PER_WORKSPACE));
    return 'memory-fallback';
  }
}

async function deleteRecord(workspace, recordId) {
  try {
    await ensureTable();
    await psql(`DELETE FROM brainsnn_brand_outcomes WHERE workspace_id = :'workspace' AND record_id = :'record_id';`, { workspace, record_id: recordId });
    return 'postgres';
  } catch (error) {
    if (!fallbackAllowed()) throw error;
    memoryFallback.set(workspace, fallbackRecords(workspace).filter((item) => item?.id !== recordId));
    return 'memory-fallback';
  }
}

function registerBrandBrainMiddleware(app) {
  const parseJson = originalExpress.json({ limit: '256kb' });
  app.use(API_PREFIX, parseJson, async (req, res, next) => {
    if (!allowRequest(req)) {
      json(res, 429, { ok: false, error: 'Too many Brand Brain requests. Try again shortly.' });
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    const workspace = workspaceFromRequest(req, res);
    try {
      if (req.method === 'GET' && req.path === '/status') {
        let database = 'unconfigured';
        if (process.env.DATABASE_URL) {
          try {
            await ensureTable();
            database = 'postgres';
          } catch {
            database = fallbackAllowed() ? 'memory-fallback' : 'unavailable';
          }
        }
        json(res, 200, { ok: true, storage: database, persistence: database === 'postgres' ? 'server-persistent' : 'ephemeral', workspace: 'httpOnly-cookie' });
        return;
      }
      if (req.method === 'GET' && req.path === '/outcomes') {
        const result = await listRecords(workspace);
        json(res, 200, { ok: true, ...result });
        return;
      }
      if (req.method === 'POST' && req.path === '/outcomes') {
        const storage = await upsertRecord(workspace, req.body?.record);
        json(res, 200, { ok: true, storage, record: req.body.record });
        return;
      }
      if (req.method === 'DELETE' && req.path.startsWith('/outcomes/')) {
        const recordId = decodeURIComponent(req.path.slice('/outcomes/'.length)).slice(0, 256);
        if (!recordId) {
          json(res, 400, { ok: false, error: 'Outcome record id is required.' });
          return;
        }
        const storage = await deleteRecord(workspace, recordId);
        json(res, 200, { ok: true, storage, id: recordId });
        return;
      }
      next();
    } catch (error) {
      console.error('[brand-brain]', error?.message || error);
      json(res, 503, { ok: false, error: 'Brand Brain persistence is temporarily unavailable.' });
    }
  });
}

function expressWrapper(...args) {
  const app = originalExpress(...args);
  registerBrandBrainMiddleware(app);
  return app;
}

Object.assign(expressWrapper, originalExpress);
require.cache[expressPath].exports = expressWrapper;
