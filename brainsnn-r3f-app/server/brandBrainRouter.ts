import express from 'express';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  BRAND_BRAIN_SCHEMA_VERSION,
  normalizeBrandName,
  normalizeMetricId,
  normalizeOutcomePayload,
} from '../src/lib/brandBrainContract.js';

const { Pool } = pg;
const MAX_IMPORT_RECORDS = 250;
const WORKSPACE_TOKEN_BYTES = 32;
const REQUEST_WINDOW_MS = 60_000;
const REQUESTS_PER_WINDOW = 120;

function id() {
  return crypto.randomUUID();
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeTokenEqual(a = '', b = '') {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function normalizedBrandKey(name: string) {
  return normalizeBrandName(name).toLocaleLowerCase('en-US');
}

function publicRecord(row: any) {
  return {
    id: row.outcome_id || row.id,
    brandId: row.brand_id,
    brandName: row.brand_name,
    creativeLabel: row.creative_label,
    metricId: row.metric_id,
    actualValue: Number(row.metric_value),
    savedAt: new Date(row.saved_at).toISOString(),
    sourceResultId: row.source_result_id || null,
    signature: row.signature_json || {},
    modelVersion: row.model_version || 'unknown',
    provenance: row.provenance_json || {},
  };
}

class UnavailableStore {
  mode = 'unavailable';
  configured = false;
  async ping() { return false; }
}

class PostgresStore {
  mode = 'postgres';
  configured = true;
  pool: any;
  initPromise: Promise<void> | null = null;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: Math.max(1, Math.min(10, Number(process.env.BRAND_BRAIN_DB_POOL_MAX) || 4)),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS brainsnn_workspaces (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS brainsnn_brands (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES brainsnn_workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          normalized_name TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(workspace_id, normalized_name)
        );
        CREATE TABLE IF NOT EXISTS brainsnn_creatives (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES brainsnn_workspaces(id) ON DELETE CASCADE,
          brand_id TEXT NOT NULL REFERENCES brainsnn_brands(id) ON DELETE CASCADE,
          source_result_id TEXT,
          creative_label TEXT NOT NULL,
          signature_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          model_version TEXT NOT NULL DEFAULT 'unknown',
          provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS brainsnn_outcomes (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES brainsnn_workspaces(id) ON DELETE CASCADE,
          brand_id TEXT NOT NULL REFERENCES brainsnn_brands(id) ON DELETE CASCADE,
          creative_id TEXT NOT NULL REFERENCES brainsnn_creatives(id) ON DELETE CASCADE,
          metric_id TEXT NOT NULL,
          metric_value DOUBLE PRECISION NOT NULL CHECK(metric_value >= 0),
          saved_at TIMESTAMPTZ NOT NULL,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS brainsnn_outcomes_workspace_brand_idx
          ON brainsnn_outcomes(workspace_id, brand_id, metric_id, saved_at DESC);
      `);
    })().catch((error) => {
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  async ping() {
    await this.init();
    await this.pool.query('SELECT 1');
    return true;
  }

  async createWorkspace(name: string, tokenHash: string) {
    await this.init();
    const workspaceId = id();
    await this.pool.query(
      'INSERT INTO brainsnn_workspaces(id, token_hash, name) VALUES($1,$2,$3)',
      [workspaceId, tokenHash, name],
    );
    return { workspaceId };
  }

  async verifyWorkspace(workspaceId: string, tokenHash: string) {
    await this.init();
    const { rows } = await this.pool.query(
      'SELECT token_hash FROM brainsnn_workspaces WHERE id = $1 LIMIT 1',
      [workspaceId],
    );
    return Boolean(rows[0]?.token_hash && safeTokenEqual(rows[0].token_hash, tokenHash));
  }

  async listBrands(workspaceId: string) {
    await this.init();
    const { rows } = await this.pool.query(
      'SELECT id, name, created_at FROM brainsnn_brands WHERE workspace_id=$1 ORDER BY name ASC',
      [workspaceId],
    );
    return rows.map((row: any) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
  }

  async ensureBrand(workspaceId: string, brandName: string) {
    await this.init();
    const normalized = normalizedBrandKey(brandName);
    const brandId = id();
    const { rows } = await this.pool.query(`
      INSERT INTO brainsnn_brands(id, workspace_id, name, normalized_name)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(workspace_id, normalized_name)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `, [brandId, workspaceId, brandName, normalized]);
    return rows[0];
  }

  async saveOutcome(workspaceId: string, input: any) {
    await this.init();
    const normalized = normalizeOutcomePayload(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const brand = await this.ensureBrandWithClient(client, workspaceId, normalized.brandName);
      const creativeId = id();
      const outcomeId = id();
      await client.query(`
        INSERT INTO brainsnn_creatives(
          id, workspace_id, brand_id, source_result_id, creative_label,
          signature_json, model_version, provenance_json
        ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
      `, [
        creativeId,
        workspaceId,
        brand.id,
        normalized.sourceResultId,
        normalized.creativeLabel,
        JSON.stringify(normalized.signature),
        normalized.modelVersion,
        JSON.stringify(normalized.provenance),
      ]);
      await client.query(`
        INSERT INTO brainsnn_outcomes(
          id, workspace_id, brand_id, creative_id, metric_id, metric_value, saved_at, metadata_json
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
      `, [
        outcomeId,
        workspaceId,
        brand.id,
        creativeId,
        normalized.metricId,
        normalized.actualValue,
        normalized.savedAt,
        JSON.stringify(normalized.legacyId ? { legacyId: normalized.legacyId } : {}),
      ]);
      await client.query('COMMIT');
      return {
        id: outcomeId,
        brandId: brand.id,
        brandName: brand.name,
        creativeLabel: normalized.creativeLabel,
        metricId: normalized.metricId,
        actualValue: normalized.actualValue,
        savedAt: normalized.savedAt,
        sourceResultId: normalized.sourceResultId,
        signature: normalized.signature,
        modelVersion: normalized.modelVersion,
        provenance: normalized.provenance,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async ensureBrandWithClient(client: any, workspaceId: string, brandName: string) {
    const normalized = normalizedBrandKey(brandName);
    const { rows } = await client.query(`
      INSERT INTO brainsnn_brands(id, workspace_id, name, normalized_name)
      VALUES($1,$2,$3,$4)
      ON CONFLICT(workspace_id, normalized_name)
      DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name
    `, [id(), workspaceId, brandName, normalized]);
    return rows[0];
  }

  async history(workspaceId: string, { brandName = '', metricId = '' } = {}) {
    await this.init();
    const values: any[] = [workspaceId];
    const filters = ['o.workspace_id = $1'];
    if (brandName) {
      values.push(normalizedBrandKey(brandName));
      filters.push(`b.normalized_name = $${values.length}`);
    }
    if (metricId) {
      values.push(normalizeMetricId(metricId));
      filters.push(`o.metric_id = $${values.length}`);
    }
    const { rows } = await this.pool.query(`
      SELECT o.id AS outcome_id, o.metric_id, o.metric_value, o.saved_at,
             b.id AS brand_id, b.name AS brand_name,
             c.creative_label, c.source_result_id, c.signature_json,
             c.model_version, c.provenance_json
      FROM brainsnn_outcomes o
      JOIN brainsnn_brands b ON b.id = o.brand_id
      JOIN brainsnn_creatives c ON c.id = o.creative_id
      WHERE ${filters.join(' AND ')}
      ORDER BY o.saved_at DESC
      LIMIT 1000
    `, values);
    return rows.map(publicRecord);
  }

  async deleteOutcome(workspaceId: string, outcomeId: string) {
    await this.init();
    const { rows } = await this.pool.query(`
      DELETE FROM brainsnn_outcomes
      WHERE workspace_id=$1 AND id=$2
      RETURNING creative_id
    `, [workspaceId, outcomeId]);
    if (!rows[0]) return false;
    await this.pool.query('DELETE FROM brainsnn_creatives WHERE workspace_id=$1 AND id=$2', [workspaceId, rows[0].creative_id]);
    return true;
  }

  async hasLegacyId(workspaceId: string, legacyId: string) {
    if (!legacyId) return false;
    const { rows } = await this.pool.query(`
      SELECT 1 FROM brainsnn_outcomes
      WHERE workspace_id=$1 AND metadata_json->>'legacyId'=$2
      LIMIT 1
    `, [workspaceId, legacyId]);
    return Boolean(rows[0]);
  }
}

class MemoryStore {
  mode = 'memory';
  configured = true;
  workspaces = new Map<string, any>();
  brands = new Map<string, any>();
  outcomes = new Map<string, any>();

  async ping() { return true; }
  async createWorkspace(name: string, tokenHash: string) {
    const workspaceId = id();
    this.workspaces.set(workspaceId, { id: workspaceId, name, tokenHash });
    return { workspaceId };
  }
  async verifyWorkspace(workspaceId: string, tokenHash: string) {
    const row = this.workspaces.get(workspaceId);
    return Boolean(row && safeTokenEqual(row.tokenHash, tokenHash));
  }
  async listBrands(workspaceId: string) {
    return [...this.brands.values()].filter((brand) => brand.workspaceId === workspaceId)
      .map((brand) => ({ id: brand.id, name: brand.name, createdAt: brand.createdAt }));
  }
  async ensureBrand(workspaceId: string, brandName: string) {
    const key = `${workspaceId}:${normalizedBrandKey(brandName)}`;
    if (!this.brands.has(key)) this.brands.set(key, { id: id(), workspaceId, name: brandName, createdAt: new Date().toISOString() });
    return this.brands.get(key);
  }
  async saveOutcome(workspaceId: string, input: any) {
    const normalized = normalizeOutcomePayload(input);
    const brand = await this.ensureBrand(workspaceId, normalized.brandName);
    const record = {
      id: id(), brandId: brand.id, brandName: brand.name,
      creativeLabel: normalized.creativeLabel, metricId: normalized.metricId,
      actualValue: normalized.actualValue, savedAt: normalized.savedAt,
      sourceResultId: normalized.sourceResultId, signature: normalized.signature,
      modelVersion: normalized.modelVersion, provenance: normalized.provenance,
      legacyId: normalized.legacyId, workspaceId,
    };
    this.outcomes.set(record.id, record);
    return record;
  }
  async history(workspaceId: string, { brandName = '', metricId = '' } = {}) {
    return [...this.outcomes.values()]
      .filter((record) => record.workspaceId === workspaceId)
      .filter((record) => !brandName || normalizedBrandKey(record.brandName) === normalizedBrandKey(brandName))
      .filter((record) => !metricId || record.metricId === normalizeMetricId(metricId))
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  }
  async deleteOutcome(workspaceId: string, outcomeId: string) {
    const record = this.outcomes.get(outcomeId);
    if (!record || record.workspaceId !== workspaceId) return false;
    this.outcomes.delete(outcomeId);
    return true;
  }
  async hasLegacyId(workspaceId: string, legacyId: string) {
    return [...this.outcomes.values()].some((record) => record.workspaceId === workspaceId && record.legacyId === legacyId);
  }
}

function createStore() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) return new PostgresStore(databaseUrl);
  if (process.env.NODE_ENV !== 'production' && process.env.BRAND_BRAIN_MEMORY_FALLBACK === '1') return new MemoryStore();
  return new UnavailableStore();
}

export function createBrandBrainRouter() {
  const router = express.Router();
  const store: any = createStore();
  const buckets = new Map<string, { resetAt: number; count: number }>();

  router.use((req, res, next) => {
    const key = String(req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) buckets.set(key, { resetAt: now + REQUEST_WINDOW_MS, count: 1 });
    else {
      bucket.count += 1;
      if (bucket.count > REQUESTS_PER_WINDOW) return res.status(429).json({ error: 'Brand Brain request limit reached. Try again shortly.' });
    }
    return next();
  });

  router.get('/status', async (_req, res) => {
    if (!store.configured) {
      return res.status(503).json({
        configured: false,
        status: 'unavailable',
        mode: 'unavailable',
        schemaVersion: BRAND_BRAIN_SCHEMA_VERSION,
        message: 'Server-backed Brand Brain persistence is not configured.',
      });
    }
    try {
      await store.ping();
      return res.json({ configured: true, status: 'ready', mode: store.mode, schemaVersion: BRAND_BRAIN_SCHEMA_VERSION });
    } catch {
      return res.status(503).json({ configured: true, status: 'error', mode: store.mode, schemaVersion: BRAND_BRAIN_SCHEMA_VERSION, message: 'Brand Brain persistence is configured but unavailable.' });
    }
  });

  router.post('/workspaces', async (req, res) => {
    if (!store.configured) return res.status(503).json({ error: 'Server-backed Brand Brain persistence is not configured.' });
    const name = String(req.body?.name || 'Pilot workspace').trim().slice(0, 80) || 'Pilot workspace';
    const token = crypto.randomBytes(WORKSPACE_TOKEN_BYTES).toString('base64url');
    try {
      const created = await store.createWorkspace(name, hashToken(token));
      return res.status(201).json({ workspaceId: created.workspaceId, token, tokenReturnedOnce: true });
    } catch {
      return res.status(503).json({ error: 'Could not create Brand Brain workspace.' });
    }
  });

  router.use(async (req: any, res, next) => {
    if (!store.configured) return res.status(503).json({ error: 'Server-backed Brand Brain persistence is not configured.' });
    const workspaceId = String(req.header('X-BrainSNN-Workspace') || '').trim();
    const auth = String(req.header('Authorization') || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!workspaceId || !token) return res.status(401).json({ error: 'Brand Brain workspace credential is required.' });
    try {
      const valid = await store.verifyWorkspace(workspaceId, hashToken(token));
      if (!valid) return res.status(401).json({ error: 'Invalid Brand Brain workspace credential.' });
      req.brandBrainWorkspaceId = workspaceId;
      return next();
    } catch {
      return res.status(503).json({ error: 'Brand Brain persistence is unavailable.' });
    }
  });

  router.get('/brands', async (req: any, res) => {
    try {
      return res.json({ brands: await store.listBrands(req.brandBrainWorkspaceId) });
    } catch {
      return res.status(503).json({ error: 'Could not load Brand Brain brands.' });
    }
  });

  router.post('/brands', async (req: any, res) => {
    const brandName = normalizeBrandName(req.body?.name);
    if (!brandName) return res.status(400).json({ error: 'Brand name is required.' });
    try {
      const brand = await store.ensureBrand(req.brandBrainWorkspaceId, brandName);
      return res.status(201).json({ brand: { id: brand.id, name: brand.name } });
    } catch {
      return res.status(503).json({ error: 'Could not save Brand Brain brand.' });
    }
  });

  router.get('/history', async (req: any, res) => {
    try {
      const brandName = normalizeBrandName(req.query?.brandName || '');
      const metricId = req.query?.metricId ? normalizeMetricId(req.query.metricId) : '';
      return res.json({ records: await store.history(req.brandBrainWorkspaceId, { brandName, metricId }) });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || 'Invalid Brand Brain history query.' });
    }
  });

  router.post('/outcomes', async (req: any, res) => {
    try {
      const record = await store.saveOutcome(req.brandBrainWorkspaceId, req.body || {});
      return res.status(201).json({ record });
    } catch (error: any) {
      const message = String(error?.message || 'Could not save Brand Brain outcome.');
      if (/required|unsupported|finite|valid date/i.test(message)) return res.status(400).json({ error: message });
      return res.status(503).json({ error: 'Could not save Brand Brain outcome.' });
    }
  });

  router.delete('/outcomes/:id', async (req: any, res) => {
    const outcomeId = String(req.params.id || '').slice(0, 160);
    if (!outcomeId) return res.status(400).json({ error: 'Outcome id is required.' });
    try {
      const removed = await store.deleteOutcome(req.brandBrainWorkspaceId, outcomeId);
      return removed ? res.status(204).end() : res.status(404).json({ error: 'Outcome not found.' });
    } catch {
      return res.status(503).json({ error: 'Could not remove Brand Brain outcome.' });
    }
  });

  router.post('/import-local', async (req: any, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, MAX_IMPORT_RECORDS) : null;
    if (!records) return res.status(400).json({ error: 'records must be an array.' });
    let imported = 0;
    let skipped = 0;
    for (const record of records) {
      try {
        const normalized = normalizeOutcomePayload(record);
        if (normalized.legacyId && await store.hasLegacyId(req.brandBrainWorkspaceId, normalized.legacyId)) {
          skipped += 1;
          continue;
        }
        await store.saveOutcome(req.brandBrainWorkspaceId, normalized);
        imported += 1;
      } catch {
        skipped += 1;
      }
    }
    return res.json({ imported, skipped, capped: records.length >= MAX_IMPORT_RECORDS });
  });

  return router;
}

export { MemoryStore, PostgresStore, hashToken };
