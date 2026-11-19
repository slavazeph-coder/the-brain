import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createWorldProjectStore, PROJECT_LIMITS, ROLE_SCOPES, ProjectError, bad, digest, newId, canonical, json, iso } from './worldProjectStore.js';

const ID = /^[a-z][a-z0-9_-]{7,63}$/;
const KEY = /^bsk_[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const safeObject = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function shape(value, fields, required = []) {
  if (!safeObject(value) || Object.keys(value).some(key => !fields.includes(key)) || required.some(key => !Object.hasOwn(value, key))) bad('The request contains missing or unsupported fields.');
  return value;
}
function text(value, name, maximum = 2000, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum || (!optional && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) bad(`Use valid ${name} text (maximum ${maximum} characters).`);
  return value.trim();
}
function identifier(value, label = 'record') { if (typeof value !== 'string' || !ID.test(value)) bad(`Invalid ${label} ID.`); return value; }
function selection(value, values, label) { if (!values.includes(value)) bad(`Choose a supported ${label}.`); return value; }
function ids(value, label, { minimum = 1, maximum = 32 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum || new Set(value).size !== value.length) bad(`Use ${minimum}–${maximum} distinct ${label} IDs.`);
  return value.map(v => identifier(v,label));
}
function finite(value, name, minimum = 0, maximum = 1000000) { if (!Number.isFinite(value) || value < minimum || value > maximum) bad(`Invalid ${name}.`); return value; }
function optionalValue(value, name) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return finite(value,name,-1e12,1e12);
  return text(value,name,1000);
}
function scope(principal, required) { if (!principal.scopes.includes(required)) throw new ProjectError(403,'forbidden',`This credential requires ${required}.`); }
function expected(body, project) { if (!Number.isSafeInteger(body.expected_version) || body.expected_version !== project.version) throw new ProjectError(409,'stale-version','The project changed. Reload it before submitting this action.'); }
function timestamp(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > now + 300000) bad('Use an ISO timestamp for when this trial occurred, no more than five minutes in the future.');
  return new Date(value).toISOString();
}
const publicSource = row => ({ id: row.id, name: row.name, media_type: row.media_type, sha256: row.sha256,
  bytes: Number(row.bytes), created_by: row.created_by, created_at: iso(row.created_at) });
function retainedSource(row) {
  const bytes=Buffer.from(row.data_base64,'base64');
  if(bytes.length!==Number(row.bytes)||bytes.toString('base64')!==row.data_base64||digest(bytes)!==row.sha256)throw new ProjectError(503,'source-integrity-failed','Retained source bytes failed their integrity check. The source was not exported.');
  return {...publicSource(row),data_base64:row.data_base64};
}
const publicProject = row => ({ id: row.id, title: row.title, description: row.description, version: row.version,
  current_as_is_revision_id: row.current_as_is_revision_id, created_by: row.created_by, created_at: iso(row.created_at), updated_at: iso(row.updated_at) });
const latestPhysical = (trials, revisionId) => trials.filter(t=>t.kind==='physical'&&t.revision_id===revisionId)
  .sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||(b.recorded_project_version||0)-(a.recorded_project_version||0))[0]||null;

async function readBody(req) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ProjectError(415,'unsupported-encoding','Send uncompressed JSON.');
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers['content-type'] || ''))) throw new ProjectError(415,'json-required','Send application/json.');
  if (Number(req.headers['content-length']) > PROJECT_LIMITS.requestBytes) throw new ProjectError(413,'request-too-large','This request exceeds the service limit.');
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > PROJECT_LIMITS.requestBytes) throw new ProjectError(413,'request-too-large','This request exceeds the service limit.');
    if (!safeObject(req.body)) bad('Send one JSON object.');
    return req.body;
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > PROJECT_LIMITS.requestBytes) throw new ProjectError(413,'request-too-large','This request exceeds the service limit.');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ProjectError(400,'invalid-json','Send a valid JSON object.'); }
  if (!safeObject(value)) bad('Send one JSON object.');
  return value;
}

