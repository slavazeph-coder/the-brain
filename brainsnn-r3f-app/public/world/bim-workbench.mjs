import {parsePLY, STRIDE, toArenaCloud} from './visual-geometry.mjs';

/** A bounded local project board. All processing states and artifacts come from the connected worker. */
export const BIM_WORKBENCH_SCHEMA = 'brainsnn.bim-workbench.v1';
export const BIM_LIMITS = Object.freeze({jobs: 48, projects: 16, sourceBytes: 64 * 1024 ** 2,
  cloudBytes: 16 * 1024 ** 2, storedBytes: 256 * 1024 ** 2, points: 50000, artifacts: 40});
export const BIM_REVIEW_CHECKS = Object.freeze(['scale', 'coverage', 'classification', 'exports']);
// A preparation precision budget, not an assertion about scan or reconstructed-model accuracy.
export const BIM_MAX_FLOAT32_SPACING_METRES = .001;
const REMOTE = new Set(['prepared', 'queued', 'running', 'complete', 'failed', 'cancelled']);
const ACTIVE = new Set(['uploading', 'creating', 'prepared', 'queued', 'running', 'cancelling']);
const LOCAL = new Set(['ready', 'interrupted', 'attention', ...REMOTE, ...ACTIVE]);
const TERMINAL = new Set(['complete', 'failed', 'cancelled']);
const HEX32 = /^[a-f0-9]{32}$/, HEX64 = /^[a-f0-9]{64}$/;
const text = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const copy = value => JSON.parse(JSON.stringify(value));
const uuid = () => crypto.randomUUID();
const stamp = () => new Date().toISOString();
const aborted = () => new DOMException('Observation stopped.', 'AbortError');
const emptyReview = () => ({reviewer: '', notes: '', checks: Object.fromEntries(BIM_REVIEW_CHECKS.map(k => [k, false])),
  status: 'pending', updatedAt: null, binding: null});
export async function bimHash(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
}

/** Conservative representable spacing in the original PLY coordinates after conversion to metres. */
export function bimPlyFloat32Spacing(points, metresPerUnit) {
  let largest = 0;
  for (let i = 0; i < points.length; i += STRIDE) for (let axis = 0; axis < 3; axis++) {
    const magnitude = Math.abs(points[i + axis]);
    const spacing = magnitude < 2 ** -126 ? 2 ** -149 : 2 ** (Math.floor(Math.log2(magnitude)) - 23);
    largest = Math.max(largest, spacing * metresPerUnit);
  }
  return largest;
}

/** Validate the portable scan hand-off before storing or uploading it. No source is declared verified. */
export function validateBimCloud(value) {
  if (!value || value.version !== 1 || value.kind !== 'survey-scan-point-cloud' || value.sourceFrame !== 'survey-scan' ||
      value.coordinateFrame !== 'right-handed-y-up' || value.units !== 'm')
    throw Error('Use a registered survey-scan arena-cloud.json in metres, or a registered PLY.');
  if (!Array.isArray(value.points) || !value.points.length || value.points.length > BIM_LIMITS.points)
    throw Error('The prepared scan must contain 1 to 50,000 points.');
  for (const row of value.points) if (!Array.isArray(row) || row.length !== 6 ||
      row.some(v => typeof v !== 'number' || !Number.isFinite(v)) ||
      row.slice(0, 3).some(v => Math.abs(v) > 1e7) || row.slice(3).some(v => v < 0 || v > 255))
    throw Error('Scan points must contain bounded finite x, y, z and RGB values.');
  const scale = value.scale;
  if (!scale || scale.source !== 'scan-file' || !Number.isFinite(scale.metresPerUnit) || scale.metresPerUnit <= 0 ||
      scale.selfReported !== true || scale.verified !== false || scale.distance != null || scale.spanUnits != null)
    throw Error('The scan must record declared scan-file units with selfReported true and verified false.');
  if (value.fromSource !== undefined && (!Array.isArray(value.fromSource) || value.fromSource.length !== 3 ||
      value.fromSource.some(r => !Array.isArray(r) || r.length !== 4 || r.some(v => !Number.isFinite(v) || Math.abs(v) > 1e7))))
    throw Error('The source transform must be a bounded 3 × 4 matrix.');
  const axes = [0, 2].map(axis => value.points.map(row => row[axis]).sort((a, b) => a - b));
  const at = (rows, q) => {const i = (rows.length - 1) * q, lo = Math.floor(i); return rows[lo] + (rows[Math.min(lo + 1, rows.length - 1)] - rows[lo]) * (i - lo);};
  const cells = axes.map(rows => Math.max(1, Math.ceil(at(rows, .98) / .5) - Math.floor(at(rows, .02) / .5)));
  if (cells[0] * cells[1] > 250000) throw Error('This scan exceeds the compiler footprint budget. Split the registered scan into smaller areas.');
  return value;
}

