import { loadPhysics, normalizeConfig, createSimulation, runEpisode, seededCase, makeModelXML } from './rope-physics.js';
import { openJournal, putRecord, getRecord } from './journal.js';

const BUILD = 'deformable-physics-2026-10-17-v1';
let physicsPromise;
let active = false;
let cancelled = false;
let lastReport = null;
let runtimeManifest = null;
const memory = new Map();
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const uid = () => crypto.randomUUID();
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), x => x.toString(16).padStart(2, '0')).join('');
const send = message => self.postMessage(message);

async function getPhysics() {
  if (!physicsPromise) {
    physicsPromise = Promise.all([
      loadPhysics(),
      fetch(new URL('./runtime-manifest.json', import.meta.url)).then(response => {
        if (!response.ok) throw new Error('The versioned physics runtime manifest is unavailable.');
        return response.json();
      }),
    ]).then(([physics, manifest]) => {
      if (manifest.build !== BUILD || manifest.engine?.version !== physics.mj_versionString()) throw new Error('The physics runtime and its manifest do not match. Reload to update.');
      runtimeManifest = manifest;
      return physics;
    }).catch(error => { physicsPromise = null; throw error; });
  }
  return physicsPromise;
}

async function qualifyEpisode(physics, config) {
  const started = performance.now();
  const episode = runEpisode(physics, config, { record: true });
  episode.evidenceId = uid();
  episode.schema = 'brainsnn.deformable.episode.v1';
  episode.createdAt = new Date().toISOString();
  episode.computeSeconds = (performance.now() - started) / 1000;
  episode.modelXML = makeModelXML(episode.config || config);
  episode.runtime = runtimeManifest;
  episode.manifest = {
    modelSha256: await hash(episode.modelXML),
    framesSha256: await hash(JSON.stringify(episode.frames)),
    configSha256: await hash(JSON.stringify(episode.config)),
    identityNote: 'Content hashes establish consistency with this recording; they are not remote execution attestation.',
  };
  episode.storageAvailable = false;
  try {
    // Finalized metadata is committed with the episode in one transaction.
    episode.storageAvailable = true;
    await putRecord('episodes', episode);
  } catch (error) {
    episode.storageAvailable = false;
    episode.storageError = error.message;
  }
  // One full in-memory run is retained if IndexedDB is unavailable. Batch
  // execution stops at the first persistence failure instead of dropping runs.
  memory.clear();
  memory.set(episode.evidenceId, episode);
  return episode;
}

function caseOutcome(episode) {
  const value = episode.outcome;
  if (value === 'success' || value === 'task_success' || value?.success === true || episode.summary?.success === true) return 'task_success';
  return 'task_miss';
}

async function checkpoint(report) {
  report.elapsedSeconds = (performance.now() - report._started) / 1000;
  const stored = { ...report };
  delete stored._started;
  await putRecord('campaigns', stored);
  return stored;
}