/** Durable project/evidence records. No browser identity, filesystem or memory fallback grants authority. */
export function createWorldProjectService({ pool: suppliedPool, env = process.env, now = Date.now } = {}) {
  const enabled = env.WORLD_PROJECTS_ENABLED !== '0';
  const databaseUrl = env.WORLD_PROJECT_DATABASE_URL || env.DATABASE_URL;
  const ownPool = !suppliedPool && !!databaseUrl;
  const pool = suppliedPool || (ownPool ? new Pool({ connectionString: databaseUrl, max: 8, connectionTimeoutMillis: 5000, statement_timeout: 15000 }) : null);
  if (ownPool) pool.on('error', () => { console.warn('World project database connection became unavailable.'); });
  const store = pool ? createWorldProjectStore({ pool, now }) : null;
  let ready = null;
  let activeRequests = 0, activeAuthentications = 0;
  async function initialize() {
    if (!enabled || !store) throw new ProjectError(503,'storage-unavailable','Project storage is not configured.');
    if (!ready) ready = store.initialize().catch(error => { ready = null; throw error; });
    await ready;
  }
  async function authenticate(req, options = {}) {
    if(activeAuthentications>=32)throw new ProjectError(503,'service-busy','Project authentication is busy. Retry shortly.');
    activeAuthentications++;
    try {
    await initialize();
    const auth = req.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!KEY.test(token)) throw new ProjectError(401,'api-key-required','Connect with a named project API credential.');
    const row = (await pool.query(`SELECT k.id AS key_id,k.tenant_id,k.actor_id,k.scopes,k.expires_at,a.name AS actor_name,a.role,t.name AS tenant_name,t.limits
      FROM brainsnn_world_keys k JOIN brainsnn_world_actors a ON a.tenant_id=k.tenant_id AND a.id=k.actor_id
      JOIN brainsnn_world_tenants t ON t.id=k.tenant_id
      WHERE k.digest=$1 AND k.revoked_at IS NULL AND k.expires_at>$2 AND t.disabled=FALSE`, [digest(token),store.time()])).rows[0];
    if (!row) throw new ProjectError(401,'invalid-api-key','This project credential is invalid, expired or revoked.');
    const principal = { tenant_id: row.tenant_id, tenant_name: row.tenant_name, actor_id: row.actor_id,
      actor_name: row.actor_name, role: row.role, key_id: row.key_id, scopes: json(row.scopes),
      expires_at: iso(row.expires_at), limits: { ...PROJECT_LIMITS, ...json(row.limits) }, identity: 'operator-provisioned-key' };
    if (options.scope) scope(principal,options.scope);
    if (options.scopes) for (const required of options.scopes) scope(principal,required);
    if (options.meter === false) return principal;
    const bucket = Math.floor(now() / 3600000);
    const rate = await pool.query(`INSERT INTO brainsnn_world_requests(tenant_id,key_id,bucket,count) VALUES($1,$2,$3,1)
      ON CONFLICT(tenant_id,key_id,bucket) DO UPDATE SET count=brainsnn_world_requests.count+1
      WHERE brainsnn_world_requests.count<$4 RETURNING count`, [principal.tenant_id,principal.key_id,bucket,principal.limits.requestsPerHour]);
    if (!rate.rows.length) throw new ProjectError(429,'request-limit','This credential reached its hourly request limit.');
    await pool.query('DELETE FROM brainsnn_world_requests WHERE tenant_id=$1 AND key_id=$2 AND bucket<$3', [principal.tenant_id,principal.key_id,bucket-24]);
    return principal;
    } finally { activeAuthentications--; }
  }
  async function requireSources(client, principal, projectId, sourceIds) {
    for (const id of sourceIds) {
      const exists = await client.query('SELECT id FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [principal.tenant_id,projectId,id]);
      if (!exists.rows.length) throw new ProjectError(404,'source-not-found','A retained source was not found in this project.');
    }
  }
  async function aggregate(client, principal, projectId) {
    const p = await store.project(client,principal,projectId);
    const sources = (await client.query('SELECT id,name,media_type,sha256,bytes,created_by,created_at FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at,id', [principal.tenant_id,projectId])).rows.map(publicSource);
    const records = (await client.query('SELECT kind,payload FROM brainsnn_world_records WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at,id', [principal.tenant_id,projectId])).rows;
    const events = (await client.query("SELECT payload FROM brainsnn_world_events WHERE tenant_id=$1 AND project_id=$2 ORDER BY (payload->>'project_version')::integer,id", [principal.tenant_id,projectId])).rows.map(row => json(row.payload));
    const result = { ...publicProject(p), sources, revisions: [], evidence: [], changes: [], trials: [], events };
    const arrays = { revision: 'revisions', evidence: 'evidence', change: 'changes', trial: 'trials' };
    for (const row of records) result[arrays[row.kind]].push(json(row.payload));
    result.readiness = readiness(result);
    return result;
  }
  function readiness(project) {
    const measured = project.evidence.filter(e => e.revision_id === project.current_as_is_revision_id && e.kind === 'measured' && e.status === 'confirmed');
    const physical = project.trials.filter(t => t.kind === 'physical');
    const latest = latestPhysical(project.trials,project.current_as_is_revision_id);
    const pending = project.changes.filter(c => ['pending','approved','implemented'].includes(c.status));
    const stale = project.changes.filter(c => c.status === 'stale');
    const blockers = [];
    if (!project.sources.length) blockers.push({ code: 'no-retained-source', message: 'Retain source evidence for this site.' });
    if (!project.current_as_is_revision_id) blockers.push({ code: 'no-baseline', message: 'Record the current as-is revision.' });
    if (!measured.length) blockers.push({ code: 'no-reviewed-measurements', message: 'Review measurement evidence for the current as-is revision.' });
    if (!latest) blockers.push({ code: 'no-recorded-physical-pass', message: 'A physical trial for the current revision has not been recorded.' });
    else if (latest.outcome!=='pass') blockers.push({ code: 'latest-physical-trial-not-passed', message: `The latest physical trial for the current revision is ${latest.outcome}. Earlier passes do not resolve it.` });
    if(latest?.outcome==='pass'&&!latest.measurement_evidence_ids.some(id=>measured.some(e=>e.id===id)))blockers.push({code:'trial-measurements-unreviewed',message:'The latest physical trial has no linked, confirmed measurement evidence for this revision.'});
    if (pending.length) blockers.push({ code: 'change-review-outstanding', message: 'One or more changes still need a decision, implementation or verification.' });
    if (stale.length) blockers.push({ code: 'stale-changes', message: 'Earlier change decisions need review against the current evidence or baseline.' });
    return { state: !project.current_as_is_revision_id || !measured.length ? 'needs-evidence' : blockers.length ? 'review-required' : 'trial-recorded',
      blockers, counts: { sources: project.sources.length, revisions: project.revisions.length, evidence: project.evidence.length,
        confirmed_measured: measured.length, physical_trials: physical.length, failed_trials: project.trials.filter(t => t.outcome === 'fail').length,
        pending_changes: pending.length, stale_changes: stale.length },
      latest_physical_trial_id:latest?.id||null,
      meaning: 'Record completeness and operator attestations; not physical qualification or safety approval.', physical_validated: false, certified: false };
  }
  async function usage(client, principal) {
    const projects = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_projects WHERE tenant_id=$1', [principal.tenant_id])).rows[0].n);
    const source_bytes = Number((await client.query('SELECT COALESCE(sum(bytes),0) AS n FROM brainsnn_world_sources WHERE tenant_id=$1', [principal.tenant_id])).rows[0].n);
    const records = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_records WHERE tenant_id=$1', [principal.tenant_id])).rows[0].n);
    const keys = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_keys WHERE tenant_id=$1', [principal.tenant_id])).rows[0].n);
    return { usage: { projects, source_bytes, records, keys }, limits: principal.limits };
  }
  async function runIdempotent(principal, requestKey, path, body, fn) {
    if (typeof requestKey !== 'string' || !/^[A-Za-z0-9:_-]{16,128}$/.test(requestKey)) throw new ProjectError(400,'idempotency-key-required','Send an Idempotency-Key of 16–128 letters, numbers, colons, underscores or hyphens.');
    const fingerprint = digest(canonical({ method: 'POST', path, body }));
    return store.transaction(async client => {
      await store.tenant(client,principal.tenant_id,true);
      const active = await client.query('SELECT id FROM brainsnn_world_keys WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 AND revoked_at IS NULL AND expires_at>$4', [principal.tenant_id,principal.key_id,principal.actor_id,store.time()]);
      if (!active.rows.length) throw new ProjectError(401,'invalid-api-key','This credential was revoked or expired before the action.');
      const prior = (await client.query('SELECT fingerprint,status,response FROM brainsnn_world_idempotency WHERE tenant_id=$1 AND actor_id=$2 AND request_key=$3', [principal.tenant_id,principal.actor_id,requestKey])).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ProjectError(409,'idempotency-conflict','This Idempotency-Key was already used for another request.');
        const receipt=json(prior.response);
        const replay=receipt.kind==='project-mutation' ? {project:await aggregate(client,principal,receipt.project_id),
          ...(receipt.resource?{resource:receipt.resource}:{}),applied_version:receipt.applied_version} : receipt;
        return { status: prior.status, body: replay, replay: true };
      }
      const ledger = (await client.query('SELECT count(*) AS n,COALESCE(sum(octet_length(response::text)),0) AS bytes FROM brainsnn_world_idempotency WHERE tenant_id=$1', [principal.tenant_id])).rows[0];
      if (Number(ledger.n) >= principal.limits.idempotencyKeys) throw new ProjectError(429,'ledger-limit','This workspace reached its retained request ledger limit.');
      const result = await fn(client);
      if(result.body.project)result.body.applied_version=result.body.project.version;
      const persisted = result.body.project ? {kind:'project-mutation',project_id:result.body.project.id,
        applied_version:result.body.project.version,...(result.body.resource?{resource:result.body.resource}:{})}
        : result.body.token ? { ...result.body, token: undefined, token_available: false } : result.body;
      if(Number(ledger.bytes)+Buffer.byteLength(JSON.stringify(persisted))>principal.limits.idempotencyBytes)throw new ProjectError(429,'ledger-storage-limit','This workspace reached its retained request receipt storage limit.');
      await client.query('INSERT INTO brainsnn_world_idempotency(tenant_id,actor_id,request_key,fingerprint,status,response,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)', [principal.tenant_id,principal.actor_id,requestKey,fingerprint,result.status,JSON.stringify(persisted),store.time()]);
      return result;
    });
  }
  async function checkCapacity(client, principal, projectId, addingRecord) {
    const records = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_records WHERE tenant_id=$1 AND project_id=$2', [principal.tenant_id,projectId])).rows[0].n);
    const events = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_events WHERE tenant_id=$1 AND project_id=$2', [principal.tenant_id,projectId])).rows[0].n);
    if ((addingRecord && records >= principal.limits.recordsPerProject) || events >= principal.limits.eventsPerProject) throw new ProjectError(429,'project-record-limit','This project reached its retained record or history limit.');
  }
  async function bump(client, principal, projectId) {
    await client.query('UPDATE brainsnn_world_projects SET version=version+1,updated_at=$3 WHERE tenant_id=$1 AND id=$2', [principal.tenant_id,projectId,store.time()]);
  }
  async function staleChanges(client, principal, projectId, reason, filter = () => true) {
    const changes = (await client.query("SELECT payload FROM brainsnn_world_records WHERE tenant_id=$1 AND project_id=$2 AND kind='change'", [principal.tenant_id,projectId])).rows.map(row => json(row.payload));
    for (const change of changes) if (!['rejected','stale'].includes(change.status) && filter(change)) {
      change.status = 'stale'; change.stale_reason = reason; change.stale_at = store.time();
      await store.updateRecord(client,principal,projectId,change);
    }
  }
  async function mutateProject(client, principal, projectId, action, resourceId, body) {
    const project = await store.project(client,principal,projectId,true);
    expected(body,project); await checkCapacity(client,principal,projectId,!resourceId&&action!=='sources');
    let resource; let eventType;
    const by = { created_by: principal.actor_id, created_by_name: principal.actor_name, created_at: store.time() };
    if (action === 'sources') {
      scope(principal,'project:write');
      shape(body,['expected_version','name','media_type','content_text','data_base64','sha256'],['expected_version','name','media_type']);
      const name = text(body.name,'source name',160);
      if (typeof body.media_type !== 'string' || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(body.media_type) || body.media_type.length > 100) bad('Use a valid source media type without parameters.');
      if (Object.hasOwn(body,'content_text') === Object.hasOwn(body,'data_base64')) bad('Provide exactly one of content_text or data_base64.');
      let bytes;
      if (Object.hasOwn(body,'content_text')) { if (typeof body.content_text !== 'string') bad('Source content_text must be a string.'); bytes = Buffer.from(body.content_text,'utf8'); }
      else { if (typeof body.data_base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.data_base64)) bad('Use canonical base64 source bytes.'); bytes = Buffer.from(body.data_base64,'base64'); if (bytes.toString('base64') !== body.data_base64) bad('Use canonical base64 source bytes.'); }
      if (!bytes.length || bytes.length > principal.limits.sourceBytes) throw new ProjectError(413,'source-too-large','Each retained source must contain 1–524288 bytes.');
      const sha256 = digest(bytes);
      if (body.sha256 !== undefined && (typeof body.sha256 !== 'string' || !HASH.test(body.sha256) || body.sha256 !== sha256)) bad('Source bytes do not match the declared SHA-256.','source-hash-mismatch');
      const current = (await client.query('SELECT count(*) AS count,COALESCE(sum(bytes),0) AS bytes FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2', [principal.tenant_id,projectId])).rows[0];
      const total = Number((await client.query('SELECT COALESCE(sum(bytes),0) AS n FROM brainsnn_world_sources WHERE tenant_id=$1', [principal.tenant_id])).rows[0].n);
      if (Number(current.count) >= principal.limits.sourcesPerProject || Number(current.bytes)+bytes.length > principal.limits.projectSourceBytes || total+bytes.length > principal.limits.tenantSourceBytes) throw new ProjectError(429,'source-storage-limit','This project or workspace reached its retained source limit.');
      resource = { id: newId('src'), name, media_type: body.media_type.toLowerCase(), sha256, bytes: bytes.length, ...by };
      await client.query('INSERT INTO brainsnn_world_sources(tenant_id,project_id,id,name,media_type,data_base64,sha256,bytes,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [principal.tenant_id,projectId,resource.id,name,resource.media_type,bytes.toString('base64'),sha256,bytes.length,principal.actor_id,resource.created_at]);
      eventType = 'source.retained';
    } else if (action === 'revisions') {
      scope(principal,'project:write');
      shape(body,['expected_version','label','kind','source_ids','robot','task','parent_revision_id'],['expected_version','label','kind','source_ids','robot','task']);
      const kind = selection(body.kind,['as_is','proposed'],'revision kind');
      const sourceIds = ids(body.source_ids,'source'); await requireSources(client,principal,projectId,sourceIds);
      shape(body.robot,['model','width_m','margin_m'],['model']); shape(body.task,['kind','goal'],['kind','goal']);
      const robot = { model: text(body.robot.model,'robot model',160) };
      if (body.robot.width_m !== undefined) robot.width_m = finite(body.robot.width_m,'robot width',0.001,100);
      if (body.robot.margin_m !== undefined) robot.margin_m = finite(body.robot.margin_m,'robot margin',0,100);
      const parent = body.parent_revision_id === undefined || body.parent_revision_id === null ? null : identifier(body.parent_revision_id,'parent revision');
      if(kind==='proposed'&&!parent)bad('A proposed revision needs its as-is parent revision.');
      if (parent) { const parentRecord=await store.record(client,principal,projectId,parent,'revision');if(kind==='proposed'&&parentRecord.kind!=='as_is')bad('A proposed revision must name an as-is parent.'); }
      resource = { id: newId('rev'), label: text(body.label,'revision label',160), kind, source_ids: sourceIds,
        robot, task: { kind: text(body.task.kind,'task kind',80), goal: text(body.task.goal,'task goal',2000) }, parent_revision_id: parent,
        physical_validated: false, ...by };
      await store.addRecord(client,principal,projectId,'revision',resource);
      if (kind === 'as_is') {
        await client.query('UPDATE brainsnn_world_projects SET current_as_is_revision_id=$3 WHERE tenant_id=$1 AND id=$2', [principal.tenant_id,projectId,resource.id]);
        await staleChanges(client,principal,projectId,'The current as-is revision changed. Rebase and review a new change request.');
      }
      eventType = 'revision.recorded';
    } else if (action === 'evidence' && !resourceId) {
      scope(principal,'project:write');
      shape(body,['expected_version','revision_id','source_id','component_id','kind','claim','value','unit','locator','uncertainty','status'],['expected_version','revision_id','source_id','kind','claim','locator']);
      const revisionId = identifier(body.revision_id,'revision'), sourceId = identifier(body.source_id,'source');
      await store.record(client,principal,projectId,revisionId,'revision'); await requireSources(client,principal,projectId,[sourceId]);
      if (body.status !== undefined && body.status !== 'unreviewed') bad('New evidence is unreviewed. Use the explicit evidence review action.');
      shape(body.locator,['page','frame','time_seconds','note']); const locator = {};
      for (const name of ['page','frame']) if (body.locator[name] !== undefined) { if (!Number.isSafeInteger(body.locator[name]) || body.locator[name] < (name==='page'?1:0) || body.locator[name] > 1e8) bad('Invalid source locator.'); locator[name]=body.locator[name]; }
      if (body.locator.time_seconds !== undefined) locator.time_seconds=finite(body.locator.time_seconds,'source time',0,1e8);
      if (body.locator.note !== undefined) locator.note=text(body.locator.note,'locator note',1000);
      if (!Object.keys(locator).length) bad('Provide a page, frame, timestamp or source locator note.');
      resource = { id: newId('ev'), revision_id: revisionId, source_id: sourceId, component_id: body.component_id === undefined || body.component_id === null ? null : text(body.component_id,'component ID',160),
        kind: selection(body.kind,['measured','observed','inferred'],'evidence kind'), claim: text(body.claim,'evidence claim',2000),
        value: optionalValue(body.value,'evidence value'), unit: text(body.unit,'unit',80,true), locator,
        uncertainty: optionalValue(body.uncertainty,'uncertainty'), status: 'unreviewed', reviews: [], physical_validated: false, ...by };
      if(typeof resource.uncertainty==='number'&&resource.uncertainty<0)bad('Numeric uncertainty must be nonnegative.');
      if(resource.kind==='measured'&&(typeof resource.value!=='number'||!resource.unit))bad('Measured evidence requires a finite numeric value and its unit.');
      await store.addRecord(client,principal,projectId,'evidence',resource); eventType='evidence.recorded';
    } else if (action === 'evidence' && resourceId) {
      scope(principal,'review:decide');
      shape(body,['expected_version','decision','reason'],['expected_version','decision','reason']);
      resource = await store.record(client,principal,projectId,resourceId,'evidence');
      if(resource.reviews.length>=32)throw new ProjectError(429,'evidence-review-limit','This evidence item reached its review-history limit. Record a new evidence item with its source.');
      const decision = selection(body.decision,['confirmed','rejected'],'evidence review decision');
      const review = { id:newId('decision'), decision, reason:text(body.reason,'review reason',2000), actor_id:principal.actor_id,actor_name:principal.actor_name,at:store.time() };
      resource.reviews.push(review); resource.status=decision;
      await store.updateRecord(client,principal,projectId,resource);
      if (decision==='rejected') await staleChanges(client,principal,projectId,'Reviewed evidence was rejected. A new change review is required.', c => c.evidence_ids.includes(resource.id) || c.proposed_revision_id===resource.revision_id);
      eventType='evidence.reviewed';
    } else if (action === 'changes' && !resourceId) {
      scope(principal,'project:write');
      shape(body,['expected_version','base_revision_id','proposed_revision_id','title','reason','evidence_ids'],['expected_version','base_revision_id','proposed_revision_id','title','reason','evidence_ids']);
      const base = await store.record(client,principal,projectId,identifier(body.base_revision_id),'revision');
      const proposal = await store.record(client,principal,projectId,identifier(body.proposed_revision_id),'revision');
      if (base.kind!=='as_is'||proposal.kind!=='proposed'||base.id!==project.current_as_is_revision_id||base.id===proposal.id||(proposal.parent_revision_id&&proposal.parent_revision_id!==base.id)) throw new ProjectError(409,'revision-conflict','Use the current as-is baseline and its proposed revision.');
      const evidenceIds=ids(body.evidence_ids,'evidence');
      for (const id of evidenceIds) { const evidence=await store.record(client,principal,projectId,id,'evidence'); if (![base.id,proposal.id].includes(evidence.revision_id)) bad('Change evidence must refer to its base or proposed revision.'); }
      resource={id:newId('chg'),title:text(body.title,'change title',160),reason:text(body.reason,'change reason',2000),base_revision_id:base.id,proposed_revision_id:proposal.id,evidence_ids:evidenceIds,
        proposed_by:principal.actor_id,proposed_by_name:principal.actor_name,status:'pending',decisions:[],physical_validated:false,...by};
      await store.addRecord(client,principal,projectId,'change',resource);eventType='change.proposed';
    } else if (action === 'changes' && resourceId) {
      shape(body,['expected_version','decision','reason','trial_id'],['expected_version','decision','reason']);
      const decision=selection(body.decision,['approve','reject','implemented','verified'],'change decision');
      scope(principal,decision==='implemented'?'project:write':'review:decide');
      resource=await store.record(client,principal,projectId,resourceId,'change');
      if (resource.base_revision_id!==project.current_as_is_revision_id||resource.status==='stale') throw new ProjectError(409,'stale-change','The change no longer matches the current site baseline or evidence.');
      if (decision!=='implemented'&&resource.proposed_by===principal.actor_id) throw new ProjectError(403,'independent-review-required','A different named principal must review this change.');
      const permitted={approve:['pending'],reject:['pending','approved'],implemented:['approved'],verified:['implemented']};
      if (!permitted[decision].includes(resource.status)) throw new ProjectError(409,'invalid-transition','This decision is not available in the current change state.');
      if (decision==='approve'||decision==='verified') for(const id of resource.evidence_ids){const e=await store.record(client,principal,projectId,id,'evidence');if(e.status!=='confirmed')throw new ProjectError(409,'evidence-unreviewed','Confirm every referenced evidence item before approval or verification.');}
      let trialId=null;
      if (decision==='verified') {
        trialId=identifier(body.trial_id,'physical trial');const trial=await store.record(client,principal,projectId,trialId,'trial');
        if(trial.kind!=='physical'||trial.outcome!=='pass'||trial.revision_id!==resource.proposed_revision_id||!trial.measurement_evidence_ids.length)throw new ProjectError(409,'physical-trial-required','Record a passing physical trial and measured evidence for the exact proposed revision.');
        const implemented=resource.decisions.findLast(d=>d.decision==='implemented');
        if(!implemented||!(trial.recorded_project_version>implemented.project_version)||Date.parse(trial.occurred_at)<Date.parse(implemented.at))throw new ProjectError(409,'post-implementation-trial-required','Verification requires a physical trial that occurred and was recorded after the implementation decision.');
        const trials=(await client.query("SELECT payload FROM brainsnn_world_records WHERE tenant_id=$1 AND project_id=$2 AND kind='trial'",[principal.tenant_id,projectId])).rows.map(r=>json(r.payload));
        if(latestPhysical(trials,resource.proposed_revision_id)?.id!==trial.id)throw new ProjectError(409,'latest-physical-trial-required','Review the latest physical trial for this revision. An earlier pass cannot supersede a later outcome.');
        await requireSources(client,principal,projectId,trial.source_ids);
        for(const id of trial.measurement_evidence_ids){const e=await store.record(client,principal,projectId,id,'evidence');if(e.kind!=='measured'||e.status!=='confirmed'||e.revision_id!==trial.revision_id)throw new ProjectError(409,'measurement-review-required','Physical verification needs confirmed measured evidence on the same proposed revision.');}
      } else if(body.trial_id!==undefined&&body.trial_id!==null)bad('A trial reference is accepted only for verification.');
      const entry={id:newId('decision'),decision,reason:text(body.reason,'decision reason',2000),trial_id:trialId,actor_id:principal.actor_id,actor_name:principal.actor_name,role:principal.role,at:store.time(),project_version:project.version+1,attestation:'credential-holder-recorded',physical_validated:false};
      resource.decisions.push(entry);resource.status={approve:'approved',reject:'rejected',implemented:'implemented',verified:'verified'}[decision];
      await store.updateRecord(client,principal,projectId,resource);eventType=`change.${resource.status}`;
    } else if(action==='trials') {
      scope(principal,'project:write');
      shape(body,['expected_version','revision_id','robot_model','task','kind','outcome','prediction','source_ids','measurement_evidence_ids','notes','occurred_at'],['expected_version','revision_id','robot_model','task','kind','outcome','prediction','source_ids','notes','occurred_at']);
      const revisionId=identifier(body.revision_id,'revision');const revision=await store.record(client,principal,projectId,revisionId,'revision');
      const robotModel=text(body.robot_model,'robot model',160);if(robotModel!==revision.robot.model)bad('The trial robot must match its immutable revision profile.');
      const trialTask=text(body.task,'trial task',2000);if(trialTask!==revision.task.goal)bad('The trial task must exactly match its immutable revision goal. Record another revision for a different task.');
      const sourceIds=ids(body.source_ids,'source');await requireSources(client,principal,projectId,sourceIds);
      const measurementIds=ids(body.measurement_evidence_ids||[],'measurement evidence',{minimum:0});
      for(const id of measurementIds){const e=await store.record(client,principal,projectId,id,'evidence');if(e.revision_id!==revisionId||e.kind!=='measured')bad('Trial measurement evidence must be measured and bound to the same revision.');}
      resource={id:newId('trial'),revision_id:revisionId,robot_model:robotModel,task:trialTask,kind:selection(body.kind,['physical','simulation'],'trial kind'),
        outcome:selection(body.outcome,['pass','fail','inconclusive'],'trial outcome'),prediction:selection(body.prediction,['pass','fail','unknown'],'prediction'),source_ids:sourceIds,
        measurement_evidence_ids:measurementIds,notes:text(body.notes,'trial notes',4000),occurred_at:timestamp(body.occurred_at,now()),recorded_project_version:project.version+1,origin:'operator-reported',physical_validated:false,...by};
      resource.prediction_agreed=resource.prediction==='unknown'||resource.outcome==='inconclusive'?null:resource.prediction===resource.outcome;
      await store.addRecord(client,principal,projectId,'trial',resource);
      if(resource.kind==='physical'&&resource.outcome!=='pass'){
        const trials=(await client.query("SELECT payload FROM brainsnn_world_records WHERE tenant_id=$1 AND project_id=$2 AND kind='trial'",[principal.tenant_id,projectId])).rows.map(r=>json(r.payload));
        if(latestPhysical(trials,revisionId)?.id===resource.id)await staleChanges(client,principal,projectId,'A later physical trial did not pass. The recorded verification needs a new review.',c=>c.status==='verified'&&c.proposed_revision_id===revisionId);
      }
      eventType='trial.recorded';
    } else throw new ProjectError(404,'not-found','This project action was not found.');
    await bump(client,principal,projectId);
    await store.addEvent(client,principal,projectId,eventType,resource.id,{project_version:project.version+1});
    const receipt={...resource,...(resource.reviews?{reviews:resource.reviews.slice(-1)}:{}),...(resource.decisions?{decisions:resource.decisions.slice(-1)}:{})};
    return {status:resourceId?200:201,body:{project:await aggregate(client,principal,projectId),resource:receipt}};
  }
  async function dispatch(req, path, principal, body) {
    const method=req.method;
    if(method==='GET'&&path==='/me')return {status:200,body:{tenant:{id:principal.tenant_id,name:principal.tenant_name},actor:{id:principal.actor_id,name:principal.actor_name,role:principal.role},identity:principal.identity,scopes:principal.scopes,key:{id:principal.key_id,expires_at:principal.expires_at}}};
    if(method==='GET'&&path==='/usage'){scope(principal,'project:read');return {status:200,body:await usage(pool,principal)};}
    if(method==='GET'&&path==='/projects'){
      scope(principal,'project:read');const rows=(await pool.query('SELECT * FROM brainsnn_world_projects WHERE tenant_id=$1 ORDER BY updated_at DESC,id LIMIT 100',[principal.tenant_id])).rows;
      return {status:200,body:{projects:rows.map(publicProject)}};
    }
    if(path==='/keys'){
      scope(principal,'keys:manage');
      if(method==='GET'){
        const rows=(await pool.query(`SELECT k.id,k.actor_id,a.name AS actor_name,a.role,k.scopes,k.expires_at,k.revoked_at,k.created_at
          FROM brainsnn_world_keys k JOIN brainsnn_world_actors a ON a.tenant_id=k.tenant_id AND a.id=k.actor_id
          WHERE k.tenant_id=$1 ORDER BY k.created_at,k.id LIMIT 100`,[principal.tenant_id])).rows;
        return {status:200,body:{keys:rows.map(r=>({...r,scopes:json(r.scopes),expires_at:iso(r.expires_at),revoked_at:iso(r.revoked_at),created_at:iso(r.created_at)}))}};
      }
      if(method==='POST')return runIdempotent(principal,req.headers['idempotency-key'],path,body,async client=>{
        shape(body,['actor_name','actor_id','role','scopes','expires_at'],['actor_name','role']);
        return {status:201,body:await store.provisionKey({...body,tenant_id:principal.tenant_id},client,principal)};
      });
    }
    const keyMatch=path.match(/^\/keys\/([a-z0-9_-]+)\/revoke$/);
    if(method==='POST'&&keyMatch){scope(principal,'keys:manage');shape(body,[]);const id=identifier(keyMatch[1],'key');
      return runIdempotent(principal,req.headers['idempotency-key'],path,body,async client=>{
        const key=(await client.query('UPDATE brainsnn_world_keys SET revoked_at=COALESCE(revoked_at,$3) WHERE tenant_id=$1 AND id=$2 RETURNING id,actor_id,revoked_at',[principal.tenant_id,id,store.time()])).rows[0];
        if(!key)throw new ProjectError(404,'not-found','The credential was not found.');
        await store.securityEvent(client,principal.tenant_id,principal.actor_id,'key.revoked',{key_id:id});
        return {status:200,body:{key:{...key,revoked_at:iso(key.revoked_at)}}};
      });
    }
    if(method==='POST'&&path==='/projects'){
      scope(principal,'project:write');shape(body,['title','description'],['title']);
      return runIdempotent(principal,req.headers['idempotency-key'],path,body,async client=>{
        const current=await usage(client,principal);if(current.usage.projects>=principal.limits.projects)throw new ProjectError(429,'project-limit','This workspace reached its project limit.');
        const id=newId('proj'),title=text(body.title,'project title',160),description=text(body.description,'description',4000,true),at=store.time();
        await client.query('INSERT INTO brainsnn_world_projects(tenant_id,id,title,description,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)',[principal.tenant_id,id,title,description,principal.actor_id,at]);
        await store.addEvent(client,principal,id,'project.created',id,{project_version:1});
        return {status:201,body:{project:await aggregate(client,principal,id)}};
      });
    }
    const match=path.match(/^\/projects\/([a-z0-9_-]+)(?:\/(sources|revisions|evidence|changes|trials|export)(?:\/([a-z0-9_-]+)(?:\/(review|decisions))?)?)?$/);
    if(!match)throw new ProjectError(404,'not-found','This project endpoint was not found.');
    const projectId=identifier(match[1],'project'),action=match[2],resourceId=match[3]?identifier(match[3]):null,suffix=match[4];
    if(method==='GET'){
      scope(principal,'project:read');
      if(!action)return store.transaction(async client=>{await store.project(client,principal,projectId,true);return {status:200,body:{project:await aggregate(client,principal,projectId)}};});
      if(action==='sources'&&resourceId&&!suffix){
        await store.project(pool,principal,projectId);const source=(await pool.query('SELECT * FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2 AND id=$3',[principal.tenant_id,projectId,resourceId])).rows[0];
        if(!source)throw new ProjectError(404,'not-found','The source was not found.');
        const checked=retainedSource(source);return {status:200,body:{source:publicSource(source),data_base64:checked.data_base64}};
      }
      if(action==='export'&&!resourceId){
        return store.transaction(async client=>{
          await store.project(client,principal,projectId,true);
          const project=await aggregate(client,principal,projectId);
          const sources=(await client.query('SELECT * FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2 ORDER BY created_at,id',[principal.tenant_id,projectId])).rows.map(retainedSource);
          const value={schema:'brainsnn.project-export.v1',project,sources,exported_at:store.time(),physical_validated:false};
          return {status:200,body:{...value,integrity:{algorithm:'sha256',canonicalization:'sorted-object-keys-v1',sha256:digest(canonical(value)),authenticated_signature:false}}};
        });
      }
    }
    if(method==='POST'&&['sources','revisions','evidence','changes','trials'].includes(action)&&
      (!resourceId&&!suffix||(action==='evidence'&&resourceId&&suffix==='review')||(action==='changes'&&resourceId&&suffix==='decisions'))){
      if(!resourceId)scope(principal,'project:write');
      else if(action==='evidence')scope(principal,'review:decide');
      else if(action==='changes')scope(principal,body.decision==='implemented'?'project:write':'review:decide');
      return runIdempotent(principal,req.headers['idempotency-key'],path,body,client=>mutateProject(client,principal,projectId,action,resourceId,body));
    }
    throw new ProjectError(404,'not-found','This project endpoint was not found.');
  }
  async function handle(req,res,next=()=>{}) {
    let path;
    try{const url=new URL(req.url,'http://project.local');path=url.pathname;if(path.startsWith('/api/world/v1'))path=path.slice('/api/world/v1'.length)||'/';if(url.search)throw new ProjectError(400,'unsupported-query','This API does not accept query parameters.');}
    catch(error){if(error instanceof ProjectError)return sendError(res,error,randomUUID());return next();}
    const requestId=randomUUID();res.setHeader('X-Request-Id',requestId);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(activeRequests>=32)return sendError(res,new ProjectError(503,'service-busy','The project service is busy. Retry shortly.'),requestId);
    activeRequests++;
    try {
    if(path==='/status'&&req.method==='GET'){
      let available=false;try{await initialize();await pool.query('SELECT 1');available=true;}catch{/* unavailable storage never degrades into a memory store */}
      return send(res,200,{available,service:'world-projects',version:'v1',storage:'postgres',limits:PROJECT_LIMITS,identity:'operator-provisioned-key',physical_validated:false});
    }
      if(!['GET','POST'].includes(req.method))throw new ProjectError(405,'method-not-allowed','Use GET or POST for this API.');
      const principal=await authenticate(req);const body=req.method==='POST'?await readBody(req):undefined;
      const result=await dispatch(req,path,principal,body);if(result.replay)res.setHeader('Idempotency-Replayed','true');
      return send(res,result.status,result.body);
    }catch(error){return sendError(res,error,requestId);}finally{activeRequests--;}
  }
  function send(res,status,value){if(res.headersSent||res.destroyed)return;res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));}
  function sendError(res,error,requestId){
    const known=error instanceof ProjectError;const status=known?error.status:503;
    res.setHeader('X-Request-Id',requestId);res.setHeader('Cache-Control','no-store');
    if(status===429)res.setHeader('Retry-After','3600');
    if(error?.code==='service-busy')res.setHeader('Retry-After','1');
    send(res,status,{error:{code:known?error.code:'storage-unavailable',message:known?error.message:'Project storage is unavailable. The outcome may be unknown; reload the project or retry with the same Idempotency-Key.',request_id:requestId}});
  }
  return {handle,initialize,authenticate,runIdempotent,
    provisionTenant:async input=>{await initialize();return store.provisionTenant(input);},
    provisionKey:async input=>{await initialize();return store.provisionKey(input);},
    close:async()=>{if(ownPool&&pool)await pool.end();}, store};
}
