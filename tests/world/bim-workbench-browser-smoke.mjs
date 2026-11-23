/** Browser + IndexedDB + real WorkerClient. The local HTTP server below is an explicit worker fixture, not a BIM converter. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, extname} from 'node:path';
import {chromium} from '../../brainsnn-r3f-app/node_modules/playwright/index.mjs';

const publicRoot = fileURLToPath(new URL('../../brainsnn-r3f-app/public/', import.meta.url));
const outputDir = process.env.BIM_SMOKE_OUTPUT || '/tmp/brainsnn-bim-workbench-smoke';
const token = 'bim-browser-fixture-token-' + 'x'.repeat(40), uploads = new Map(), jobs = new Map(), calls = [];
let serial = 0, finishJobs = false;
const id = () => (++serial).toString(16).padStart(32, '0');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ifcFixture = Buffer.from('ISO-10303-21;\n/* browser download fixture only */\nEND-ISO-10303-21;\n');
const artifacts = [{name: 'scene.ifc', size: ifcFixture.length, sha256: hash(ifcFixture)}];
const cloud = {version: 1, kind: 'survey-scan-point-cloud', units: 'm', coordinateFrame: 'right-handed-y-up', sourceFrame: 'survey-scan',
  points: [[0, 0, 0, 160, 160, 160], [2, 0, 2, 160, 160, 160], [2, 2, 0, 160, 160, 160]],
  scale: {source: 'scan-file', metresPerUnit: 1, distance: null, spanUnits: null, selfReported: true, verified: false}};
