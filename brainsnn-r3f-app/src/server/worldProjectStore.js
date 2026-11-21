import { createHash, randomBytes } from 'node:crypto';

export const PROJECT_LIMITS = Object.freeze({ projects: 100, sourcesPerProject: 128, sourceBytes: 524288,
  projectSourceBytes: 16777216, tenantSourceBytes: 134217728, recordsPerProject: 1000,
  eventsPerProject: 2000, keys: 100, requestsPerHour: 1200, requestBytes: 1048576, idempotencyKeys: 20000,
  idempotencyBytes: 67108864, objectSourceBytes: 2147483648, projectObjectBytes: 8589934592,
  tenantObjectBytes: 34359738368, uploadPartBytes: 4194304, activeSourceUploads: 4, sourceUploadSessions: 2000,
  sourceReadBytesPerHour: 8589934592 });
export const ROLE_SCOPES = Object.freeze({
  reader: ['project:read', 'processing:read'],
  editor: ['project:read', 'project:write', 'processing:read', 'processing:write'],
  reviewer: ['project:read', 'project:write', 'review:decide', 'processing:read', 'processing:write'],
  admin: ['project:read', 'project:write', 'review:decide', 'processing:read', 'processing:write', 'keys:manage'],
});
// What a workspace used each calendar month (UTC), for invoicing. Rate-limit buckets expire after a day;
// these rows are kept. Only these metrics are counted.
export const USAGE_METRICS = Object.freeze(['api_requests', 'processing_jobs_started', 'processing_upload_bytes', 'processing_artifact_bytes']);
export const usageMonth = time => new Date(time).toISOString().slice(0, 7);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const newId = prefix => `${prefix}_${randomBytes(12).toString('hex')}`;
export class ProjectError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export const bad = (message, code = 'invalid-input') => { throw new ProjectError(422, code, message); };
export const json = value => typeof value === 'string' ? JSON.parse(value) : value;
export const iso = value => value instanceof Date ? value.toISOString() : value;
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS brainsnn_world_tenants (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, disabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL, limits JSONB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_actors (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), id TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('reader','editor','reviewer','admin')), created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id,id))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_keys (
    tenant_id TEXT NOT NULL, id TEXT NOT NULL, actor_id TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
    scopes JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL, created_by TEXT,
    PRIMARY KEY (tenant_id,id), FOREIGN KEY (tenant_id,actor_id) REFERENCES brainsnn_world_actors(tenant_id,id))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_projects (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), id TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
    current_as_is_revision_id TEXT, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id,id))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_sources (
    tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
    media_type TEXT NOT NULL, data_base64 TEXT NOT NULL, sha256 TEXT NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes > 0), created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id,project_id,id), FOREIGN KEY (tenant_id,project_id) REFERENCES brainsnn_world_projects(tenant_id,id))`,
  // Additive, repeatable upgrades preserve the earlier inline source contract.
  `ALTER TABLE brainsnn_world_sources ALTER COLUMN data_base64 DROP NOT NULL`,
  `ALTER TABLE brainsnn_world_sources ALTER COLUMN bytes TYPE BIGINT`,
  `ALTER TABLE brainsnn_world_sources ADD COLUMN IF NOT EXISTS storage_kind TEXT NOT NULL DEFAULT 'inline'`,
  `ALTER TABLE brainsnn_world_sources ADD COLUMN IF NOT EXISTS object_manifest JSONB`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_source_uploads (
    tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL,
    media_type TEXT NOT NULL, bytes BIGINT NOT NULL CHECK (bytes > 0), sha256 TEXT NOT NULL,
    part_bytes INTEGER NOT NULL, status TEXT NOT NULL, source_id TEXT,
    lease_id TEXT, lease_until TIMESTAMPTZ, created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, cleaned_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id,project_id,id),
    FOREIGN KEY (tenant_id,project_id) REFERENCES brainsnn_world_projects(tenant_id,id))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_source_parts (
    tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, upload_id TEXT NOT NULL, part_number INTEGER NOT NULL,
    bytes INTEGER NOT NULL CHECK (bytes > 0), sha256 TEXT NOT NULL, object_key TEXT NOT NULL,
    status TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id,project_id,upload_id,part_number),
    FOREIGN KEY (tenant_id,project_id,upload_id) REFERENCES brainsnn_world_source_uploads(tenant_id,project_id,id))`,
  `CREATE INDEX IF NOT EXISTS brainsnn_world_source_upload_cleanup ON brainsnn_world_source_uploads(status,expires_at)`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_source_reads (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), bucket BIGINT NOT NULL,
    bytes BIGINT NOT NULL CHECK (bytes > 0), PRIMARY KEY (tenant_id,bucket))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_records (
    tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('revision','evidence','change','trial')), payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id,project_id,id),
    FOREIGN KEY (tenant_id,project_id) REFERENCES brainsnn_world_projects(tenant_id,id))`,
  `CREATE INDEX IF NOT EXISTS brainsnn_world_records_kind ON brainsnn_world_records(tenant_id,project_id,kind)`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_events (
    tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, id TEXT NOT NULL, payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id,project_id,id),
    FOREIGN KEY (tenant_id,project_id) REFERENCES brainsnn_world_projects(tenant_id,id))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_idempotency (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), actor_id TEXT NOT NULL,
    request_key TEXT NOT NULL, fingerprint TEXT NOT NULL, status INTEGER NOT NULL, response JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id,actor_id,request_key))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_requests (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), key_id TEXT NOT NULL,
    bucket BIGINT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (tenant_id,key_id,bucket))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_security_events (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), id TEXT NOT NULL, payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (tenant_id,id))`,
  `CREATE TABLE IF NOT EXISTS brainsnn_world_usage_monthly (
    tenant_id TEXT NOT NULL REFERENCES brainsnn_world_tenants(id), month TEXT NOT NULL, metric TEXT NOT NULL,
    quantity BIGINT NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id,month,metric))`,
];

