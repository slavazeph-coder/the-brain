/* Actual module WebWorker + pinned MuJoCo WASM integration. No fixture physics,
 * learned policy, external provider, hosted worker or paid compute is used. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const app = path.resolve(__dirname, '../../../brainsnn-r3f-app');
const assets = path.join(app, 'public/arena/deformable');
const { chromium } = createRequire(path.join(app, 'package.json'))('@playwright/test');
const digest = value => createHash('sha256').update(value).digest('hex');
// Serve one immutable built artifact. Concurrent editor changes must not turn
// an already-imported module into a different source while a pack is running.
const assetSnapshot = new Map();
const html = '<!doctype html><meta charset="utf-8"><title>Actual deformable worker contract</title><link rel="icon" href="data:,">';
const mime = { '.js': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/test.html') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const name = pathname.slice('/arena/deformable/'.length);
  if (!pathname.startsWith('/arena/deformable/') || !/^(?:vendor\/)?[a-zA-Z0-9.-]+$/.test(name)) { res.writeHead(404).end(); return; }
  const bytes = assetSnapshot.get(name);
  if (!bytes) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream');
  res.end(bytes);
});

function verifyEpisode(episode) {
  assert.equal(episode.schema, 'brainsnn.deformable.episode.v1');
  assert.equal(episode.provenance.physicsExecuted, true);
  assert.equal(episode.provenance.policyExecuted, false);
  assert.equal(episode.provenance.engineVersion, '3.16.0');
  assert.equal(episode.summary.completed, true);
  assert(Number.isFinite(episode.computeSeconds) && episode.computeSeconds > 0);
  assert(episode.frames.length > 2, 'a retained trajectory contains actual physics samples');
  assert(episode.frames.at(-1).time >= episode.config.duration - episode.config.timestep * .1, 'the complete horizon tolerates floating-point integration round-off');
  assert.equal(episode.frames[0].physicsExecuted, false, 'prepared initial state does not claim an executed step');
  assert(episode.frames.slice(1).every(frame => frame.physicsExecuted === true && frame.policyExecuted === false));
  assert(episode.frames.some(frame => JSON.stringify(frame.tip) !== JSON.stringify(episode.frames[0].tip)), 'tip actually moves');
  assert.equal(episode.manifest.modelSha256, digest(episode.modelXML));
  assert.equal(episode.manifest.framesSha256, digest(JSON.stringify(episode.frames)));
  assert.equal(episode.manifest.configSha256, digest(JSON.stringify(episode.config)));
  assert.match(episode.manifest.identityNote, /not remote execution attestation/);
  assert.equal(episode.runtime.engine.version, '3.16.0');
  for (const asset of episode.runtime.assets) {
    const bytes = assetSnapshot.get(asset.path);
    assert(bytes, asset.path + ' is part of the served build');
    assert.equal(asset.bytes, bytes.length, asset.path + ' byte length');
    assert.equal(asset.sha256, digest(bytes), asset.path + ' runtime identity');
  }
}

(async () => {
  let browser;
  try {
    assert(fs.existsSync(path.join(assets, 'runtime-manifest.json')), 'Run the application deformable build before this browser test.');
    const manifestBytes = fs.readFileSync(path.join(assets, 'runtime-manifest.json'));
    assetSnapshot.set('runtime-manifest.json', manifestBytes);
    for (const asset of JSON.parse(manifestBytes).assets) {
      const bytes = fs.readFileSync(path.join(assets, asset.path));
      assert.equal(bytes.length, asset.bytes, 'Rebuild before testing: ' + asset.path);
      assert.equal(digest(bytes), asset.sha256, 'Rebuild before testing: ' + asset.path);
      assetSnapshot.set(asset.path, bytes);
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
    const page = await browser.newPage();
    const requests = [], errors = [];
    page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/test.html');
    await page.evaluate(() => {
      window.contractWorkers = {};
      window.spawnContractWorker = (id, denyStorage = false, cancelAfter = null) => {
        const source = new URL('/arena/deformable/simulation-worker.js', location.href).href;
        const storageFault = denyStorage === 'quota'
          ? 'const realPut=IDBObjectStore.prototype.put; IDBObjectStore.prototype.put=function(...args){if(this.name==="episodes")throw new DOMException("Injected full recording store","QuotaExceededError"); return realPut.apply(this,args);};'
          : 'Object.defineProperty(globalThis,"indexedDB",{value:undefined});';
        const objectURL = denyStorage ? URL.createObjectURL(new Blob([
          storageFault + ' await import(' + JSON.stringify(source) + '); postMessage({type:"contractFaultReady"});',
        ], { type: 'application/javascript' })) : null;
        const worker = new Worker(objectURL || source, { type: 'module' });
        const entry = window.contractWorkers[id] = { worker, events: [], failures: [], objectURL };
        worker.onmessage = event => {
          entry.events.push(event.data);
          if (event.data.type === 'progress' && cancelAfter !== null && event.data.processed >= cancelAfter) worker.postMessage({ type: 'cancel' });
        };
        worker.onerror = event => entry.failures.push(event.message);
      };
    });
    const spawn = async (id, deny = false, cancelAfter = null) => {
      await page.evaluate(({ id, deny, cancelAfter }) => window.spawnContractWorker(id, deny, cancelAfter), { id, deny, cancelAfter });
      // The failure-injection wrapper dynamically imports the actual worker.
      // Wait until its handler is installed before sending the first operation.
      if (deny) await page.waitForFunction(id => window.contractWorkers[id].events.some(event => event.type === 'contractFaultReady'), id, { timeout: 30000 });
    };
    const mark = id => page.evaluate(id => window.contractWorkers[id].events.length, id);
    const post = (id, request) => page.evaluate(({ id, request }) => window.contractWorkers[id].worker.postMessage(request), { id, request });
    const wait = async (id, type, from = 0) => {
      try {
        await page.waitForFunction(({ id, type, from }) => window.contractWorkers[id].failures.length || window.contractWorkers[id].events.slice(from).some(event => event.type === type || event.type === 'error'), { id, type, from }, { timeout: 120000 });
      } catch (error) {
        const state = await page.evaluate(id => ({ events: window.contractWorkers[id].events.map(event => ({ type: event.type, completed: event.completed, message: event.message })), failures: window.contractWorkers[id].failures }), id);
        throw new Error(id + ' waiting for ' + type + ': ' + JSON.stringify(state), { cause: error });
      }
      const result = await page.evaluate(({ id, type, from }) => ({ failures: window.contractWorkers[id].failures, event: window.contractWorkers[id].events.slice(from).find(event => event.type === type || event.type === 'error') }), { id, type, from });
      assert.deepEqual(result.failures, [], id + ' native worker failures');
      assert.equal(result.event.type, type, id + ' expected ' + type + ': ' + JSON.stringify(result.event));
      return result.event;
    };
    const operation = async (id, request, type) => { const from = await mark(id); await post(id, request); return wait(id, type, from); };

    await spawn('main');
    const ready = await operation('main', { type: 'initialize' }, 'ready');
    assert.equal(ready.provenance.version, '3.16.0');
    assert.equal(ready.provenance.policyExecuted, false);
    assert.equal(ready.frame.time, 0);
    assert.equal(ready.frame.physicsExecuted, false);
    const single = (await operation('main', { type: 'run' }, 'episode')).episode;
    verifyEpisode(single);
    assert.equal(single.storageAvailable, true);
    const reloaded = (await operation('main', { type: 'loadEpisode', evidenceId: single.evidenceId }, 'episode')).episode;
    assert.deepEqual(reloaded, single, 'IndexedDB preserves exact episode and hashes');

    const invalid = await operation('main', { type: 'run', config: { amplitude: Number.MAX_VALUE } }, 'error');
    assert.match(invalid.message, /amplitude/);
    const wrongCount = await operation('main', { type: 'batch', count: 1000 }, 'error');
    assert.match(wrongCount.message, /10 or 100/);
    const overflowSeed = await operation('main', { type: 'batch', count: 10, seed: 2147483647 }, 'error');
    assert.match(overflowSeed.message, /seed/i, 'seed range is rejected before beginning an unfinishable pack');

    const overlapStart = await mark('main');
    await page.evaluate(() => {
      const worker = window.contractWorkers.main.worker;
      worker.postMessage({ type: 'run', config: { duration: .1 } });
      worker.postMessage({ type: 'run', config: { duration: .1 } });
    });
    await page.waitForFunction(from => {
      const events = window.contractWorkers.main.events.slice(from);
      return events.some(event => event.type === 'episode') && events.some(event => event.type === 'error');
    }, overlapStart, { timeout: 120000 });
    const overlap = await page.evaluate(from => window.contractWorkers.main.events.slice(from), overlapStart);
    assert.equal(overlap.filter(event => event.type === 'episode').length, 1);
    assert.equal(overlap.filter(event => event.type === 'error').length, 1);
    assert.match(overlap.find(event => event.type === 'error').message, /already running/);
    verifyEpisode(overlap.find(event => event.type === 'episode').episode);

    const pack = (await operation('main', { type: 'batch', count: 10, seed: 7 }, 'batchComplete')).report;
    assert.equal(pack.status, 'complete');
    assert.equal(pack.requested, 10);
    assert.equal(pack.completed, 10);
    assert.equal(pack.errors, 0);
    assert.equal(pack.unattempted, 0);
    assert.equal(pack.successes + pack.misses, 10);
    assert.deepEqual(pack.cases.map(row => row.seed), Array.from({ length: 10 }, (_, i) => 7 + i));
    assert.equal(new Set(pack.cases.map(row => row.manifest.configSha256)).size, 10, 'conditions differ; repeated state is not counted as seed diversity');
    assert.equal(pack.provenance.physicsExecuted, true);
    assert.equal(pack.provenance.policyExecuted, false);
    const archive = (await operation('main', { type: 'exportBatch', journalId: pack.journalId }, 'batchArchive')).archive;
    assert.equal(archive.schema, 'brainsnn.deformable.archive.v1');
    assert.equal(archive.episodes.length, 10);
    for (const [index, episode] of archive.episodes.entries()) {
      verifyEpisode(episode);
      assert.equal(episode.storageAvailable, true);
      assert.equal(episode.evidenceId, pack.cases[index].evidenceId);
      assert.deepEqual(episode.manifest, pack.cases[index].manifest);
      assert.equal(episode.summary.success ? 'task_success' : 'task_miss', pack.cases[index].outcome);
    }

    const searched = await operation('main', { type: 'search' }, 'searchComplete');
    const search = searched.searchReport;
    assert.equal(search.schema, 'brainsnn.deformable.search.v1');
    assert.equal(search.status, 'complete');
    assert.equal(search.candidateBudget, 12);
    assert.equal(search.verificationBudget, 1);
    assert.equal(search.requested, 13);
    assert.equal(search.completed, 13);
    assert.equal(search.errors, 0);
    assert.equal(search.unattempted, 0);
    assert.equal(search.selectedMotionVerified, true);
    assert.equal(search.cases.filter(row => row.role === 'candidate').length, 12);
    assert.equal(search.cases.at(-1).role, 'selected_motion_verification');
    assert.equal(search.selectedEvidenceId, searched.episode.evidenceId);
    assert.equal(search.cases.at(-1).evidenceId, searched.episode.evidenceId);
    assert.equal(search.provenance.policyExecuted, false);
    verifyEpisode(searched.episode);
    const frozen = config => Object.fromEntries(Object.entries(config).filter(([key]) => !['amplitude', 'swingDuration', 'yaw'].includes(key)));
    assert(search.cases.every(row => JSON.stringify(frozen(row.config)) === JSON.stringify(frozen(search.baseConfig))), 'search must not move the target or alter the material/judge');
    const candidates = search.cases.filter(row => row.role === 'candidate');
    const bestCandidate = candidates.reduce((best, row) => row.summary.minDistance < best.summary.minDistance ? row : best);
    assert.deepEqual(search.cases.at(-1).config, bestCandidate.config, 'the selected motion is rerun from a fresh model');
    assert.notEqual(search.cases.at(-1).evidenceId, bestCandidate.evidenceId);
    const searchArchive = (await operation('main', { type: 'exportBatch', journalId: search.journalId }, 'batchArchive')).archive;
    assert.equal(searchArchive.episodes.length, 13, 'all search attempts and fresh verification retain full recordings');
    searchArchive.episodes.forEach(verifyEpisode);

    await spawn('cancelBeforeExecution');
    const zeroStart = await mark('cancelBeforeExecution');
    await page.evaluate(() => {
      const worker = window.contractWorkers.cancelBeforeExecution.worker;
      worker.postMessage({ type: 'batch', count: 10, seed: 70 });
      worker.postMessage({ type: 'cancel' });
    });
    const zero = (await wait('cancelBeforeExecution', 'batchComplete', zeroStart)).report;
    assert.equal(zero.status, 'cancelled');
    assert.equal(zero.completed, 0);
    assert.equal(zero.cases.length, 0);
    assert.equal(zero.unattempted, 10);
    assert.equal(zero.provenance.physicsExecuted, false, 'a prepared/cancelled pack must not claim executed physics');
    assert.equal(zero.provenance.policyExecuted, false);

    await spawn('cancel', false, 1);
    const cancelled = (await operation('cancel', { type: 'batch', count: 100, seed: 100 }, 'batchComplete')).report;
    assert.equal(cancelled.status, 'cancelled');
    assert(cancelled.cases.length >= 1 && cancelled.cases.length < 100, 'cancellation leaves an honest completed prefix');
    assert.equal(cancelled.unattempted, 100 - cancelled.cases.length);
    assert.equal(cancelled.successes + cancelled.misses + cancelled.errors, cancelled.cases.length);
    const prefix = (await operation('cancel', { type: 'exportBatch', journalId: cancelled.journalId }, 'batchArchive')).archive;
    assert.equal(prefix.episodes.length, cancelled.completed);
    prefix.episodes.forEach(verifyEpisode);
    const older = (await operation('cancel', { type: 'exportBatch', journalId: pack.journalId }, 'batchArchive')).archive;
    assert.equal(older.report.journalId, pack.journalId, 'an explicit saved journal ID wins over the last campaign');
    assert.equal(older.episodes.length, 10);

    await spawn('denied', true);
    const deniedPack = await operation('denied', { type: 'batch', count: 10 }, 'error');
    assert.match(deniedPack.message, /storage.*unavailable/i);
    assert.equal(await page.evaluate(() => window.contractWorkers.denied.events.some(event => event.type === 'progress' || event.type === 'batchComplete')), false, 'a denied durable store cannot start a multi-episode job');
    const fallback = (await operation('denied', { type: 'run', config: { duration: .1 } }, 'episode')).episode;
    verifyEpisode(fallback);
    assert.equal(fallback.storageAvailable, false);
    assert.match(fallback.storageError, /storage.*unavailable/i);
    assert.deepEqual((await operation('denied', { type: 'loadEpisode', evidenceId: fallback.evidenceId }, 'episode')).episode, fallback, 'a single run remains available for export when durable storage is denied');

    await spawn('quota', 'quota');
    const quota = (await operation('quota', { type: 'batch', count: 10, config: { duration: .1 } }, 'batchComplete')).report;
    assert.equal(quota.status, 'storage_error');
    assert.equal(quota.completed, 1);
    assert.equal(quota.cases.length, 1, 'a failed evidence commit stops the pack immediately');
    assert.equal(quota.unattempted, 9);
    assert.equal(quota.cases[0].storageAvailable, false);
    const quotaArchive = (await operation('quota', { type: 'exportBatch', journalId: quota.journalId }, 'batchArchive')).archive;
    assert.equal(quotaArchive.episodes.length, 1, 'the one unsaved recording remains exportable from memory');
    assert.equal(quotaArchive.episodes[0].storageAvailable, false);
    verifyEpisode(quotaArchive.episodes[0]);

    await page.route('**/runtime-manifest.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await spawn('unavailable');
    const unavailable = await operation('unavailable', { type: 'run' }, 'error');
    assert.match(unavailable.message, /manifest is unavailable/i);
    assert.equal(await page.evaluate(() => window.contractWorkers.unavailable.events.some(event => event.type === 'episode')), false, 'an unqualified runtime cannot produce a recorded success');
    await page.unroute('**/runtime-manifest.json');
    const recovered = (await operation('unavailable', { type: 'run', config: { duration: .1 } }, 'episode')).episode;
    verifyEpisode(recovered);
    assert.deepEqual(await page.evaluate(() => Object.values(window.contractWorkers).flatMap(entry => entry.failures)), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter(request => request.method !== 'GET' || (!request.url.startsWith(origin + '/') && !request.url.startsWith('blob:'))), [], 'local physics never calls an external provider, worker or purchase endpoint');
    await page.evaluate(() => { for (const entry of Object.values(window.contractWorkers)) { entry.worker.terminate(); if (entry.objectURL) URL.revokeObjectURL(entry.objectURL); } });
    console.log('DEFORMABLE_WORKER_BROWSER_OK: actual MuJoCo3.16 WASM module worker, moving trajectory, complete10-case pack, retained/hash-verified archives, cancellation100-case prefix, persisted journal identity, seed/count/config rejection, denied storage single-run fallback/batch refusal, quota failure stops at one exportable episode, unavailable runtime/recovery, no external or paid calls.');
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