async function batch(physics, request) {
  if (![10, 100].includes(request.count)) throw new Error('Choose a local pack of 10 or 100 physics episodes.');
  const config = normalizeConfig(request.config || {});
  const seed = request.seed === undefined ? config.seed : Number(request.seed);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647 - (request.count - 1)) throw new Error('The campaign seeds must fit within the non-negative 32-bit range.');
  await openJournal(); // Require storage before beginning a multi-episode run.
  const report = {
    schema: 'brainsnn.deformable.campaign.v1',
    build: BUILD,
    journalId: uid(),
    createdAt: new Date().toISOString(),
    status: 'running',
    requested: request.count,
    completed: 0,
    successes: 0,
    misses: 0,
    errors: 0,
    seed,
    baseConfig: config,
    cases: [],
    runtime: runtimeManifest,
    provenance: { physicsExecuted: false, policyExecuted: false, source: 'browser-mujoco-elastic-rod', controller: 'prescribed attachment trajectory', pricing: 'local execution; no hosted compute charge' },
    coverage: 'Seeded target, Young\'s modulus and density perturbations, with exact per-case configurations retained. These are not independent real robots or a learned-policy benchmark.',
    physicsSeconds: 0,
    computeSeconds: 0,
    _started: performance.now(),
  };
  await checkpoint(report);
  lastReport = report;
  for (let i = 0; i < request.count; i++) {
    // A persisted prefix remains useful after cancellation or tab closure.
    await yieldTask();
    if (cancelled) { report.status = 'cancelled'; break; }
    if (performance.now() - report._started > 120000) { report.status = 'time_limit'; break; }
    const condition = seededCase(config, seed + i);
    let episode;
    try {
      episode = await qualifyEpisode(physics, condition);
      const outcome = caseOutcome(episode);
      const row = { index: i, seed: seed + i, outcome, config: episode.config, summary: episode.summary, evidenceId: episode.evidenceId, manifest: episode.manifest, computeSeconds: episode.computeSeconds, storageAvailable: episode.storageAvailable };
      report.cases.push(row);
      report.completed++;
      report.provenance.physicsExecuted = true;
      report[outcome === 'task_success' ? 'successes' : 'misses']++;
      report.physicsSeconds += episode.frames.at(-1)?.time || condition.duration || 0;
      report.computeSeconds += episode.computeSeconds;
      if (!episode.storageAvailable) { report.status = 'storage_error'; report.storageError = episode.storageError; }
    } catch (error) {
      report.errors++;
      report.cases.push({ index: i, seed: seed + i, outcome: 'simulation_error', config: condition, message: error.message });
    }
    try { await checkpoint(report); }
    catch (error) { report.status = 'storage_error'; report.storageError = error.message; }
    send({ type: 'progress', completed: report.completed, processed: report.cases.length, total: report.requested, summary: { successes: report.successes, misses: report.misses, errors: report.errors }, lastEpisode: episode, journalId: report.journalId });
    if (report.status !== 'running') break;
  }
  if (report.status === 'running') report.status = 'complete';
  report.unattempted = report.requested - report.cases.length;
  try { lastReport = await checkpoint(report); }
  catch (error) { lastReport = { ...report, status: 'storage_error', storageError: error.message }; delete lastReport._started; }
  send({ type: 'batchComplete', report: lastReport });
}