/** PLY preparation keeps the original file; the compiler receives a documented, bounded derived cloud. */
export async function prepareBimSource(file, {upAxis = 'z', metresPerUnit = 1, registrationConfirmed = false} = {}) {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > BIM_LIMITS.sourceBytes)
    throw Error('Choose a non-empty registered PLY up to 64 MiB, or a prepared JSON cloud up to 16 MiB.');
  if (!registrationConfirmed) throw Error('Confirm that each file is already registered and its units are known.');
  if (!['z', 'y'].includes(upAxis) || !Number.isFinite(metresPerUnit) || metresPerUnit < 1e-6 || metresPerUnit > 1000)
    throw Error('Choose the scan up axis and a valid metres-per-unit scale.');
  const name = text(file.name || 'registered-scan', 160), isJSON = /\.json$/i.test(name);
  if (!isJSON && !/\.ply$/i.test(name)) throw Error('For LAS, LAZ or E57, first use survey_cloud.py and add its arena-cloud.json.');
  if (isJSON && file.size > BIM_LIMITS.cloudBytes) throw Error('Prepared point-cloud JSON is limited to 16 MiB.');
  const buffer = await file.arrayBuffer(), sha256 = await bimHash(buffer);
  let cloud, preparation;
  if (isJSON) {
    try {cloud = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(buffer));}
    catch {throw Error('The prepared point cloud is not valid UTF-8 JSON.');}
    validateBimCloud(cloud);
    preparation = {method: 'prepared-survey-cloud', pointCount: cloud.points.length, upAxis: 'y',
      metresPerUnit: cloud.scale.metresPerUnit, provenance: cloud.provenance || {}};
  } else {
    let parsed;
    try {parsed = parsePLY(buffer, {maxPoints: BIM_LIMITS.points});}
    catch (error) {throw Error(`${error.message} For scanner coordinates outside the browser parser’s bounds, prepare with survey_cloud.py and import its arena-cloud.json.`);}
    if (parsed.kind !== 'point-cloud') throw Error('Use a registered xyz/rgb scan, not a Gaussian appearance PLY.');
    const float32SpacingMetres = bimPlyFloat32Spacing(parsed.points, metresPerUnit);
    if (float32SpacingMetres > BIM_MAX_FLOAT32_SPACING_METRES * (1 + 1e-12))
      throw Error(`These PLY coordinates exceed browser preparation precision: float32 spacing reaches ${(float32SpacingMetres * 1000).toFixed(3)} mm after unit conversion (limit 1 mm). Prepare the original scan with survey_cloud.py and import its arena-cloud.json to preserve coordinate precision.`);
    const points = parsed.points.slice();
    if (upAxis === 'z') for (let i = 0; i < points.length; i += STRIDE) {const y = points[i + 1]; points[i + 1] = points[i + 2]; points[i + 2] = -y;}
    cloud = toArenaCloud(points, {source: `Registered scan ${name}`.slice(0, 200), metresPerUnit}, BIM_LIMITS.points);
    // Compose the scanner-axis transform into the compiler hand-off. No registration is estimated here.
    if (upAxis === 'z') cloud.fromSource = cloud.fromSource.map(r => [r[0], -r[2], r[1], r[3]]);
    cloud.kind = 'survey-scan-point-cloud'; cloud.sourceFrame = 'survey-scan';
    cloud.scale = {source: 'scan-file', metresPerUnit, distance: null, spanUnits: null, selfReported: true, verified: false};
    cloud.provenance = {...cloud.provenance, originalPoints: parsed.total, retainedBeforeAlignment: points.length / STRIDE,
      parserSampleStep: parsed.parserMetadata.sampleStep, nonFiniteSkipped: parsed.skipped, float32Coordinates: true,
      float32SpacingMetres, metricVerified: false};
    preparation = {method: 'bounded-source-index-sampling-and-floor-alignment', sourcePoints: parsed.total,
      pointCount: cloud.points.length, upAxis, metresPerUnit, provenance: cloud.provenance};
    validateBimCloud(cloud);
  }
  // Never forward arbitrary top-level instructions from a local source file.
  const provenance = Object.fromEntries(Object.entries(cloud.provenance || {}).slice(0, 20).filter(([k, v]) => k.length <= 40 &&
    (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))));
  preparation.provenance = provenance;
  const output = {version: 1, kind: cloud.kind, units: 'm', coordinateFrame: cloud.coordinateFrame, sourceFrame: cloud.sourceFrame,
    source: text(cloud.source || name, 200), points: cloud.points, scale: cloud.scale,
    provenance: {...provenance, metricVerified: false},
    ...(cloud.floorEstimate ? {floorEstimate: cloud.floorEstimate} : {}), ...(cloud.fromSource ? {fromSource: cloud.fromSource} : {})};
  const uploadFile = new File([JSON.stringify(output)], 'arena-cloud.json', {type: 'application/json'});
  if (uploadFile.size > BIM_LIMITS.cloudBytes) throw Error('The prepared scan exceeded 16 MiB. Reduce the point count.');
  const cloudSha256 = await bimHash(await uploadFile.arrayBuffer());
  return {id: uuid(), original: file, uploadFile, evidence: {name, bytes: file.size, sha256,
    cloudName: uploadFile.name, cloudBytes: uploadFile.size, cloudSha256, preparation,
    registration: 'User declared already registered; no scan registration was performed.',
    units: 'Declared scan-file units; not independently verified.', metricVerified: false, createdAt: stamp()}};
}

