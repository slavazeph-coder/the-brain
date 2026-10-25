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

function marketError(message, httpStatus = 400) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  return error;
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

      CREATE TABLE IF NOT EXISTS brainsnn_mission_bounty_state (
        mission_id TEXT PRIMARY KEY REFERENCES brainsnn_published_missions(mission_id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'AWARDED')),
        winner_submission_id TEXT,
        winner_selected_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO brainsnn_mission_bounty_state (mission_id, status)
      SELECT mission_id, 'OPEN' FROM brainsnn_published_missions
      ON CONFLICT (mission_id) DO NOTHING;
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
      import('./src/features/missions/missionBounty.js'),
    ]).then(([builder, runtime, marketplace, bounty]) => ({ builder, runtime, marketplace, bounty }));
  }
  return missionModulesPromise;
}

function missionIdFor(configuration, workspace, bountyTerms) {
  const core = JSON.stringify({ configuration, workspace, bountyTerms });
  const digest = crypto.createHash('sha256').update(core).digest('hex').slice(0, 18);
  return `m-${digest}`;
}

function bountyStateSql() {
  return `(SELECT json_build_object(
    'status', bs.status,
    'winnerSubmissionId', bs.winner_submission_id,
    'winnerSelectedAt', bs.winner_selected_at,
    'paymentStatus', 'NOT_CONNECTED'
  ) FROM brainsnn_mission_bounty_state bs WHERE bs.mission_id = m.mission_id)`;
}

async function publicMission(record, workspace = null) {
  if (!record) return null;
  const { bounty } = await missionModules();
  const payload = record.payload || {};
  const terms = bounty.normalizeBountyTerms({
    ...(payload.bounty || {}),
    creatorLabel: payload.creator?.label || payload.bounty?.creatorLabel || 'Mission creator',
  });
  const state = bounty.normalizeBountyState(record.bountyState || {});
  const lifecycle = bounty.deriveBountyLifecycle(terms, state, Date.now());
  return {
    id: record.id,
    contract: payload.contract,
    configuration: payload.configuration,
    creator: { label: terms.creatorLabel },
    bounty: {
      ...terms,
      lifecycle,
      winnerSubmissionId: state.winnerSubmissionId,
      winnerSelectedAt: state.winnerSelectedAt,
      paymentStatus: state.paymentStatus,
    },
    createdAt: record.createdAt,
    submissionCount: Number(record.submissionCount || 0),
    isOwner: Boolean(workspace && workspace === record.authorWorkspace),
  };
}

async function loadMission(missionId) {
  await ensureTables();
  const raw = await psql(`
    SELECT row_to_json(x)::text FROM (
      SELECT mission_id AS id,
             author_workspace AS "authorWorkspace",
             payload,
             created_at AS "createdAt",
             (SELECT COUNT(*) FROM brainsnn_mission_submissions s WHERE s.mission_id = m.mission_id) AS "submissionCount",
             ${bountyStateSql()} AS "bountyState"
      FROM brainsnn_published_missions m
      WHERE mission_id = :'mission_id'
      LIMIT 1
    ) x;
  `, { mission_id: missionId });
  return raw ? JSON.parse(raw) : null;
}

async function listMissionRecords(whereSql = '', variables = {}, limit = MAX_MISSIONS_RETURNED) {
  await ensureTables();
  const raw = await psql(`
    SELECT COALESCE(json_agg(row_to_json(x)), '[]'::json)::text
    FROM (
      SELECT mission_id AS id,
             author_workspace AS "authorWorkspace",
             payload,
             created_at AS "createdAt",
             (SELECT COUNT(*) FROM brainsnn_mission_submissions s WHERE s.mission_id = m.mission_id) AS "submissionCount",
             ${bountyStateSql()} AS "bountyState"
      FROM brainsnn_published_missions m
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${Number(limit) || MAX_MISSIONS_RETURNED}
    ) x;
  `, variables);
  return JSON.parse(raw || '[]');
}

async function listMissions(workspace) {
  const records = await listMissionRecords();
  return Promise.all(records.map((record) => publicMission(record, workspace)));
}

async function listOwnedMissions(workspace) {
  const records = await listMissionRecords(`WHERE author_workspace = :'workspace'`, { workspace }, 100);
  return Promise.all(records.map((record) => publicMission(record, workspace)));
}

