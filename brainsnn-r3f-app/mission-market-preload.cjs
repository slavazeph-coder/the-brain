'use strict';

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const originalExpress = require('express');
const expressPath = require.resolve('express');

const API_PREFIX = '/api/v1/missions';
const COOKIE_NAME = 'brainsnn_mission_workspace';
const REQUESTS_PER_MINUTE = 90;
const MAX_PSQL_OUTPUT_BYTES = 3 * 1024 * 1024;
const PSQL_TIMEOUT_MS = 8_000;
const MAX_MISSIONS_RETURNED = 30;
const MAX_SUBMISSIONS_PER_MISSION = 2500;
const rateBuckets = new Map();
let tablesReady = false;
let tablesPromise = null;
let missionModulesPromise = null;

function json(res, status, payload) {
  res.status(status).type('application/json').send(JSON.stringify(payload));
}

function cleanToken(value) {
  return /^[a-zA-Z0-9_-]{16,128}$/.test(String(value || '')) ? String(value) : null;
}

function cleanId(value, maxLength = 80) {
  const cleaned = String(value || '').trim().slice(0, maxLength);
  return /^[a-zA-Z0-9_-]+$/.test(cleaned) ? cleaned : null;
}

function cleanLabel(value, fallback = 'Anonymous', maxLength = 80) {
  const cleaned = String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return cleaned || fallback;
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
  const args = ['--no-psqlrc', '--set=ON_ERROR_STOP=1'];
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${String(value)}`);
  args.push('-Atq', databaseUrl);

  return new Promise((resolve, reject) => {
    const child = spawn('psql', args, { stdio: ['pipe', 'pipe', 'pipe'], timeout: PSQL_TIMEOUT_MS });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, output = '') => {
      if (settled) return;
      settled = true;
      if (error) {
        error.message = `Mission marketplace database command failed: ${String(stderr || error.message).slice(0, 500)}`;
        reject(error);
        return;
      }
      resolve(String(output || '').trim());
    };
    child.on('error', (error) => finish(error));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > MAX_PSQL_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('psql output exceeded limit'));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (Buffer.byteLength(stderr, 'utf8') > MAX_PSQL_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finish(new Error('psql error output exceeded limit'));
      }
    });
    child.on('close', (code, signal) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(signal ? `psql terminated by ${signal}` : `psql exited with code ${code}`));
    });
    child.stdin.on('error', (error) => { if (error?.code !== 'EPIPE') finish(error); });
    child.stdin.end(`${String(sql || '')}\n`);
  });
}

async function ensureTables() {
  if (tablesReady) return;
  if (!tablesPromise) {
    tablesPromise = psql(`
      CREATE TABLE IF NOT EXISTS brainsnn_published_missions (
        mission_id TEXT PRIMARY KEY,
        author_workspace TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS brainsnn_published_missions_created_idx
        ON brainsnn_published_missions (created_at DESC);

      CREATE TABLE IF NOT EXISTS brainsnn_mission_submissions (
        mission_id TEXT NOT NULL REFERENCES brainsnn_published_missions(mission_id) ON DELETE CASCADE,
        submission_id TEXT NOT NULL,
        participant TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (mission_id, submission_id)
      );
      CREATE INDEX IF NOT EXISTS brainsnn_mission_submissions_rank_idx
        ON brainsnn_mission_submissions (mission_id, created_at DESC);
    `).then(() => { tablesReady = true; }).finally(() => { tablesPromise = null; });
  }
  await tablesPromise;
}

async function missionModules() {
  if (!missionModulesPromise) {
    missionModulesPromise = Promise.all([
      import('./src/features/missions/missionBuilder.js'),
      import('./src/features/missions/missionRuntime.js'),
      import('./src/features/missions/missionMarketplace.js'),
    ]).then(([builder, runtime, marketplace]) => ({ builder, runtime, marketplace }));
  }
  return missionModulesPromise;
}

function missionIdFor(configuration) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(configuration)).digest('hex').slice(0, 16);
  return `m-${digest}`;
}

function publicMission(record) {
  if (!record) return null;
  return {
    id: record.id,
    contract: record.contract,
    configuration: record.configuration,
    createdAt: record.createdAt,
    submissionCount: Number(record.submissionCount || 0),
  };
}

async function loadMission(missionId) {
  await ensureTables();
  const raw = await psql(`
    SELECT json_build_object(
      'id', mission_id,
      'contract', payload->'contract',
      'configuration', payload->'configuration',
      'createdAt', created_at,
      'submissionCount', (SELECT COUNT(*) FROM brainsnn_mission_submissions s WHERE s.mission_id = m.mission_id)
    )::text
    FROM brainsnn_published_missions m
    WHERE mission_id = :'mission_id'
    LIMIT 1;
  `, { mission_id: missionId });
  return raw ? JSON.parse(raw) : null;
}

async function listMissions() {
  await ensureTables();
  const raw = await psql(`
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json)::text
    FROM (
      SELECT mission_id AS id,
             payload->'contract' AS contract,
             payload->'configuration' AS configuration,
             created_at AS "createdAt",
             (SELECT COUNT(*) FROM brainsnn_mission_submissions s WHERE s.mission_id = m.mission_id) AS "submissionCount"
      FROM brainsnn_published_missions m
      ORDER BY created_at DESC
      LIMIT ${MAX_MISSIONS_RETURNED}
    ) x;
  `);
  return JSON.parse(raw || '[]');
}

async function publishMission(workspace, draft) {
  const { builder } = await missionModules();
  const configuration = builder.normalizeMissionDraft(draft || {});
  const contract = builder.buildMissionContract(configuration);
  const id = missionIdFor(configuration);
  const payload = JSON.stringify({ schema: 'brainsnn.published_mission.v1', contract, configuration });
  await ensureTables();
  await psql(`
    INSERT INTO brainsnn_published_missions (mission_id, author_workspace, payload)
    VALUES (:'mission_id', :'workspace', :'payload'::jsonb)
    ON CONFLICT (mission_id) DO NOTHING;
  `, { mission_id: id, workspace, payload });
  return loadMission(id);
}

function rankSql() {
  return `
    CASE payload->>'status'
      WHEN 'MISSION SUCCESS' THEN 0
      WHEN 'OBJECTIVE MISS' THEN 1
      ELSE 2
    END ASC,
    COALESCE((payload->'metrics'->>'boundaryViolations')::int, 999999) ASC,
    COALESCE((payload->'metrics'->>'improvementRate')::numeric, -999999) DESC,
    COALESCE((payload->'metrics'->>'qualityRate')::numeric, -999999) DESC,
    created_at ASC
  `;
}

async function leaderboard(missionId) {
  await ensureTables();
  const raw = await psql(`
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json)::text
    FROM (
      SELECT submission_id AS id,
             participant,
             payload->>'status' AS status,
             payload->'metrics' AS metrics,
             payload->'policy' AS policy,
             payload->'proof' AS proof,
             created_at AS "createdAt"
      FROM brainsnn_mission_submissions
      WHERE mission_id = :'mission_id'
      ORDER BY ${rankSql()}
      LIMIT 100
    ) x;
  `, { mission_id: missionId });
  return JSON.parse(raw || '[]').map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function submitMission(missionId, body) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  await ensureTables();
  const countText = await psql(`SELECT COUNT(*) FROM brainsnn_mission_submissions WHERE mission_id = :'mission_id';`, { mission_id: missionId });
  if ((Number(countText) || 0) >= MAX_SUBMISSIONS_PER_MISSION) throw new Error('Mission submission limit reached.');

  const { builder, runtime, marketplace } = await missionModules();
  const participant = cleanLabel(body?.participant, 'Anonymous');
  const policy = marketplace.normalizeSubmissionPolicy(body?.policy || {}, mission.configuration);
  const configuration = marketplace.buildSubmissionConfiguration(mission.configuration, policy);
  const result = builder.runBuiltMission(configuration);
  const createdAt = new Date().toISOString();
  const proofPack = await runtime.buildMissionProofPack(result, null, createdAt);
  const proof = {
    schema: proofPack.schema,
    runtime: proofPack.runtime,
    createdAt: proofPack.createdAt,
    runIdentity: proofPack.runIdentity,
    evidence: proofPack.evidence,
    claimBoundary: proofPack.claimBoundary,
  };
  const submissionCore = JSON.stringify({ missionId, participant, policy, status: result.status, metrics: result.metrics, proof });
  const submissionId = `s-${crypto.createHash('sha256').update(submissionCore).digest('hex').slice(0, 18)}`;
  const payload = JSON.stringify({ policy, status: result.status, metrics: result.metrics, proof });
  await psql(`
    INSERT INTO brainsnn_mission_submissions (mission_id, submission_id, participant, payload)
    VALUES (:'mission_id', :'submission_id', :'participant', :'payload'::jsonb)
    ON CONFLICT (mission_id, submission_id) DO NOTHING;
  `, { mission_id: missionId, submission_id: submissionId, participant, payload });
  return { id: submissionId, participant, policy, status: result.status, metrics: result.metrics, proof };
}

async function submissionProof(missionId, submissionId) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  await ensureTables();
  const raw = await psql(`SELECT json_build_object('participant', participant, 'payload', payload)::text FROM brainsnn_mission_submissions WHERE mission_id = :'mission_id' AND submission_id = :'submission_id' LIMIT 1;`, { mission_id: missionId, submission_id: submissionId });
  if (!raw) return null;
  const stored = JSON.parse(raw);
  const { builder, runtime, marketplace } = await missionModules();
  const configuration = marketplace.buildSubmissionConfiguration(mission.configuration, stored.payload.policy);
  const result = builder.runBuiltMission(configuration);
  const proofPack = await runtime.buildMissionProofPack(result, null, stored.payload.proof?.createdAt || null);
  return {
    missionId,
    submissionId,
    participant: stored.participant,
    publishedMission: publicMission(mission),
    proofPack,
  };
}

function registerMissionMarketplace(app) {
  const parseJson = originalExpress.json({ limit: '96kb' });
  app.use(API_PREFIX, parseJson, async (req, res, next) => {
    if (!allowRequest(req)) return json(res, 429, { ok: false, error: 'Too many mission requests. Try again shortly.' });
    res.setHeader('Cache-Control', 'no-store');
    const workspace = workspaceFromRequest(req, res);
    try {
      if (req.method === 'GET' && req.path === '/status') {
        await ensureTables();
        return json(res, 200, { ok: true, storage: 'postgres', verification: 'server-recomputed' });
      }
      if (req.method === 'GET' && req.path === '/') {
        const missions = await listMissions();
        return json(res, 200, { ok: true, missions });
      }
      if (req.method === 'POST' && req.path === '/publish') {
        const mission = await publishMission(workspace, req.body?.configuration || req.body?.draft || {});
        return json(res, 201, { ok: true, mission: publicMission(mission), url: `/m/${mission.id}` });
      }

      const parts = req.path.split('/').filter(Boolean);
      const missionId = cleanId(parts[0]);
      if (!missionId || !missionId.startsWith('m-')) return next();

      if (req.method === 'GET' && parts.length === 1) {
        const mission = await loadMission(missionId);
        if (!mission) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 200, { ok: true, mission: publicMission(mission) });
      }
      if (req.method === 'GET' && parts[1] === 'leaderboard' && parts.length === 2) {
        const mission = await loadMission(missionId);
        if (!mission) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 200, { ok: true, entries: await leaderboard(missionId) });
      }
      if (req.method === 'POST' && parts[1] === 'submissions' && parts.length === 2) {
        const submission = await submitMission(missionId, req.body || {});
        if (!submission) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 201, { ok: true, submission, leaderboard: await leaderboard(missionId) });
      }
      if (req.method === 'GET' && parts[1] === 'submissions' && parts[3] === 'proof' && parts.length === 4) {
        const submissionId = cleanId(parts[2]);
        if (!submissionId || !submissionId.startsWith('s-')) return json(res, 400, { ok: false, error: 'Invalid submission id.' });
        const proof = await submissionProof(missionId, submissionId);
        if (!proof) return json(res, 404, { ok: false, error: 'Submission not found.' });
        return json(res, 200, { ok: true, ...proof });
      }
      return next();
    } catch (error) {
      console.error('[mission-market]', error?.message || error);
      return json(res, 503, { ok: false, error: 'Mission marketplace is temporarily unavailable.' });
    }
  });
}

const previousFactory = require.cache[expressPath].exports;
function expressWrapper(...args) {
  const app = previousFactory(...args);
  registerMissionMarketplace(app);
  return app;
}
Object.assign(expressWrapper, previousFactory);
require.cache[expressPath].exports = expressWrapper;