export function bimWorkerCapacity(caps, requested = 1) {
  const engine = caps?.engines?.find(e => e.id === 'scene-usd' && e.available && e.input_kinds?.includes('cloud'));
  if (!engine || engine.registered_survey_cloud !== true)
    throw Error('Connect a worker with the registered survey-cloud scene compiler enabled.');
  if (engine.dimension_checks !== true || engine.bim_review !== true)
    throw Error('The connected scene compiler must support dimension checks and BIM review.');
  const limits = [caps?.limits?.concurrent_jobs ?? 1, caps?.owner_limits?.active_jobs ?? 1];
  if (limits.some(n => !Number.isSafeInteger(n) || n < 1)) throw Error('The worker did not advertise a valid job capacity.');
  return Math.min(3, Math.max(1, Math.trunc(Number(requested) || 1)), ...limits);
}

/** Metadata-only hand-off to the shared Saved projects chooser. It never includes source blobs or credentials. */
export function bimProjectSummary(report, projectId) {
  const project = report.projects.find(p => p.id === projectId); if (!project) throw Error('Choose a scan project first.');
  const jobs = report.jobs.filter(j => j.projectId === projectId);
  if (!jobs.length) throw Error('Add a registered scan to this project before saving its summary.');
  const summary = {schema: 'brainsnn.bim-project-summary.v1', exportedAt: stamp(), project: copy(project),
    scope: 'Registered scan project metadata, actual worker output identities and self-reported human review. Source files and credentials are excluded.',
    jobs: jobs.map(job => ({id: job.id, name: job.name, status: job.status, lastWorkerStatus: job.remoteStatus,
      workerJobId: job.remoteId, attempt: job.attempt, updatedAt: job.updatedAt, error: job.error,
      source: {name: job.source.name, bytes: job.source.bytes, sha256: job.source.sha256,
        prepared: {name: job.source.cloudName, bytes: job.source.cloudBytes, sha256: job.source.cloudSha256,
          pointCount: job.source.preparation.pointCount}, units: job.source.units, registration: job.source.registration},
      artifacts: job.artifacts.map(a => ({name: a.name, bytes: a.size, sha256: a.sha256})),
      review: {status: job.review.status, reviewer: job.review.reviewer, notes: job.review.notes, checks: job.review.checks,
        updatedAt: job.review.updatedAt, boundToThisSourceAndOutputSet: !!job.review.binding}, metricVerified: false}))};
  const content_text = JSON.stringify(summary, null, 2);
  if (new TextEncoder().encode(content_text).byteLength > 512 * 1024) throw Error('This project summary exceeds 512 KiB. Save the full manifest instead.');
  return {name: 'brainsnn-bim-project-summary.json', content_text};
}

