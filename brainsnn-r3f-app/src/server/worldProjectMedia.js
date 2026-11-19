import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { ProjectError, bad, canonical, digest, iso, json, newId } from './worldProjectStore.js';

const HASH = /^[a-f0-9]{64}$/;
const ACTIVE = ['uploading', 'verifying', 'ready', 'failed'];
const DAY = 86400000;
const LEASE = 5 * 60000;
const GRACE = 10 * 60000;
const SOURCE_SCHEMA = 'brainsnn.source-chunks.v1';

function contentType(value) {
  if (typeof value !== 'string' || value.length > 100 || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(value)) bad('Use a valid source media type without parameters.');
  return value.toLowerCase();
}

export function sourceDownloadPath(projectId, sourceId) {
  return `/api/world/v1/projects/${projectId}/sources/${sourceId}/content`;
}

export function validateSourceManifest(source) {
  const manifest = json(source.object_manifest);
  if (!manifest || manifest.schema !== SOURCE_SCHEMA || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > 512) {
    throw new ProjectError(503, 'source-integrity-failed', 'The retained source manifest failed its integrity check.');
  }
  let bytes = 0;
  let uploadPrefix;
  for (const [index, part] of manifest.parts.entries()) {
    const prefix = typeof part.key === 'string' ? part.key.match(/^(tenant\/[a-z0-9_-]+\/upload\/upload_[a-f0-9]{24})\/part\//)?.[1] : null;
    if (part.number !== index + 1 || !Number.isSafeInteger(part.bytes) || part.bytes < 1 || part.bytes > 4194304 ||
      !HASH.test(part.sha256 || '') || typeof part.key !== 'string' ||
      !prefix || !prefix.startsWith(`tenant/${source.tenant_id}/upload/`) || (uploadPrefix && prefix !== uploadPrefix) ||
      part.key !== `${prefix}/part/${part.number}_${part.sha256}`) {
      throw new ProjectError(503, 'source-integrity-failed', 'The retained source manifest failed its integrity check.');
    }
    uploadPrefix = prefix;
    bytes += part.bytes;
  }
  if (bytes !== Number(source.bytes) || !HASH.test(source.sha256 || '')) throw new ProjectError(503, 'source-integrity-failed', 'The retained source manifest size or digest is invalid.');
  return manifest;
}

/** Transfer state lives in PostgreSQL; private chunk bytes live in object storage.
 * A transfer does not become source evidence until every byte has been verified.
 */
export function createWorldProjectMedia(context) {
  const { store, objectStore, now, authenticate, runIdempotent, aggregate, checkCapacity, bump,
    publicSource, expected, shape, text, identifier, scope } = context;
  const pool = store?.pool;
  let active = 0;
  const perTenant = new Map();
  const configured = () => !!objectStore;
  const requireStorage = () => {
    if (!objectStore) throw new ProjectError(503, 'object-storage-unavailable', 'Large source storage is not configured. Small retained sources remain available.');
  };
  function admit(principal) {
    const count = perTenant.get(principal.tenant_id) || 0;
    if (active >= 8 || count >= 2) throw new ProjectError(503, 'transfer-busy', 'Source transfers are busy. Retry after the active transfer finishes.');
    active++; perTenant.set(principal.tenant_id, count + 1);
    return () => { active--; const left = (perTenant.get(principal.tenant_id) || 1) - 1; if (left) perTenant.set(principal.tenant_id, left); else perTenant.delete(principal.tenant_id); };
  }
  function live(upload) {
    if (upload.status !== 'retained' && Date.parse(upload.expires_at) <= now()) throw new ProjectError(410, 'upload-expired', 'This source upload expired. Start a new upload.');
    if (['aborted', 'expired'].includes(upload.status)) throw new ProjectError(410, 'upload-unavailable', 'This source upload is no longer available.');
    if (upload.status === 'failed') throw new ProjectError(409, 'upload-failed', 'This upload failed its integrity check. Cancel it and start a new upload.');
  }
  async function activeCredential(client, principal) {
    await store.tenant(client, principal.tenant_id, true);
    const row = await client.query('SELECT id FROM brainsnn_world_keys WHERE tenant_id=$1 AND id=$2 AND actor_id=$3 AND revoked_at IS NULL AND expires_at>$4', [principal.tenant_id, principal.key_id, principal.actor_id, store.time()]);
    if (!row.rows.length) throw new ProjectError(401, 'invalid-api-key', 'This credential was revoked or expired before the action.');
  }
  async function row(client, principal, projectId, uploadId, lock = false) {
    const result = (await client.query(`SELECT * FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND project_id=$2 AND id=$3${lock ? ' FOR UPDATE' : ''}`, [principal.tenant_id, projectId, uploadId])).rows[0];
    if (!result) throw new ProjectError(404, 'not-found', 'The source upload was not found in this project.');
    return result;
  }
  async function parts(client, principal, projectId, uploadId) {
    return (await client.query('SELECT * FROM brainsnn_world_source_parts WHERE tenant_id=$1 AND project_id=$2 AND upload_id=$3 ORDER BY part_number', [principal.tenant_id, projectId, uploadId])).rows;
  }
  function validatePartKeys(entries, tenantId, uploadId) {
    if (entries.some(p => !Number.isSafeInteger(p.part_number) || p.part_number < 1 || p.part_number > 512 || !HASH.test(p.sha256 || '') ||
      p.object_key !== `tenant/${tenantId}/upload/${uploadId}/part/${p.part_number}_${p.sha256}`)) {
      throw new ProjectError(503, 'source-integrity-failed', 'The source transfer contains an invalid object binding.');
    }
  }
  async function getUpload(client, principal, projectId, uploadId) {
    const upload = await row(client, principal, projectId, uploadId);
    const entries = await parts(client, principal, projectId, uploadId);
    return {
      id: upload.id, project_id: upload.project_id, name: upload.name, media_type: upload.media_type,
      bytes: Number(upload.bytes), sha256: upload.sha256, part_bytes: upload.part_bytes,
      part_count: Math.ceil(Number(upload.bytes) / upload.part_bytes),
      uploaded_bytes: entries.filter(p => p.status === 'stored').reduce((n, p) => n + Number(p.bytes), 0),
      parts: entries.map(p => ({ number: p.part_number, bytes: Number(p.bytes), sha256: p.sha256, status: p.status })),
      status: upload.status !== 'retained' && Date.parse(upload.expires_at) <= now() ? 'expired' : upload.status,
      source_id: upload.source_id || null, created_by: upload.created_by, created_at: iso(upload.created_at), expires_at: iso(upload.expires_at),
    };
  }
  async function usage(client, principal) {
    const objects = (await client.query("SELECT COALESCE(sum(bytes),0) AS n FROM brainsnn_world_sources WHERE tenant_id=$1 AND storage_kind='object'", [principal.tenant_id])).rows[0];
    const pending = (await client.query("SELECT count(*) AS n,COALESCE(sum(bytes),0) AS bytes FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND status IN ('uploading','verifying','ready','failed') AND expires_at>$2", [principal.tenant_id, store.time()])).rows[0];
    const reads = (await client.query('SELECT bytes FROM brainsnn_world_source_reads WHERE tenant_id=$1 AND bucket=$2', [principal.tenant_id, Math.floor(now() / 3600000)])).rows[0];
    return { object_source_bytes: Number(objects.n), reserved_object_bytes: Number(pending.bytes), active_source_uploads: Number(pending.n), source_read_bytes_this_hour: Number(reads?.bytes || 0) };
  }
  async function reserveRead(principal, bytes) {
    const bucket = Math.floor(now() / 3600000);
    if (bytes > principal.limits.sourceReadBytesPerHour) throw new ProjectError(429, 'source-read-limit', 'This source exceeds the workspace hourly transfer allowance.');
    const result = await pool.query(`INSERT INTO brainsnn_world_source_reads(tenant_id,bucket,bytes) VALUES($1,$2,$3)
      ON CONFLICT(tenant_id,bucket) DO UPDATE SET bytes=brainsnn_world_source_reads.bytes+EXCLUDED.bytes
      WHERE brainsnn_world_source_reads.bytes+EXCLUDED.bytes<=$4 RETURNING bytes`, [principal.tenant_id, bucket, bytes, principal.limits.sourceReadBytesPerHour]);
    if (!result.rows.length) throw new ProjectError(429, 'source-read-limit', 'This workspace reached its hourly source transfer allowance.');
    await pool.query('DELETE FROM brainsnn_world_source_reads WHERE tenant_id=$1 AND bucket<$2', [principal.tenant_id, bucket - 24]);
  }
  async function create(req, path, principal, projectId, body) {
    shape(body, ['expected_version', 'name', 'media_type', 'bytes', 'sha256'], ['expected_version', 'name', 'media_type', 'bytes', 'sha256']);
    const name = text(body.name, 'source name', 160), mediaType = contentType(body.media_type);
    if (!Number.isSafeInteger(body.bytes) || body.bytes < 1 || body.bytes > principal.limits.objectSourceBytes) throw new ProjectError(413, 'source-too-large', 'This file exceeds the workspace large-source limit.');
    if (Math.ceil(body.bytes / principal.limits.uploadPartBytes) > 512) throw new ProjectError(413, 'part-count-limit', 'This file exceeds the workspace maximum of 512 source parts.');
    if (!HASH.test(body.sha256 || '')) bad('Provide the SHA-256 of the complete original file.');
    return runIdempotent(principal, req.headers['idempotency-key'], path, body, async client => {
      requireStorage();
      const project = await store.project(client, principal, projectId, true); expected(body, project);
      const budget = await usage(client, principal);
      const sessions = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_source_uploads WHERE tenant_id=$1', [principal.tenant_id])).rows[0].n);
      const current = (await client.query("SELECT count(*) AS n,COALESCE(sum(CASE WHEN storage_kind='object' THEN bytes ELSE 0 END),0) AS bytes FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2", [principal.tenant_id, projectId])).rows[0];
      const reserved = (await client.query("SELECT count(*) AS n,COALESCE(sum(bytes),0) AS bytes FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND project_id=$2 AND status IN ('uploading','verifying','ready','failed') AND expires_at>$3", [principal.tenant_id, projectId, store.time()])).rows[0];
      if (budget.active_source_uploads >= principal.limits.activeSourceUploads || sessions >= principal.limits.sourceUploadSessions) throw new ProjectError(429, 'upload-limit', 'This workspace reached its active or retained source upload limit.');
      if (Number(current.n) + Number(reserved.n) >= principal.limits.sourcesPerProject ||
        Number(current.bytes) + Number(reserved.bytes) + body.bytes > principal.limits.projectObjectBytes ||
        budget.object_source_bytes + budget.reserved_object_bytes + body.bytes > principal.limits.tenantObjectBytes) throw new ProjectError(429, 'object-storage-limit', 'This project or workspace reached its reserved large-source storage limit.');
      const id = newId('upload'), at = store.time(), expires = new Date(now() + DAY).toISOString();
      await client.query(`INSERT INTO brainsnn_world_source_uploads(tenant_id,project_id,id,name,media_type,bytes,sha256,part_bytes,status,created_by,created_at,updated_at,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,'uploading',$9,$10,$10,$11)`, [principal.tenant_id, projectId, id, name, mediaType, body.bytes, body.sha256, principal.limits.uploadPartBytes, principal.actor_id, at, expires]);
      return { status: 201, body: { upload: await getUpload(client, principal, projectId, id) } };
    });
  }
  async function readPart(req, expectedBytes) {
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ProjectError(415, 'unsupported-encoding', 'Send uncompressed file bytes.');
    if (req.headers['content-type'] !== 'application/octet-stream') throw new ProjectError(415, 'binary-required', 'Send application/octet-stream file bytes.');
    if (!/^\d+$/.test(String(req.headers['content-length'] || '')) || Number(req.headers['content-length']) !== expectedBytes) throw new ProjectError(422, 'part-size-mismatch', 'The part must declare its exact expected Content-Length.');
    const chunks = []; let length = 0;
    const timer = setTimeout(() => req.destroy(), 60000); timer.unref?.();
    try {
      for await (const chunk of req) { length += chunk.length; if (length > expectedBytes) throw new ProjectError(413, 'part-too-large', 'The source part exceeded its declared length.'); chunks.push(chunk); }
      if (length !== expectedBytes) throw new ProjectError(422, 'part-size-mismatch', 'The source part was incomplete.');
      return Buffer.concat(chunks);
    } finally { clearTimeout(timer); }
  }
  async function uploadPart(req, principal, projectId, uploadId, number, signal) {
    requireStorage();
    const release = admit(principal);
    try {
      const initial = await row(pool, principal, projectId, uploadId); live(initial);
      const count = Math.ceil(Number(initial.bytes) / initial.part_bytes);
      if (!Number.isSafeInteger(number) || number < 1 || number > count) bad('Choose an existing source part number.');
      const length = number === count ? Number(initial.bytes) - (number - 1) * initial.part_bytes : initial.part_bytes;
      const declared = req.headers['x-content-sha256']; if (typeof declared !== 'string' || !HASH.test(declared)) bad('Send X-Content-SHA256 for this exact part.');
      const bytes = await readPart(req, length), sha256 = digest(bytes);
      if (sha256 !== declared) bad('Part bytes do not match X-Content-SHA256.', 'part-hash-mismatch');
      // Authenticate again after the slow client body. A revoked key cannot admit new bytes.
      await authenticate(req, { scope: 'project:write', meter: false });
      const pending = await store.transaction(async client => {
        await activeCredential(client, principal);
        const upload = await row(client, principal, projectId, uploadId, true); live(upload);
        const previous = (await client.query('SELECT * FROM brainsnn_world_source_parts WHERE tenant_id=$1 AND project_id=$2 AND upload_id=$3 AND part_number=$4', [principal.tenant_id, projectId, uploadId, number])).rows[0];
        if (previous && (previous.sha256 !== sha256 || Number(previous.bytes) !== length)) throw new ProjectError(409, 'part-conflict', 'This part already belongs to different bytes. Reselect the original file or start a new upload.');
        if (previous?.status === 'stored') return { ...previous, replay: true };
        if (upload.status !== 'uploading') throw new ProjectError(409, 'upload-state-conflict', 'This upload is already being verified or retained.');
        const key = `tenant/${principal.tenant_id}/upload/${uploadId}/part/${number}_${sha256}`;
        await client.query(`INSERT INTO brainsnn_world_source_parts(tenant_id,project_id,upload_id,part_number,bytes,sha256,object_key,status,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8) ON CONFLICT(tenant_id,project_id,upload_id,part_number) DO UPDATE SET updated_at=EXCLUDED.updated_at`, [principal.tenant_id, projectId, uploadId, number, length, sha256, key, store.time()]);
        await client.query('UPDATE brainsnn_world_source_uploads SET updated_at=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [principal.tenant_id, projectId, uploadId, store.time()]);
        return { object_key: key, replay: false };
      });
      if (!pending.replay) {
        // The reservation is committed before object IO, so a crash leaves a discoverable key.
        await objectStore.put(pending.object_key, bytes, { sha256, signal });
        await store.transaction(async client => {
          await activeCredential(client, principal);
          const upload = await row(client, principal, projectId, uploadId, true); live(upload);
          if (upload.status !== 'uploading') throw new ProjectError(409, 'upload-state-conflict', 'The upload state changed before this part was acknowledged.');
          await client.query("UPDATE brainsnn_world_source_parts SET status='stored',updated_at=$5 WHERE tenant_id=$1 AND project_id=$2 AND upload_id=$3 AND part_number=$4", [principal.tenant_id, projectId, uploadId, number, store.time()]);
        });
      }
      const upload = await getUpload(pool, principal, projectId, uploadId);
      return { status: 200, replay: pending.replay, body: { upload, part: upload.parts.find(p => p.number === number) } };
    } finally { release(); }
  }
  async function checkedPart(part, signal) {
    const result = await objectStore.get(part.key || part.object_key, { signal });
    const body = result.body;
    try {
      if (result.bytes !== Number(part.bytes)) throw new ProjectError(503, 'source-integrity-failed', 'A retained source part has an unexpected length.');
      let length = 0; const chunks = [];
      for await (const bytes of body) {
        if (signal?.aborted) throw new ProjectError(499, 'transfer-cancelled', 'The source transfer was cancelled.');
        length += bytes.length;
        if (length > Number(part.bytes) || length > 4194304) throw new ProjectError(503, 'source-integrity-failed', 'A retained source part exceeded its expected length.');
        chunks.push(Buffer.from(bytes));
      }
      const bytes = Buffer.concat(chunks);
      if (length !== Number(part.bytes) || digest(bytes) !== part.sha256) throw new ProjectError(503, 'source-integrity-failed', 'A retained source part failed its SHA-256 check.');
      return bytes;
    } finally { body?.destroy?.(); }
  }
  async function hasReceipt(principal, requestKey, path, body) {
    if (typeof requestKey !== 'string' || !/^[A-Za-z0-9:_-]{16,128}$/.test(requestKey)) throw new ProjectError(400, 'idempotency-key-required', 'Send an Idempotency-Key of 16–128 letters, numbers, colons, underscores or hyphens.');
    const prior = (await pool.query('SELECT fingerprint FROM brainsnn_world_idempotency WHERE tenant_id=$1 AND actor_id=$2 AND request_key=$3', [principal.tenant_id, principal.actor_id, requestKey])).rows[0];
    if (prior && prior.fingerprint !== digest(canonical({ method: 'POST', path, body }))) throw new ProjectError(409, 'idempotency-conflict', 'This Idempotency-Key was already used for another request.');
    return !!prior;
  }
  async function complete(req, path, principal, projectId, uploadId, body, signal) {
    shape(body, ['expected_version'], ['expected_version']);
    const requestKey = req.headers['idempotency-key'];
    const publish = () => runIdempotent(principal, requestKey, path, body, async client => {
      const project = await store.project(client, principal, projectId, true); expected(body, project);
      const upload = await row(client, principal, projectId, uploadId, true); live(upload);
      if (upload.status === 'retained') {
        const source = (await client.query('SELECT * FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [principal.tenant_id, projectId, upload.source_id])).rows[0];
        if (!source) throw new ProjectError(503, 'source-integrity-failed', 'The retained upload has no matching source record.');
        return { status: 200, body: { project: await aggregate(client, principal, projectId), resource: publicSource(source) } };
      }
      if (upload.status !== 'ready') throw new ProjectError(409, 'upload-not-ready', 'Verify all source parts before retaining the source.');
      await checkCapacity(client, principal, projectId, false);
      const count = Number((await client.query('SELECT count(*) AS n FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2', [principal.tenant_id, projectId])).rows[0].n);
      if (count >= principal.limits.sourcesPerProject) throw new ProjectError(429, 'source-storage-limit', 'This project reached its source limit.');
      const entries = await parts(client, principal, projectId, uploadId);
      const manifest = { schema: SOURCE_SCHEMA, parts: entries.map(p => ({ number: p.part_number, bytes: Number(p.bytes), sha256: p.sha256, key: p.object_key })) };
      const id = newId('src');
      const source = (await client.query(`INSERT INTO brainsnn_world_sources(tenant_id,project_id,id,name,media_type,data_base64,sha256,bytes,created_by,created_at,storage_kind,object_manifest)
        VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,'object',$10::jsonb) RETURNING *`, [principal.tenant_id, projectId, id, upload.name, upload.media_type, upload.sha256, upload.bytes, principal.actor_id, store.time(), JSON.stringify(manifest)])).rows[0];
      validateSourceManifest(source);
      await client.query("UPDATE brainsnn_world_source_uploads SET status='retained',source_id=$4,lease_id=NULL,lease_until=NULL,updated_at=$5 WHERE tenant_id=$1 AND project_id=$2 AND id=$3", [principal.tenant_id, projectId, uploadId, id, store.time()]);
      await bump(client, principal, projectId);
      await store.addEvent(client, principal, projectId, 'source.retained', id, { project_version: project.version + 1, storage_kind: 'object', upload_id: uploadId });
      return { status: 201, body: { project: await aggregate(client, principal, projectId), resource: publicSource(source) } };
    });
    if (await hasReceipt(principal, requestKey, path, body)) return publish();
    requireStorage(); const release = admit(principal); let lease;
    try {
      const plan = await store.transaction(async client => {
        await activeCredential(client, principal);
        const project = await store.project(client, principal, projectId, true); expected(body, project);
        const upload = await row(client, principal, projectId, uploadId, true); live(upload);
        if (['ready', 'retained'].includes(upload.status)) return { done: true };
        if (upload.status === 'verifying' && upload.lease_until && Date.parse(upload.lease_until) > now()) throw new ProjectError(409, 'upload-verifying', 'This upload is being verified. Read its status before retrying.');
        const entries = await parts(client, principal, projectId, uploadId);
        validatePartKeys(entries, principal.tenant_id, uploadId);
        const count = Math.ceil(Number(upload.bytes) / upload.part_bytes);
        if (entries.length !== count || entries.some((p, i) => p.status !== 'stored' || p.part_number !== i + 1 || Number(p.bytes) !== Math.min(upload.part_bytes, Number(upload.bytes) - i * upload.part_bytes))) throw new ProjectError(409, 'upload-incomplete', 'Upload every source part before completing the source.');
        lease = newId('lease');
        await client.query("UPDATE brainsnn_world_source_uploads SET status='verifying',lease_id=$4,lease_until=$5,updated_at=$6 WHERE tenant_id=$1 AND project_id=$2 AND id=$3", [principal.tenant_id, projectId, uploadId, lease, new Date(now() + LEASE).toISOString(), store.time()]);
        return { upload, entries };
      });
      if (!plan.done) {
        await reserveRead(principal, Number(plan.upload.bytes));
        const hash = createHash('sha256'); let length = 0;
        for (const entry of plan.entries) {
          if (signal?.aborted) throw new ProjectError(499, 'transfer-cancelled', 'Source verification was cancelled. Retry the same upload.');
          const bytes = await checkedPart(entry, signal); hash.update(bytes); length += bytes.length;
        }
        if (length !== Number(plan.upload.bytes) || hash.digest('hex') !== plan.upload.sha256) throw new ProjectError(422, 'source-hash-mismatch', 'The complete source does not match the original file SHA-256. Cancel this upload and start again.');
        await store.transaction(async client => {
          await activeCredential(client, principal);
          const upload = await row(client, principal, projectId, uploadId, true); live(upload);
          if (upload.status !== 'verifying' || upload.lease_id !== lease) throw new ProjectError(409, 'upload-state-conflict', 'This upload changed during verification. Reload its state.');
          await client.query("UPDATE brainsnn_world_source_uploads SET status='ready',lease_id=NULL,lease_until=NULL,updated_at=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3", [principal.tenant_id, projectId, uploadId, store.time()]);
        });
      }
      // No database transaction is held during network IO. A concurrent edit can
      // reject publication while preserving verified parts for an explicit retry.
      return await publish();
    } catch (error) {
      if (lease) {
        const failed = ['source-hash-mismatch', 'source-integrity-failed', 'object-integrity-failed', 'object-not-found'].includes(error.code);
        await pool.query("UPDATE brainsnn_world_source_uploads SET status=$5,lease_id=NULL,lease_until=NULL,updated_at=$6 WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND lease_id=$4 AND status='verifying'", [principal.tenant_id, projectId, uploadId, lease, failed ? 'failed' : 'uploading', store.time()]).catch(() => {});
      }
      throw error;
    } finally { release(); }
  }
  async function abort(req, path, principal, projectId, uploadId, body) {
    shape(body, []);
    return runIdempotent(principal, req.headers['idempotency-key'], path, body, async client => {
      const upload = await row(client, principal, projectId, uploadId, true);
      if (upload.status === 'retained') throw new ProjectError(409, 'source-already-retained', 'A retained source cannot be cancelled as an unfinished upload.');
      await client.query("UPDATE brainsnn_world_source_uploads SET status='aborted',lease_id=NULL,lease_until=NULL,updated_at=$4 WHERE tenant_id=$1 AND project_id=$2 AND id=$3", [principal.tenant_id, projectId, uploadId, store.time()]);
      return { status: 200, body: { upload: await getUpload(client, principal, projectId, uploadId) } };
    });
  }
  async function streamSource(req, res, principal, projectId, sourceId, signal) {
    const release = admit(principal);
    try {
      await store.project(pool, principal, projectId);
      const source = (await pool.query('SELECT * FROM brainsnn_world_sources WHERE tenant_id=$1 AND project_id=$2 AND id=$3', [principal.tenant_id, projectId, sourceId])).rows[0];
      if (!source) throw new ProjectError(404, 'not-found', 'The source was not found.');
      await reserveRead(principal, Number(source.bytes));
      let manifest, first;
      if (source.storage_kind === 'object') {
        requireStorage(); manifest = validateSourceManifest(source);
        first = await checkedPart(manifest.parts[0], signal);
      } else {
        first = Buffer.from(source.data_base64 || '', 'base64');
        if (first.length !== Number(source.bytes) || first.toString('base64') !== source.data_base64 || digest(first) !== source.sha256) throw new ProjectError(503, 'source-integrity-failed', 'The retained source failed its integrity check.');
      }
      await authenticate(req, { scope: 'project:read', meter: false });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(source.bytes));
      res.setHeader('X-Content-SHA256', source.sha256);
      res.setHeader('ETag', `"sha256-${source.sha256}"`);
      res.setHeader('Content-Disposition', `attachment; filename="source-${source.id}"; filename*=UTF-8''${encodeURIComponent(source.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
      const hash = createHash('sha256'); let length = first.length;
      hash.update(first);
      const write = async bytes => {
        if (signal.aborted || res.destroyed) throw new ProjectError(499, 'transfer-cancelled', 'The source download was cancelled.');
        if (!res.write(bytes)) await once(res, 'drain', { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
      };
      // Hold the last chunk until the whole-file digest passes. Otherwise a
      // client may receive the complete Content-Length before a late failure.
      let pending = first;
      for (const part of manifest?.parts.slice(1) || []) {
        await write(pending);
        pending = await checkedPart(part, signal);
        hash.update(pending); length += pending.length;
      }
      if (length !== Number(source.bytes) || hash.digest('hex') !== source.sha256) throw new ProjectError(503, 'source-integrity-failed', 'The retained source failed its complete SHA-256 check.');
      await write(pending);
      res.end(); return { streamed: true };
    } finally { release(); }
  }
  async function route(req, res, path, principal, body) {
    const transfer = path.match(/^\/projects\/([a-z0-9_-]+)\/source-uploads(?:\/([a-z0-9_-]+)(?:\/(complete|abort|parts)(?:\/([1-9][0-9]*))?)?)?$/);
    const download = path.match(/^\/projects\/([a-z0-9_-]+)\/sources\/([a-z0-9_-]+)\/content$/);
    if (!transfer && !download) return null;
    const projectId = identifier((transfer || download)[1], 'project');
    scope(principal, req.method === 'GET' ? 'project:read' : 'project:write');
    await store.project(pool, principal, projectId);
    const controller = new AbortController();
    const cancel = () => { if (!res.writableFinished) controller.abort(); };
    req.once('aborted', cancel); res.once('close', cancel);
    const timer = setTimeout(() => controller.abort(), download ? 3600000 : LEASE - 5000); timer.unref?.();
    try {
      if (download && req.method === 'GET') return await streamSource(req, res, principal, projectId, identifier(download[2], 'source'), controller.signal);
      if (!transfer) throw new ProjectError(405, 'method-not-allowed', 'Use GET for source content.');
      const uploadId = transfer[2] ? identifier(transfer[2], 'upload') : null, action = transfer[3];
      if (!uploadId && req.method === 'GET') {
        const rows = (await pool.query("SELECT id FROM brainsnn_world_source_uploads WHERE tenant_id=$1 AND project_id=$2 AND status IN ('uploading','verifying','ready','failed') AND expires_at>$3 ORDER BY created_at,id LIMIT 4", [principal.tenant_id, projectId, store.time()])).rows;
        const uploads = []; for (const row of rows) uploads.push(await getUpload(pool, principal, projectId, row.id));
        return { status: 200, body: { uploads } };
      }
      if (!uploadId && req.method === 'POST') return await create(req, path, principal, projectId, body);
      if (uploadId && !action && req.method === 'GET') return { status: 200, body: { upload: await getUpload(pool, principal, projectId, uploadId) } };
      if (action === 'parts' && transfer[4] && req.method === 'PUT') return await uploadPart(req, principal, projectId, uploadId, Number(transfer[4]), controller.signal);
      if (action === 'complete' && !transfer[4] && req.method === 'POST') return await complete(req, path, principal, projectId, uploadId, body, controller.signal);
      if (action === 'abort' && !transfer[4] && req.method === 'POST') return await abort(req, path, principal, projectId, uploadId, body);
      throw new ProjectError(404, 'not-found', 'This source transfer endpoint was not found.');
    } finally { clearTimeout(timer); req.off('aborted', cancel); res.off('close', cancel); }
  }
  async function cleanup({ apply = false, limit = 100 } = {}) {
    requireStorage();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) bad('Use a cleanup batch size from 1 to 200.');
    const cutoff = new Date(now() - GRACE).toISOString();
    const candidates = (await pool.query(`SELECT * FROM brainsnn_world_source_uploads
      WHERE status<>'retained' AND source_id IS NULL AND cleaned_at IS NULL
      AND ((status IN ('aborted','expired') AND updated_at<$1) OR expires_at<$1)
      AND (lease_until IS NULL OR lease_until<$2) ORDER BY created_at,id LIMIT $3`, [cutoff, store.time(), limit])).rows;
    const result = { apply, examined: candidates.length, cleaned: 0, failed: 0, uploads: [] };
    for (const upload of candidates) {
      const principal = { tenant_id: upload.tenant_id };
      const entries = await parts(pool, principal, upload.project_id, upload.id);
      result.uploads.push({ id: upload.id, project_id: upload.project_id, parts: entries.length, bytes: entries.reduce((n, p) => n + Number(p.bytes), 0) });
      if (!apply) continue;
      const lease = newId('cleanup');
      const claimed = await pool.query(`UPDATE brainsnn_world_source_uploads SET status='expired',lease_id=$4,lease_until=$5
        WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND status<>'retained' AND source_id IS NULL AND cleaned_at IS NULL
        AND (lease_until IS NULL OR lease_until<$6) RETURNING id`, [upload.tenant_id, upload.project_id, upload.id, lease, new Date(now() + LEASE).toISOString(), store.time()]);
      if (!claimed.rows.length) continue;
      try {
        validatePartKeys(entries, upload.tenant_id, upload.id);
        for (const entry of entries) await objectStore.delete(entry.object_key);
        await pool.query('UPDATE brainsnn_world_source_uploads SET cleaned_at=$5,lease_id=NULL,lease_until=NULL WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND lease_id=$4', [upload.tenant_id, upload.project_id, upload.id, lease, store.time()]);
        result.cleaned++;
      } catch {
        result.failed++;
        await pool.query('UPDATE brainsnn_world_source_uploads SET lease_id=NULL,lease_until=NULL WHERE tenant_id=$1 AND project_id=$2 AND id=$3 AND lease_id=$4', [upload.tenant_id, upload.project_id, upload.id, lease]);
      }
    }
    return result;
  }
  return { route, configured, getUpload, usage, cleanup };
}