const sourceBytes = Buffer.from(JSON.stringify(cloud));
const capabilities = {api_version: 'brainsnn.worker.v1', owner_id: 'fixture-owner', owner_limits: {active_jobs: 2},
  limits: {concurrent_jobs: 1, chunk_bytes: 64}, engines: [{id: 'scene-usd', available: true, input_kinds: ['cloud'], max_inputs: 1,
    dimension_checks: true, bim_review: true, registered_survey_cloud: true}]};
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BIM workbench browser fixture</title><link rel="stylesheet" href="/world/bim-workbench.css"><style>body{margin:24px;font-family:Arial,sans-serif;background:#fff}button,input,select,textarea{font-family:inherit}</style><main id="root"></main><script type="module">
import {WorkerClient} from '/world/worker-client.mjs';
import {mountBimWorkbench} from '/world/bim-workbench-ui.mjs';
const client = new WorkerClient(location.origin + '/fixture', '${token}');
const caps = await client.capabilities();
window.opened = []; window.projectHandoffs = [];
window.panel = mountBimWorkbench({root:document.getElementById('root'),getConnection:()=>({client,caps}),
 rememberResult:(job,sourceClient,metadata)=>({job,sourceClient,...metadata}),onOpenResult:context=>window.opened.push(context.job.id),
 saveToProject:summary=>window.projectHandoffs.push(summary)});
await panel.open(); window.fixtureReady = true;
</script></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const respond = (value, status = 200) => {res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value));};
  try {
    if (url.pathname.startsWith('/fixture/v1/')) {
      if (!url.pathname.startsWith('/fixture/v1/download/') && req.headers.authorization !== `Bearer ${token}`) return respond({detail: 'Fixture authentication required'}, 401);
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const data = Buffer.concat(chunks);
      calls.push([req.method, url.pathname]);
      if (url.pathname === '/fixture/v1/capabilities') return respond(capabilities);
      if (url.pathname === '/fixture/v1/uploads' && req.method === 'POST') {
        const body = JSON.parse(data), value = {id: id(), size: body.size, offset: 0, kind: body.kind, chunks: []}; uploads.set(value.id, value);
        return respond({...value, chunks: undefined}, 201);
      }
      if (url.pathname.startsWith('/fixture/v1/uploads/')) {
        const value = uploads.get(url.pathname.split('/').at(-1)); assert.ok(value);
        if (req.method === 'PUT') {assert.equal(Number(url.searchParams.get('offset')), value.offset); value.offset += data.length; value.chunks.push(data);}
        return respond({...value, chunks: undefined});
      }
      if (url.pathname === '/fixture/v1/jobs' && req.method === 'POST') {
        const body = JSON.parse(data); assert.equal(body.engine, 'scene-usd'); assert.equal(body.consent, true);
        const uploaded = uploads.get(body.upload_ids[0]); assert.equal(uploaded.offset, uploaded.size);
        const scan = JSON.parse(Buffer.concat(uploaded.chunks)); assert.equal(scan.sourceFrame, 'survey-scan'); assert.equal(scan.multiView, undefined);
        const value = {id: id(), engine: body.engine, status: 'prepared', upload_ids: body.upload_ids, artifacts: []}; jobs.set(value.id, value); return respond(value, 201);
      }
      if (url.pathname === '/fixture/v1/jobs') return respond({jobs: [...jobs.values()]});
      if (url.pathname.startsWith('/fixture/v1/download/')) {res.writeHead(200, {'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="scene.ifc"'}); return res.end(ifcFixture);}
      const jid = url.pathname.split('/')[4], value = jobs.get(jid); assert.ok(value, `Unknown fixture route ${url.pathname}`);
      if (url.pathname.endsWith('/start')) value.status = 'running';
      else if (req.method === 'DELETE') value.status = 'cancelled';
      else if (url.pathname.endsWith('/ticket')) return respond({url: `/fixture/v1/download/${jid}`, expires_in: 60});
      else if (finishJobs && value.status === 'running') {value.status = 'complete'; value.artifacts = artifacts;}
      return respond(value);
    }
    if (url.pathname === '/') {res.writeHead(200, {'Content-Type': 'text/html'}); return res.end(html);}
    const file = resolve(publicRoot, '.' + url.pathname);
    if (!file.startsWith(publicRoot) || !['.mjs', '.js', '.css'].includes(extname(file))) {res.writeHead(404); return res.end();}
    res.writeHead(200, {'Content-Type': extname(file) === '.css' ? 'text/css' : 'text/javascript'}); res.end(await readFile(file));
  } catch (error) {respond({detail: error.message}, 500);}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  await mkdir(outputDir, {recursive: true});
  browser = await chromium.launch({headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {}), args: ['--no-sandbox']});
  const context = await browser.newContext({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(address); await page.waitForFunction(() => window.fixtureReady);
  await page.locator('[data-bim-project-name]').fill('North building · survey'); await page.locator('[data-bim-project-form] button').click();
  const utmPly = Buffer.from('ply\nformat ascii 1.0\nelement vertex 3\nproperty double x\nproperty double y\nproperty double z\nend_header\n500000 0 0\n500000.01 0 1\n500001 1 1\n');
  await page.locator('[data-bim-files]').setInputFiles({name: 'utm-survey.ply', mimeType: 'application/octet-stream', buffer: utmPly});
  await page.locator('[data-bim-registered]').check(); await page.locator('[data-bim-add]').click();
  await page.waitForFunction(() => document.querySelector('[data-bim-status]').textContent.includes('utm-survey.ply:') && document.querySelector('[data-bim-status]').textContent.includes('31.250 mm'));
  assert.equal(await page.evaluate(() => panel.getReport().jobs.length), 0, 'A rejected precision-loss source must not enter the queue');
  await page.locator('[data-bim-files]').setInputFiles([{name: 'north.json', mimeType: 'application/json', buffer: sourceBytes}, {name: 'south.json', mimeType: 'application/json', buffer: sourceBytes}]);
  await page.locator('[data-bim-registered]').check(); await page.locator('[data-bim-add]').click();
  await page.waitForFunction(() => panel.getReport().jobs.length === 2);
  assert.equal(await page.locator('[data-bim-download]').count(), 0);
  await page.locator('[data-bim-consent]').check(); await page.locator('[data-bim-concurrency]').selectOption('3'); await page.locator('[data-bim-start]').click();
  await page.waitForFunction(() => panel.getReport().jobs[0].status === 'running');
  await page.evaluate(() => panel.suspend()); assert.equal(await page.evaluate(() => panel.getReport().paused), false, 'Navigation must not pause the authorized queue');
  const beforeReload = calls.length; await page.reload(); await page.waitForFunction(() => window.fixtureReady);
  const recovered = await page.evaluate(() => panel.getReport());
  assert.equal(recovered.paused, true); assert.equal(recovered.jobs[0].status, 'interrupted'); assert.equal(recovered.jobs[1].status, 'ready');
  assert.equal(calls.slice(beforeReload).filter(c => c[1].startsWith('/fixture/v1/jobs')).length, 0, 'Reload must wait for explicit resume before observing or submitting jobs');
  const persisted = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {const request = indexedDB.open('brainsnn-bim-workbench-v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    const sources = await new Promise((resolve, reject) => {const request = db.transaction('sources').objectStore('sources').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);});
    return Promise.all(sources.map(async source => ({original: await source.original.text(), prepared: await source.uploadFile.text(), evidence: source.evidence})));
  });
  assert.equal(persisted.length, 2);
  for (const value of persisted) {assert.equal(value.original, sourceBytes.toString()); assert.equal(value.evidence.sha256, hash(sourceBytes)); assert.equal(value.evidence.cloudSha256, hash(value.prepared));}
  finishJobs = true; await page.locator('[data-bim-consent]').check(); await page.locator('[data-bim-start]').click();
  await page.waitForFunction(() => panel.getReport().jobs.every(j => j.status === 'complete'), null, {timeout: 20000});
  assert.equal(calls.filter(c => c[0] === 'POST' && c[1] === '/fixture/v1/jobs').length, 2, 'Resuming must not duplicate the recovered job');
  assert.equal(uploads.size, 2);
  await page.locator('[data-bim-open]').click(); await page.waitForFunction(() => window.opened.length === 1);
  for (const key of ['scale', 'coverage', 'classification', 'exports']) await page.locator(`[data-bim-review="${key}"]`).check();
  await page.locator('[data-bim-reviewer]').fill('Fixture reviewer'); await page.locator('[data-bim-notes]').fill('Browser test fixture; no real survey quality claim.');
  await page.locator('[data-bim-review-form] button').click(); await page.waitForFunction(() => panel.getReport().jobs.some(j => j.review.status === 'reviewed'));
  const manifestDownload = page.waitForEvent('download'); await page.locator('[data-bim-manifest]').click();
  const downloadedManifest = JSON.parse(await readFile(await (await manifestDownload).path(), 'utf8'));
  assert.equal(downloadedManifest.jobs.length, 2); assert.ok(!JSON.stringify(downloadedManifest).includes(token));
  assert.equal(downloadedManifest.jobs.filter(j => j.review.status === 'reviewed').length, 1);
  await page.locator('[data-bim-save-project]').click();
  const handoff = await page.evaluate(() => window.projectHandoffs[0]);
  assert.equal(handoff.name, 'brainsnn-bim-project-summary.json'); assert.equal(JSON.parse(handoff.content_text).jobs.length, 2);
  assert.ok(!handoff.content_text.includes(token)); assert.ok(Buffer.byteLength(handoff.content_text) < 512 * 1024);
  const artifactDownload = page.waitForEvent('download'); await page.locator('[data-bim-download="0"]').click();
  const downloadedArtifact = await artifactDownload; assert.equal(downloadedArtifact.suggestedFilename(), 'scene.ifc'); assert.deepEqual(await readFile(await downloadedArtifact.path()), ifcFixture);
  await page.screenshot({path: resolve(outputDir, 'bim-workbench-desktop.png'), fullPage: true});
  await page.setViewportSize({width: 430, height: 920});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile workbench must fit the viewport');
  await page.screenshot({path: resolve(outputDir, 'bim-workbench-mobile.png'), fullPage: true});
  await page.reload(); await page.waitForFunction(() => window.fixtureReady);
  assert.equal(await page.evaluate(() => panel.getReport().jobs.filter(j => j.review.status === 'reviewed').length), 1);
  await page.evaluate(() => panel.clear()); assert.equal(await page.evaluate(() => panel.getReport().jobs.length), 0);
  assert.deepEqual(errors, []);
  const result = {passed: true, jobs: jobs.size, uploads: uploads.size, sourceBlobsRecovered: persisted.length,
    sourceHashVerified: true, precisionLossSourceRejected: true, credentialsExcluded: true, reviewPersisted: true, navigationKeptQueueRunning: true, savedProjectsHandoff: true,
    actualConverterExecuted: false, note: 'HTTP worker fixtures exercised the actual browser queue, WorkerClient and IndexedDB; no real BIM conversion was claimed.'};
  await writeFile(resolve(outputDir, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally {await browser?.close(); await new Promise(resolve => server.close(resolve));}