async function search(physics, request) {
  const config = normalizeConfig(request.config || {});
  await openJournal();
  const started = performance.now();
  const heading = Math.atan2(config.target[1], config.target[0] + .6);
  // A fixed candidate design is reproducible and keeps all attempts visible.
  // This searches controller parameters in our simulator; it trains no model.
  const candidates = [config];
  for (let i = 0; i < 11; i++) {
    candidates.push(normalizeConfig({ ...config,
      amplitude: .35 + (i % 6) * .16,
      swingDuration: .35 + Math.floor(i / 6) * .35 + (i % 2) * .1,
      yaw: heading,
    }));
  }
  const report = {
    schema: 'brainsnn.deformable.search.v1', build: BUILD,
    journalId: uid(), createdAt: new Date().toISOString(), status: 'running',
    requested: 13, candidateBudget: 12, verificationBudget: 1, completed: 0,
    successes: 0, misses: 0, errors: 0, cases: [], baseConfig: config,
    selection: 'Lowest measured rope-tip distance; earliest candidate wins ties. Target, material and judge remain fixed.',
    provenance: { physicsExecuted: false, policyExecuted: false, controller: 'bounded parameter search over prescribed trajectories', source: 'browser-mujoco-elastic-rod' },
    runtime: runtimeManifest,
  };
  await putRecord('campaigns', report);
  let best = null;
  async function evaluate(condition, role) {
    try {
      const episode = await qualifyEpisode(physics, condition);
      const outcome = caseOutcome(episode);
      report.cases.push({ index: report.cases.length, role, config: episode.config, outcome, summary: episode.summary, evidenceId: episode.evidenceId, manifest: episode.manifest, storageAvailable: episode.storageAvailable });
      report.completed++;
      report.provenance.physicsExecuted = true;
      report[outcome === 'task_success' ? 'successes' : 'misses']++;
      if (!episode.storageAvailable) { report.status = 'storage_error'; report.storageError = episode.storageError; }
      return episode;
    } catch (error) {
      report.errors++;
      report.cases.push({ index: report.cases.length, role, config: condition, outcome: 'simulation_error', message: error.message });
      return null;
    }
  }
  for (const condition of candidates) {
    await yieldTask();
    if (cancelled) { report.status = 'cancelled'; break; }
    if (performance.now() - started > 120000) { report.status = 'time_limit'; break; }
    const episode = await evaluate(condition, 'candidate');
    const distance = episode?.summary?.minDistance ?? episode?.outcome?.minDistance;
    const previous = best?.summary?.minDistance ?? best?.outcome?.minDistance ?? Infinity;
    if (Number.isFinite(distance) && distance < previous) best = episode;
    report.elapsedSeconds = (performance.now() - started) / 1000;
    try { await putRecord('campaigns', report); }
    catch (error) { report.status = 'storage_error'; report.storageError = error.message; }
    send({ type: 'searchProgress', completed: report.cases.length, total: 12, bestDistance: best?.summary?.minDistance ?? best?.outcome?.minDistance ?? null });
    if (report.status !== 'running') break;
  }
  if (report.status === 'running' && cancelled) report.status = 'cancelled';
  if (report.status === 'running' && best) {
    // Verify the frozen selected motion with a fresh model/reset, rather than
    // converting a favorable intermediate search state into a final episode.
    const verification = await evaluate(best.config, 'selected_motion_verification');
    report.selectedMotionVerified = Boolean(verification);
    if (verification) best = verification;
    report.status = report.status === 'running' ? verification ? 'complete' : 'verification_error' : report.status;
  } else if (report.status === 'running') report.status = 'simulation_error';
  report.unattempted = report.requested - report.cases.length;
  report.elapsedSeconds = (performance.now() - started) / 1000;
  report.selectedEvidenceId = best?.evidenceId || null;
  try { await putRecord('campaigns', report); }
  catch (error) { report.status = 'storage_error'; report.storageError = error.message; }
  send({ type: 'searchComplete', episode: best ? { ...best, searchReport: report } : null, searchReport: report });
}

self.onmessage = async event => {
  const request = event.data || {};
  if (request.type === 'cancel') { cancelled = true; return; }
  if (active) { send({ type: 'error', message: 'A physics job is already running. Cancel it before starting another.' }); return; }
  active = true;
  cancelled = false;
  try {
    if (request.type === 'loadEpisode') {
      const episode = memory.get(request.evidenceId) || await getRecord('episodes', request.evidenceId);
      if (!episode) throw new Error('This recording is not available on this browser.');
      send({ type: 'episode', episode });
    } else if (request.type === 'exportBatch') {
      const report = request.journalId && request.journalId !== lastReport?.journalId
        ? await getRecord('campaigns', request.journalId) : lastReport || await getRecord('campaigns', request.journalId);
      if (!report) throw new Error('No retained campaign is available to export.');
      const episodes = [];
      for (const row of report.cases) {
        if (!row.evidenceId) continue;
        const episode = memory.get(row.evidenceId) || await getRecord('episodes', row.evidenceId);
        if (!episode) throw new Error('A campaign recording is missing. Export its summary to inspect the gap.');
        episodes.push(episode);
      }
      send({ type: 'batchArchive', archive: { schema: 'brainsnn.deformable.archive.v1', report, episodes } });
    } else {
      const physics = await getPhysics();
      const config = normalizeConfig(request.config || {});
      if (request.type === 'initialize') {
        const simulation = createSimulation(physics, config);
        try { send({ type: 'ready', config, frame: simulation.snapshot(), provenance: { engine: 'MuJoCo', version: physics.mj_versionString(), build: BUILD, policyExecuted: false } }); }
        finally { simulation.dispose(); }
      } else if (request.type === 'run') {
        send({ type: 'episode', episode: await qualifyEpisode(physics, config) });
      } else if (request.type === 'batch') {
        await batch(physics, request);
      } else if (request.type === 'search') {
        await search(physics, request);
      } else {
        throw new Error('Unknown physics operation.');
      }
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Physics execution failed.' });
  } finally {
    active = false;
  }
};