function artifactList(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > BIM_LIMITS.artifacts) throw Error('The worker returned an invalid artifact manifest.');
  return artifacts.map(a => {
    if (!a || typeof a.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/.test(a.name) ||
        !Number.isSafeInteger(a.size) || a.size < 1 || !HEX64.test(a.sha256)) throw Error('A worker artifact is missing its size or integrity hash.');
    return {name: a.name, size: a.size, sha256: a.sha256,
      ...Object.fromEntries(['kind', 'representation', 'coordinate_frame', 'units'].filter(k => typeof a[k] === 'string').map(k => [k, text(a[k], 100)]))};
  });
}
function remoteJob(value, id = null) {
  if (!value || !HEX32.test(value.id) || (id && value.id !== id) || value.engine !== 'scene-usd' || !REMOTE.has(value.status))
    throw Error('The worker returned an inconsistent scene job.');
  return {id: value.id, engine: value.engine, status: value.status, artifacts: artifactList(value.artifacts || []), error: text(value.error),
    upload_ids: Array.isArray(value.upload_ids) ? value.upload_ids.filter(id => HEX32.test(id)).slice(0, 12) : []};
}
function blankBoard() {return {schema: BIM_WORKBENCH_SCHEMA, projects: [], jobs: [], requestedConcurrency: 1, updatedAt: stamp()};}
function recoveredBoard(raw) {
  if (!raw) return blankBoard();
  if (raw.schema !== BIM_WORKBENCH_SCHEMA || !Array.isArray(raw.projects) || raw.projects.length > BIM_LIMITS.projects ||
      !Array.isArray(raw.jobs) || raw.jobs.length > BIM_LIMITS.jobs) throw Error('The saved scan project board is incompatible or oversized.');
  const board = copy(raw);
  for (const p of board.projects) if (typeof p.id !== 'string' || typeof p.name !== 'string' || p.name.length > 120) throw Error('Invalid saved project.');
  for (const j of board.jobs) {
    if (typeof j.id !== 'string' || typeof j.sourceId !== 'string' || !board.projects.some(p => p.id === j.projectId) ||
        !LOCAL.has(j.status) || !HEX64.test(j.source?.sha256) || !HEX64.test(j.source?.cloudSha256) ||
        (j.remoteId && !HEX32.test(j.remoteId)) || (j.uploadId && !HEX32.test(j.uploadId))) throw Error('Invalid saved scan job.');
    j.artifacts = artifactList(j.artifacts || []);
    if (ACTIVE.has(j.status)) {j.status = j.status === 'creating' && !j.remoteId ? 'attention' : 'interrupted';
      j.error = j.status === 'attention' ? 'Job creation may have reached the worker. Check its status before another submission.' : 'Saved work recovered. Reconnect, then resume to check the worker.';}
    j.review ||= emptyReview();
  }
  return board;
}