async function publishMission(workspace, draft, rawTerms) {
  const { builder, bounty } = await missionModules();
  const configuration = builder.normalizeMissionDraft(draft || {});
  const contract = builder.buildMissionContract(configuration);
  const terms = bounty.normalizeBountyTerms(rawTerms || {});
  if (terms.deadline && new Date(terms.deadline).getTime() <= Date.now()) {
    throw marketError('Mission deadline must be in the future.');
  }
  const id = missionIdFor(configuration, workspace, terms);
  const payload = JSON.stringify({
    schema: 'brainsnn.published_mission.v2',
    contract,
    configuration,
    creator: { label: terms.creatorLabel },
    bounty: terms,
  });
  await ensureTables();
  await psql(`
    INSERT INTO brainsnn_published_missions (mission_id, author_workspace, payload)
    VALUES (:'mission_id', :'workspace', :'payload'::jsonb)
    ON CONFLICT (mission_id) DO NOTHING;
    INSERT INTO brainsnn_mission_bounty_state (mission_id, status)
    VALUES (:'mission_id', 'OPEN')
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
  const entries = JSON.parse(raw || '[]');
  const mission = await loadMission(missionId);
  const winnerId = mission?.bountyState?.winnerSubmissionId || null;
  return entries.map((entry, index) => ({ ...entry, rank: index + 1, isWinner: entry.id === winnerId }));
}

async function loadStoredSubmission(missionId, submissionId) {
  await ensureTables();
  const raw = await psql(`
    SELECT json_build_object(
      'id', submission_id,
      'participant', participant,
      'policy', payload->'policy',
      'status', payload->>'status',
      'metrics', payload->'metrics',
      'proof', payload->'proof',
      'createdAt', created_at
    )::text
    FROM brainsnn_mission_submissions
    WHERE mission_id = :'mission_id' AND submission_id = :'submission_id'
    LIMIT 1;
  `, { mission_id: missionId, submission_id: submissionId });
  return raw ? JSON.parse(raw) : null;
}

async function submitMission(missionId, body) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  const { builder, runtime, marketplace, bounty } = await missionModules();
  const terms = bounty.normalizeBountyTerms(mission.payload?.bounty || {});
  const state = bounty.normalizeBountyState(mission.bountyState || {});
  if (!bounty.isMissionSubmissionOpen(terms, state, Date.now())) {
    throw marketError('Mission is not accepting submissions.', 409);
  }

  await ensureTables();
  const countText = await psql(`SELECT COUNT(*) FROM brainsnn_mission_submissions WHERE mission_id = :'mission_id';`, { mission_id: missionId });
  if ((Number(countText) || 0) >= MAX_SUBMISSIONS_PER_MISSION) throw marketError('Mission submission limit reached.', 409);

  const participant = cleanLabel(body?.participant, 'Anonymous');
  const policy = marketplace.normalizeSubmissionPolicy(body?.policy || {}, mission.payload.configuration);
  const configuration = marketplace.buildSubmissionConfiguration(mission.payload.configuration, policy);
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
  const submissionCore = JSON.stringify({ missionId, participant, policy, runIdentity: proof.runIdentity });
  const submissionId = `s-${crypto.createHash('sha256').update(submissionCore).digest('hex').slice(0, 18)}`;
  const payload = JSON.stringify({ policy, status: result.status, metrics: result.metrics, proof });
  await psql(`
    INSERT INTO brainsnn_mission_submissions (mission_id, submission_id, participant, payload)
    VALUES (:'mission_id', :'submission_id', :'participant', :'payload'::jsonb)
    ON CONFLICT (mission_id, submission_id) DO NOTHING;
  `, { mission_id: missionId, submission_id: submissionId, participant, payload });
  return loadStoredSubmission(missionId, submissionId);
}

async function submissionProof(missionId, submissionId) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  await ensureTables();
  const raw = await psql(`SELECT json_build_object('participant', participant, 'payload', payload)::text FROM brainsnn_mission_submissions WHERE mission_id = :'mission_id' AND submission_id = :'submission_id' LIMIT 1;`, { mission_id: missionId, submission_id: submissionId });
  if (!raw) return null;
  const stored = JSON.parse(raw);
  const { builder, runtime, marketplace } = await missionModules();
  const configuration = marketplace.buildSubmissionConfiguration(mission.payload.configuration, stored.payload.policy);
  const result = builder.runBuiltMission(configuration);
  const proofPack = await runtime.buildMissionProofPack(result, null, stored.payload.proof?.createdAt || null);
  return {
    missionId,
    submissionId,
    participant: stored.participant,
    publishedMission: await publicMission(mission),
    proofPack,
  };
}

function requireOwner(mission, workspace) {
  if (!mission || mission.authorWorkspace !== workspace) throw marketError('Only the mission creator can perform this action.', 403);
}

async function setMissionState(missionId, status, winnerSubmissionId = null) {
  await ensureTables();
  const selectedAt = status === 'AWARDED' ? new Date().toISOString() : '';
  await psql(`
    UPDATE brainsnn_mission_bounty_state
    SET status = :'status',
        winner_submission_id = ${status === 'AWARDED' ? `:'winner_submission_id'` : 'NULL'},
        winner_selected_at = ${status === 'AWARDED' ? `:'selected_at'::timestamptz` : 'NULL'},
        updated_at = NOW()
    WHERE mission_id = :'mission_id';
  `, {
    mission_id: missionId,
    status,
    winner_submission_id: winnerSubmissionId || '',
    selected_at: selectedAt,
  });
}

async function closeMission(missionId, workspace) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  requireOwner(mission, workspace);
  if (mission.bountyState?.status === 'AWARDED') throw marketError('Awarded missions cannot be closed again.', 409);
  await setMissionState(missionId, 'CLOSED');
  return loadMission(missionId);
}

async function reopenMission(missionId, workspace) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  requireOwner(mission, workspace);
  const { bounty } = await missionModules();
  const terms = bounty.normalizeBountyTerms(mission.payload?.bounty || {});
  if (mission.bountyState?.status === 'AWARDED') throw marketError('Awarded missions cannot be reopened.', 409);
  if (terms.deadline && new Date(terms.deadline).getTime() <= Date.now()) throw marketError('Expired missions cannot be reopened without publishing new terms.', 409);
  await setMissionState(missionId, 'OPEN');
  return loadMission(missionId);
}

async function selectWinner(missionId, workspace) {
  const mission = await loadMission(missionId);
  if (!mission) return null;
  requireOwner(mission, workspace);
  if (mission.bountyState?.status === 'AWARDED') throw marketError('This mission already has a selected winner.', 409);
  const { bounty } = await missionModules();
  const winner = bounty.pickVerifiedWinner(await leaderboard(missionId));
  if (!winner) throw marketError('No verified MISSION SUCCESS submission is eligible yet.', 409);
  await setMissionState(missionId, 'AWARDED', winner.id);
  return { mission: await loadMission(missionId), winner };
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
        return json(res, 200, {
          ok: true,
          storage: 'postgres',
          verification: 'server-recomputed',
          rewards: 'public-pledge-only',
          payments: 'not-connected',
        });
      }
      if (req.method === 'GET' && req.path === '/') {
        return json(res, 200, { ok: true, missions: await listMissions(workspace) });
      }
      if (req.method === 'GET' && req.path === '/mine') {
        return json(res, 200, { ok: true, missions: await listOwnedMissions(workspace) });
      }
      if (req.method === 'POST' && req.path === '/publish') {
        const mission = await publishMission(
          workspace,
          req.body?.configuration || req.body?.draft || {},
          req.body?.terms || {},
        );
        return json(res, 201, { ok: true, mission: await publicMission(mission, workspace), url: `/m/${mission.id}` });
      }

      const parts = req.path.split('/').filter(Boolean);
      const missionId = cleanId(parts[0]);
      if (!missionId || !missionId.startsWith('m-')) return next();

      if (req.method === 'GET' && parts.length === 1) {
        const mission = await loadMission(missionId);
        if (!mission) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 200, { ok: true, mission: await publicMission(mission, workspace) });
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
      if (req.method === 'POST' && parts[1] === 'owner' && parts[2] === 'close' && parts.length === 3) {
        const mission = await closeMission(missionId, workspace);
        if (!mission) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 200, { ok: true, mission: await publicMission(mission, workspace) });
      }
      if (req.method === 'POST' && parts[1] === 'owner' && parts[2] === 'reopen' && parts.length === 3) {
        const mission = await reopenMission(missionId, workspace);
        if (!mission) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 200, { ok: true, mission: await publicMission(mission, workspace) });
      }
      if (req.method === 'POST' && parts[1] === 'owner' && parts[2] === 'select-winner' && parts.length === 3) {
        const result = await selectWinner(missionId, workspace);
        if (!result) return json(res, 404, { ok: false, error: 'Mission not found.' });
        return json(res, 200, {
          ok: true,
          mission: await publicMission(result.mission, workspace),
          winner: { ...result.winner, isWinner: true },
          leaderboard: await leaderboard(missionId),
        });
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
      const status = Number(error?.httpStatus) || 503;
      if (status >= 500) console.error('[mission-market]', error?.message || error);
      return json(res, status, { ok: false, error: error?.message || 'Mission marketplace is temporarily unavailable.' });
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