export function createWorldProjectStore({ pool, now = Date.now }) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.connect !== 'function') throw new Error('A PostgreSQL pool is required.');
  const time = () => new Date(now()).toISOString();
  async function transaction(fn) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
    catch (error) { try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
    finally { client.release(); }
  }
  async function initialize() { for (const statement of MIGRATIONS) await pool.query(statement); }
  async function tenant(client, tenantId, lock = false) {
    const row = (await client.query(`SELECT * FROM brainsnn_world_tenants WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [tenantId])).rows[0];
    if (!row || row.disabled) throw new ProjectError(403, 'tenant-unavailable', 'This workspace is unavailable.');
    return { ...row, limits: { ...PROJECT_LIMITS, ...json(row.limits) } };
  }
  async function provisionTenant({ name, id = newId('tenant'), limits = {} }, client = pool) {
    if (typeof name !== 'string' || !name.trim() || name.length > 160 || !/^[a-z][a-z0-9_-]{7,63}$/.test(id)) bad('Use a workspace name and a valid workspace ID.');
    if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) bad('Invalid workspace limits.');
    for (const [key, value] of Object.entries(limits)) if (!Object.hasOwn(PROJECT_LIMITS,key) || !Number.isSafeInteger(value) || value < 1 || value > PROJECT_LIMITS[key]) bad('Limits must be positive integers within the service caps.');
    const existing = (await client.query('SELECT id,name FROM brainsnn_world_tenants WHERE id=$1', [id])).rows[0];
    if (existing) { if (existing.name !== name.trim()) throw new ProjectError(409, 'tenant-exists', 'That workspace ID already has a different name.'); return existing; }
    const row = (await client.query('INSERT INTO brainsnn_world_tenants(id,name,created_at,limits) VALUES($1,$2,$3,$4::jsonb) RETURNING id,name,created_at', [id,name.trim(),time(),JSON.stringify(limits)])).rows[0];
    return { ...row, created_at: iso(row.created_at) };
  }
  async function provisionKey(input, givenClient = null, creator = null) {
    const perform = async client => {
      const { tenant_id, actor_name, actor_id, role = 'admin', scopes = ROLE_SCOPES[role], expires_at } = input;
      const owner = await tenant(client, tenant_id, true);
      if (!Object.hasOwn(ROLE_SCOPES,role) || typeof actor_name !== 'string' || !actor_name.trim() || actor_name.length > 120) bad('Choose a named principal and a supported role.');
      if (!Array.isArray(scopes) || !scopes.length || new Set(scopes).size !== scopes.length || scopes.some(scope => !ROLE_SCOPES[role].includes(scope))) bad('Scopes must be distinct permissions available to the assigned role.');
      if (expires_at !== undefined && (typeof expires_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(expires_at))) bad('Use an ISO timestamp for credential expiry.');
      const expiry = expires_at === undefined ? new Date(now() + 30 * 86400000) : new Date(expires_at);
      if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= now() || expiry.getTime() > now() + 366 * 86400000) bad('Key expiry must be in the next 366 days.');
      const count = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_keys WHERE tenant_id=$1', [tenant_id])).rows[0].n);
      if (count >= owner.limits.keys) throw new ProjectError(429, 'key-limit', 'This workspace reached its retained credential limit.');
      let actor;
      if (actor_id) {
        actor = (await client.query('SELECT id,name,role FROM brainsnn_world_actors WHERE tenant_id=$1 AND id=$2', [tenant_id,actor_id])).rows[0];
        if (!actor || actor.name !== actor_name.trim() || actor.role !== role) bad('Existing principal identity and role must match exactly.');
      } else {
        actor = { id: newId('actor'), name: actor_name.trim(), role };
        await client.query('INSERT INTO brainsnn_world_actors(tenant_id,id,name,role,created_at) VALUES($1,$2,$3,$4,$5)', [tenant_id,actor.id,actor.name,actor.role,time()]);
      }
      const token = `bsk_${randomBytes(32).toString('base64url')}`;
      const key = { id: newId('key'), actor_id: actor.id, actor_name: actor.name, role, scopes: [...scopes], expires_at: expiry.toISOString(), revoked_at: null, created_at: time() };
      await client.query('INSERT INTO brainsnn_world_keys(tenant_id,id,actor_id,digest,scopes,expires_at,created_at,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)', [tenant_id,key.id,actor.id,digest(token),JSON.stringify(scopes),key.expires_at,key.created_at,creator?.actor_id || actor.id]);
      await securityEvent(client, tenant_id, creator?.actor_id || actor.id, 'key.created', { key_id: key.id, principal_id: actor.id, role });
      return { key, token, token_available: true };
    };
    return givenClient ? perform(givenClient) : transaction(perform);
  }
  async function securityEvent(client, tenantId, actorId, type, detail) {
    const event = { id: newId('audit'), type, actor_id: actorId, at: time(), ...detail };
    await client.query('INSERT INTO brainsnn_world_security_events(tenant_id,id,payload,created_at) VALUES($1,$2,$3::jsonb,$4)', [tenantId,event.id,JSON.stringify(event),event.at]);
  }
  async function project(client, principal, id, lock = false) {
    const value = (await client.query(`SELECT * FROM brainsnn_world_projects WHERE tenant_id=$1 AND id=$2${lock ? ' FOR UPDATE' : ''}`, [principal.tenant_id,id])).rows[0];
    if (!value) throw new ProjectError(404, 'not-found', 'The project was not found.');
    return { ...value, created_at: iso(value.created_at), updated_at: iso(value.updated_at) };
  }
  async function record(client, principal, projectId, id, kind) {
    const value = (await client.query('SELECT payload FROM brainsnn_world_records WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND kind=$4', [principal.tenant_id,projectId,id,kind])).rows[0];
    if (!value) throw new ProjectError(404, 'not-found', `The ${kind} record was not found in this project.`);
    return json(value.payload);
  }
  async function addRecord(client, principal, projectId, kind, payload) {
    await client.query('INSERT INTO brainsnn_world_records(tenant_id,project_id,id,kind,payload,created_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)', [principal.tenant_id,projectId,payload.id,kind,JSON.stringify(payload),time()]);
    return payload;
  }
  async function updateRecord(client, principal, projectId, payload) {
    await client.query('UPDATE brainsnn_world_records SET payload=$4::jsonb WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [principal.tenant_id,projectId,payload.id,JSON.stringify(payload)]);
  }
  async function addEvent(client, principal, projectId, type, resourceId, detail = {}) {
    const event = { id: newId('event'), type, resource_id: resourceId, actor_id: principal.actor_id,
      actor_name: principal.actor_name, role: principal.role, at: time(), ...detail };
    await client.query('INSERT INTO brainsnn_world_events(tenant_id,project_id,id,payload,created_at) VALUES($1,$2,$3,$4::jsonb,$5)', [principal.tenant_id,projectId,event.id,JSON.stringify(event),event.at]);
    return event;
  }
  async function addUsage(client, tenantId, metric, quantity = 1) {
    if (!USAGE_METRICS.includes(metric)) throw new Error('Unknown usage metric.');
    const amount = Math.floor(Number(quantity));
    if (!Number.isSafeInteger(amount) || amount <= 0) return;
    await client.query(`INSERT INTO brainsnn_world_usage_monthly(tenant_id,month,metric,quantity) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,month,metric) DO UPDATE SET quantity=brainsnn_world_usage_monthly.quantity+EXCLUDED.quantity`,
      [tenantId, usageMonth(now()), metric, amount]);
  }
  async function monthUsage(client, tenantId, month = usageMonth(now())) {
    const rows = (await client.query('SELECT metric,quantity FROM brainsnn_world_usage_monthly WHERE tenant_id=$1 AND month=$2', [tenantId, month])).rows;
    return Object.fromEntries(USAGE_METRICS.map(metric => [metric, Number(rows.find(row => row.metric === metric)?.quantity || 0)]));
  }
  /** Every workspace's usage for one month, for the operator's invoice export. */
  async function usageReport(month = usageMonth(now())) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad('Use a month as YYYY-MM.');
    const rows = (await pool.query(`SELECT t.id AS tenant_id,t.name AS tenant_name,u.metric,u.quantity FROM brainsnn_world_tenants t
      JOIN brainsnn_world_usage_monthly u ON u.tenant_id=t.id AND u.month=$1 ORDER BY t.id`, [month])).rows;
    const byTenant = new Map();
    for (const row of rows) {
      const entry = byTenant.get(row.tenant_id) || { tenant_id: row.tenant_id, tenant_name: row.tenant_name, month, ...Object.fromEntries(USAGE_METRICS.map(metric => [metric, 0])) };
      if (USAGE_METRICS.includes(row.metric)) entry[row.metric] = Number(row.quantity);
      byTenant.set(row.tenant_id, entry);
    }
    return [...byTenant.values()];
  }
  return { pool, time, transaction, initialize, tenant, provisionTenant, provisionKey, securityEvent, project, record, addRecord, updateRecord, addEvent, addUsage, monthUsage, usageReport };
}
