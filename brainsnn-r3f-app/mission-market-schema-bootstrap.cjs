'use strict';

const { spawnSync } = require('node:child_process');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log('[mission-market] schema bootstrap skipped: DATABASE_URL not configured');
  process.exit(0);
}

const sql = `
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
`;

const result = spawnSync(
  'psql',
  ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '-Atq', databaseUrl],
  { input: sql, encoding: 'utf8', timeout: 15_000 },
);

if (result.error || result.status !== 0) {
  const detail = String(result.stderr || result.error?.message || `psql exited ${result.status}`).trim().slice(0, 700);
  console.error(`[mission-market] schema bootstrap failed: ${detail}`);
  process.exit(1);
}

console.log('[mission-market] postgres schema ready');