/** The source blobs and manifest commit in one transaction. Credentials and download tickets never enter this store. */
export function createBimIndexedDBStore({name = 'brainsnn-bim-workbench-v1', indexedDB = globalThis.indexedDB} = {}) {
  let opened;
  const open = () => opened ||= new Promise((resolve, reject) => {
    if (!indexedDB) return reject(Error('Local project storage is unavailable in this browser.'));
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {const db = request.result; db.createObjectStore('manifest'); db.createObjectStore('sources', {keyPath: 'id'});};
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const tx = async (names, mode, fn) => {const db = await open(); return new Promise((resolve, reject) => {
    const transaction = db.transaction(names, mode); let result;
    transaction.oncomplete = () => resolve(result?.result); transaction.onerror = () => reject(transaction.error || Error('Project storage failed.'));
    transaction.onabort = () => reject(transaction.error || Error('Project storage was interrupted.'));
    try {result = fn(transaction);} catch (error) {transaction.abort(); reject(error);}
  });};
  return {
    load: () => tx(['manifest'], 'readonly', t => t.objectStore('manifest').get('board')),
    source: id => tx(['sources'], 'readonly', t => t.objectStore('sources').get(id)),
    save: (board, source) => tx(['manifest', 'sources'], 'readwrite', t => {if (source) t.objectStore('sources').put(source); return t.objectStore('manifest').put(board, 'board');}),
    clear: () => tx(['manifest', 'sources'], 'readwrite', t => {t.objectStore('sources').clear(); return t.objectStore('manifest').clear();}),
    close: async () => {if (opened) (await opened).close();},
  };
}

/** Injectable in-memory store for deterministic scheduler tests and non-persistent embedding. */
export function createBimMemoryStore() {
  let board = null; const sources = new Map();
  return {async load() {return board && copy(board);}, async source(id) {return sources.get(id);},
    async save(value, source) {board = copy(value); if (source) sources.set(source.id, source);},
    async clear() {board = null; sources.clear();}, async close() {}};
}
function sleep(ms, signal) {return new Promise((resolve, reject) => {
  if (signal.aborted) return reject(aborted());
  const stop = () => {clearTimeout(timer); reject(aborted());}, timer = setTimeout(() => {signal.removeEventListener('abort', stop); resolve();}, ms);
  signal.addEventListener('abort', stop, {once: true});
});}

export function createBimWorkbench({getConnection, store = createBimIndexedDBStore(), onChange = () => {},
  onComplete = () => {}, pollMs = 1200, now = stamp} = {}) {
  if (typeof getConnection !== 'function') throw Error('A processing connection is required.');
  let board = blankBoard(), paused = true, disposed = false, connection = null, capacity = 1, persistenceError = '', saving = Promise.resolve();
  const active = new Map(), contexts = new Map();
  const ready = store.load().then(value => {board = recoveredBoard(value); emit(); return report();});
  function report() {return {...copy(board), paused, capacity, activeCount: active.size, persistenceError};}
  function emit() {if (!disposed) onChange(report());}
  function save(source) {
    board.updatedAt = now(); const snapshot = copy(board);
    const operation = saving.then(() => store.save(snapshot, source));
    saving = operation.catch(error => {persistenceError = text(error.message); paused = true; emit();});
    return operation;
  }
  async function update(job, values) {Object.assign(job, values, {updatedAt: now()}); emit(); await save();}
  function getJob(id) {const job = board.jobs.find(j => j.id === id); if (!job) throw Error('Choose a saved scan job.'); return job;}
  function scope(client, caps, job = null) {
    const base = String(client?.base || '').replace(/\/$/, '');
    if (!/^https?:\/\//.test(base) || !caps?.owner_id) throw Error('Reconnect processing to identify this worker session.');
    if (job?.workerBase && (job.workerBase !== base || job.ownerId !== caps.owner_id))
      throw Error('Reconnect the original worker and account to resume this job.');
    return {workerBase: base, ownerId: String(caps.owner_id)};
  }
  async function current(job = null) {
    const c = await getConnection(); if (!c?.client || !c?.caps) throw Error('Connect processing before starting the queue.');
    scope(c.client, c.caps, job); return c;
  }
  async function addProject(name) {
    await ready; name = text(name, 120).trim(); if (!name) throw Error('Give the project a name.');
    if (board.projects.length >= BIM_LIMITS.projects) throw Error('This board holds up to 16 projects. Export and clear completed work first.');
    const project = {id: uuid(), name, createdAt: now()}; board.projects.push(project);
    try {await save();} catch (error) {board.projects.pop(); throw error;} emit(); return copy(project);
  }
  async function addSource(projectId, source) {
    await ready;
    if (!board.projects.some(p => p.id === projectId)) throw Error('Choose a project first.');
    if (board.jobs.length >= BIM_LIMITS.jobs) throw Error('This board holds up to 48 scans.');
    if (!source?.original || !source?.uploadFile || !HEX64.test(source.evidence?.sha256) || !HEX64.test(source.evidence?.cloudSha256)) throw Error('Prepare the registered source first.');
    const stored = board.jobs.reduce((n, j) => n + j.source.bytes + j.source.cloudBytes, 0);
    if (stored + source.original.size + source.uploadFile.size > BIM_LIMITS.storedBytes) throw Error('This board is limited to 256 MiB of local source files. Export and clear completed work first.');
    const job = {id: uuid(), projectId, sourceId: source.id, source: copy(source.evidence), name: text(source.evidence.name, 160),
      engine: 'scene-usd', status: 'ready', remoteStatus: null, remoteId: null, uploadId: null, workerBase: null, ownerId: null,
      progress: 0, attempt: 1, history: [], artifacts: [], review: emptyReview(), cancelRequested: false,
      error: '', createdAt: now(), updatedAt: now()};
    board.jobs.push(job);
    try {await save(source);} catch (error) {board.jobs.pop(); throw error;}
    emit(); pump(); return copy(job);
  }
  async function receive(job, raw, client) {
    const value = remoteJob(raw, job.remoteId);
    if (JSON.stringify(job.artifacts) !== JSON.stringify(value.artifacts)) job.review = emptyReview();
    await update(job, {remoteId: value.id, remoteStatus: value.status, status: value.status, artifacts: value.artifacts,
      error: value.error, ...(TERMINAL.has(value.status) ? {finishedAt: job.finishedAt || now(), cancelRequested: false} : {})});
    if (value.status === 'complete') {
      try {const context = await onComplete(value, client, {sourceNames: [job.source.name], sourceIds: [],
        sourceSha256: job.source.sha256, cloudSha256: job.source.cloudSha256, bimProjectId: job.projectId});
        contexts.set(job.id, {client, job: value, context});
      } catch (error) {job.presentationError = text(error.message); emit();}
    }
    return value;
  }
  async function reconcile(job, client) {
    if (job.remoteId) return remoteJob(await client.request(`/v1/jobs/${job.remoteId}`), job.remoteId);
    if (!job.uploadId) throw Error('No submitted job is recorded for this source.');
    const result = await client.request('/v1/jobs');
    if (!Array.isArray(result.jobs) || result.jobs.length > 50) throw Error('The worker returned an invalid job list.');
    const matches = result.jobs.filter(j => j.engine === 'scene-usd' && Array.isArray(j.upload_ids) && j.upload_ids.length === 1 && j.upload_ids[0] === job.uploadId);
    if (matches.length !== 1) throw Error(matches.length ? 'Several worker jobs use this upload. Review them in the processing session.' : 'No matching job appears in the recent worker list. Creation is still unconfirmed; this scan will not be submitted again automatically.');
    return remoteJob(matches[0]);
  }
  async function stopRemote(job, client) {
    if (!job.remoteId) {
      if (job.status === 'attention' || job.creationPending) {const found = await reconcile(job, client); job.remoteId = found.id;}
      else {await update(job, {status: 'cancelled', cancelRequested: false, error: '', finishedAt: now()}); return;}
    }
    const result = await client.request(`/v1/jobs/${job.remoteId}`, {method: 'DELETE'});
    const value = await receive(job, result, client);
    if (!TERMINAL.has(value.status)) throw Error('The worker has not confirmed cancellation.');
    await update(job, {cancelRequested: false});
  }
  async function execute(job, control) {
    let client = connection.client, caps = connection.caps, creating = false;
    try {
      const binding = scope(client, caps, job); bimWorkerCapacity(caps, board.requestedConcurrency);
      if (job.cancelRequested) {await stopRemote(job, client); return;}
      if (job.remoteId || job.creationPending) {
        const found = await reconcile(job, client); await update(job, {creationPending: false}); await receive(job, found, client);
        if (TERMINAL.has(found.status)) return;
      } else {
        const source = await store.source(job.sourceId);
        if (!source?.uploadFile) throw Error('The saved source file is missing. Add the original scan again.');
        if (source.uploadFile.size !== job.source.cloudBytes || await bimHash(await source.uploadFile.arrayBuffer()) !== job.source.cloudSha256)
          throw Error('The saved scan no longer matches its recorded hash. Add the original again.');
        if (control.signal.aborted) throw aborted();
        await update(job, {...binding, status: 'uploading', error: ''});
        const uploadFile = new File([source.uploadFile], 'arena-cloud.json', {type: 'application/json'});
        if (job.uploadId && client.uploads?.set) client.uploads.set(uploadFile, {id: job.uploadId});
        let lastSave = 0;
        const id = await client.upload(uploadFile, 'cloud', control.signal, progress => {
          job.progress = progress; const item = client.uploads?.get(uploadFile); if (HEX32.test(item?.id || '')) job.uploadId = item.id;
          emit(); if (Date.now() - lastSave > 600) {lastSave = Date.now(); void save().catch(() => {});}
        });
        if (!HEX32.test(id)) throw Error('The worker returned an invalid upload identifier.');
        await update(job, {uploadId: id, progress: 1});
        if (control.signal.aborted) throw aborted();
        // Persist before sending. A lost reply is reconciled by the exact upload ID; it is never blindly retried.
        creating = true; await update(job, {status: 'creating', creationPending: true});
        const created = remoteJob(await client.request('/v1/jobs', {method: 'POST', body: {engine: 'scene-usd', upload_ids: [id], consent: true}}));
        creating = false; await update(job, {remoteId: created.id, creationPending: false});
        if (job.cancelRequested) {await stopRemote(job, client); return;}
        if (control.signal.aborted) throw aborted();
        await receive(job, created, client);
      }
      if (job.cancelRequested) {await stopRemote(job, client); return;}
      if (job.status === 'prepared') {
        if (control.signal.aborted) throw aborted();
        const started = await client.request(`/v1/jobs/${job.remoteId}/start`, {method: 'POST', body: {}, signal: control.signal});
        await receive(job, started, client);
      }
      let failures = 0;
      while (!TERMINAL.has(job.status)) {
        await sleep(pollMs * Math.min(4, 1 + failures), control.signal);
        try {const value = await client.request(`/v1/jobs/${job.remoteId}`, {signal: control.signal}); await receive(job, value, client); failures = 0;}
        catch (error) {if (control.signal.aborted || ++failures >= 3) throw error;}
      }
    } catch (error) {
      const rejectedCreate = (creating || job.creationPending) && !job.remoteId && [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(error.status);
      if (rejectedCreate) {job.creationPending = false; creating = false;}
      if (job.cancelRequested) {
        try {await stopRemote(job, client);}
        catch (cancelError) {paused = true; await update(job, {status: 'interrupted', error: `Cancellation not confirmed: ${text(cancelError.message)}`});}
      } else if (rejectedCreate) {
        await update(job, {status: 'failed', creationPending: false, error: text(error.message), finishedAt: now()});
      } else if (creating || (job.creationPending && !job.remoteId)) {
        paused = true;
        await update(job, {status: 'attention', error: 'Job creation may have reached the worker. Reconnect and check before another submission.'});
      } else if (job.remoteId || control.signal.aborted) {
        paused = true;
        await update(job, {status: 'interrupted', error: control.signal.aborted ? 'Observation paused. Resume to check the saved worker job.' : text(error.message)});
      } else await update(job, {status: 'failed', error: text(error.message), finishedAt: now()});
    }
  }
  function pump() {
    if (paused || disposed || !connection || persistenceError) return;
    while (active.size < capacity) {
      const queued = board.jobs.filter(j => j.status === 'ready' && !active.has(j.id));
      const next = queued.find(j => j.remoteId || j.creationPending || j.cancelRequested) || queued[0]; if (!next) break;
      const controller = new AbortController();
      const task = Promise.resolve().then(() => execute(next, controller)).catch(error => {persistenceError = text(error.message); paused = true;})
        .finally(() => {active.delete(next.id); emit(); pump();});
      active.set(next.id, {controller, task});
    }
    emit();
  }
  async function resume({consent = false, concurrency = board.requestedConcurrency} = {}) {
    await ready; if (!consent) throw Error('Agree to send the queued registered scans to this worker.');
    if (disposed) throw Error('This project board is closed.');
    if (board.jobs.some(j => j.status === 'attention')) throw Error('Check unconfirmed submissions before starting more jobs; an unresolved job may still occupy worker capacity.');
    const c = await current(); capacity = bimWorkerCapacity(c.caps, concurrency);
    for (const job of board.jobs.filter(j => ['ready', 'interrupted'].includes(j.status))) scope(c.client, c.caps, job);
    board.requestedConcurrency = Math.min(3, Math.max(1, Math.trunc(Number(concurrency) || 1)));
    connection = c; paused = false; persistenceError = '';
    for (const job of board.jobs) if (job.status === 'interrupted') job.status = 'ready';
    await save(); pump(); return report();
  }
  function pause() {paused = true; emit();}
  async function cancel(id) {
    await ready; const job = getJob(id); if (TERMINAL.has(job.status)) return;
    job.cancelRequested = true; await save(); const item = active.get(id);
    if (item) {item.controller.abort(); await item.task; return;}
    if (!job.remoteId && !job.creationPending) {await update(job, {status: 'cancelled', cancelRequested: false, error: '', finishedAt: now()}); return;}
    const c = await current(job); await update(job, {status: 'cancelling'});
    try {await stopRemote(job, c.client);} catch (error) {paused = true; await update(job, {status: 'interrupted', error: `Cancellation not confirmed: ${text(error.message)}`}); throw error;}
  }
  async function retry(id) {
    await ready; const job = getJob(id);
    if (!['failed', 'cancelled'].includes(job.status) || job.cancelRequested || active.has(id)) throw Error('Retry only a confirmed failed or cancelled job. Resume interrupted work to check its original job.');
    if (job.attempt >= 10) throw Error('This scan has reached the ten-attempt limit. Export its manifest before creating another job.');
    job.history.push({attempt: job.attempt, remoteId: job.remoteId, status: job.status, error: job.error, finishedAt: job.finishedAt || now()});
    // A new upload identity keeps reconciliation unambiguous across attempts.
    await update(job, {status: 'ready', remoteStatus: null, remoteId: null, uploadId: null, creationPending: false, workerBase: null, ownerId: null,
      artifacts: [], review: emptyReview(), progress: 0, attempt: job.attempt + 1, cancelRequested: false, error: '', finishedAt: null});
    contexts.delete(id); pump();
  }
  async function check(id) {
    await ready; const job = getJob(id);
    if (active.has(id)) throw Error('This job is already being observed.');
    const c = await current(job), found = await reconcile(job, c.client);
    await update(job, {remoteId: found.id, creationPending: false}); await receive(job, found, c.client);
    if (!TERMINAL.has(found.status)) await update(job, {status: 'interrupted', error: 'Worker state checked. Resume to continue observing this job.'});
    return copy(job);
  }
  async function review(id, input) {
    await ready; const job = getJob(id); if (job.status !== 'complete') throw Error('Review the actual completed worker result first.');
    const checks = Object.fromEntries(BIM_REVIEW_CHECKS.map(k => [k, input.checks?.[k] === true]));
    const reviewer = text(input.reviewer, 80).trim();
    const value = {checks, reviewer, notes: text(input.notes, 2000),
      status: reviewer && job.artifacts.length > 0 && BIM_REVIEW_CHECKS.every(k => checks[k]) ? 'reviewed' : 'pending', updatedAt: now(),
      binding: {sourceSha256: job.source.sha256, cloudSha256: job.source.cloudSha256, jobId: job.remoteId, artifacts: copy(job.artifacts)}};
    await update(job, {review: value}); return copy(value);
  }
  async function result(id) {
    await ready; const job = getJob(id); if (job.status !== 'complete') throw Error('This job has no completed result.');
    const c = await current(job); await receive(job, await c.client.request(`/v1/jobs/${job.remoteId}`), c.client);
    if (job.status !== 'complete') throw Error('The worker result is no longer complete.');
    return contexts.get(id) || {client: c.client, job: remoteJob({...job, id: job.remoteId}), context: null};
  }
  async function download(id, index) {const r = await result(id); if (!r.job.artifacts[index]) throw Error('Choose an available artifact.'); return r.client.download(r.job.id, index);}
  async function manifest() {await ready; await saving; return {...copy(board), exportedAt: now(),
    scope: 'Registered scan preparation, actual worker jobs and human review records. No native RVT, verified survey accuracy, or delivery-time guarantee.',
    credentialsIncluded: false};}
  async function clear() {
    await ready; pause();
    for (const job of [...board.jobs]) if (!TERMINAL.has(job.status)) await cancel(job.id);
    if (board.jobs.some(j => !TERMINAL.has(j.status) || j.cancelRequested)) throw Error('Confirm outstanding worker cancellations before clearing this board.');
    await saving; await store.clear(); board = blankBoard(); contexts.clear(); connection = null; persistenceError = ''; emit();
  }
  async function dispose() {paused = true; disposed = true; for (const {controller} of active.values()) controller.abort();
    await Promise.allSettled([...active.values()].map(a => a.task)); await saving; await store.close();}
  async function idle() {await ready; while (active.size) await Promise.allSettled([...active.values()].map(a => a.task)); await saving; return report();}
  return {ready, report, addProject, addSource, resume, pause, cancel, retry, check, review, result, download, manifest, clear, dispose, idle};
}
