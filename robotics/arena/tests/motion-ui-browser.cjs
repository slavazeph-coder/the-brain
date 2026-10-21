/* Real page, real 3D viewer and real pre-generated planner outputs. The motion API is a contract double that
   replays a recorded response; the model-backed path is covered by docs/motion-worker.md qualification runs. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const app = nodePath.resolve(__dirname, '../../../brainsnn-r3f-app');
const { chromium } = createRequire(nodePath.join(app, 'package.json'))('@playwright/test');
const publicRoot = nodePath.join(app, 'public');
const artifacts = nodePath.resolve(__dirname, '../../../output/playwright');
const examples = JSON.parse(fs.readFileSync(nodePath.join(publicRoot, 'arena/motion/examples.json'), 'utf8'));
const TYPES = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary', '.urdf': 'application/xml', '.md': 'text/markdown', '.txt': 'text/plain', '.svg': 'image/svg+xml' };

let mode = 'offline';
const requests = [];
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const json = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
  if (pathname === '/api/motion/status') {
    return json(200, mode === 'offline' ? { configured: false, status: 'not_configured', efforts: [], maxVariants: 4, maxPromptLength: 300 }
      : { configured: true, status: 'online', efforts: [{ effort: 'medium', planner: '4B' }, { effort: 'low', planner: '0.8B' }], maxVariants: 4, maxPromptLength: 300 });
  }
  if (pathname === '/api/motion/generate') {
    let body = '';
    request.on('data', (part) => { body += part; }).on('end', () => {
      const payload = JSON.parse(body); requests.push(payload);
      if (mode === 'planner_failed') return json(422, { error: 'planner_failed' });
      const recorded = examples.find((example) => example.moves.length >= 2);
      setTimeout(() => json(200, { prompt: payload.prompt, effort: payload.effort, planner: payload.effort === 'low' ? '0.8B' : '4B', seed: payload.seed,
        idea: 'lean in, ears up', recipe: recorded.recipe, moves: recorded.moves.slice(0, payload.n),
        durations_s: recorded.moves.slice(0, payload.n).map((move) => move.time.at(-1)), timing_ms: { planner: 290, generator: 21, reachability: 4, total: 315 }, source: 'live_worker' }), 150);
    });
    return;
  }
  const file = nodePath.resolve(publicRoot, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
  if (!file.startsWith(publicRoot + nodePath.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  response.setHeader('Content-Type', TYPES[nodePath.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(response);
});

(async () => {
  let browser;
  try {
    fs.mkdirSync(artifacts, { recursive: true });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'],
      ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
    const errors = [], external = [];
    const open = async (viewport) => {
      const page = await browser.newPage({ viewport, acceptDownloads: true });
      page.on('pageerror', (error) => errors.push(error.message));
      // The deliberate planner failure below is a 422 the browser logs as a failed resource; nothing else may be.
      page.on('console', (message) => { if (message.type() === 'error' && !/status of 422/.test(message.text())) errors.push(message.text()); });
      page.on('request', (request) => { if (!request.url().startsWith(base) && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) external.push(request.url()); });
      await page.goto(base + '/arena/motion/');
      await page.waitForFunction(() => document.documentElement.dataset.motionReady === 'true', null, { timeout: 120000 });
      return page;
    };
    const state = (page) => page.evaluate(() => window.BrainSNNMotion.state());

    // No worker: recorded examples play, generation is unavailable and says why.
    let page = await open({ width: 1440, height: 1000 });
    let s = await state(page);
    assert.equal(s.viewer, true);
    assert.equal(s.source, 'example');
    assert(s.frames > 25);
    assert.equal(await page.locator('#generate').isDisabled(), true);
    assert.match(await page.textContent('#worker-note'), /No motion worker is connected/);
    assert.match(await page.textContent('#source-label'), /RECORDED EXAMPLE/);
    assert.equal(await page.textContent('#planner'), '27B · recorded');
    const first = s.frame;
    await page.waitForFunction((frame) => window.BrainSNNMotion.state().frame !== frame, first, { timeout: 30000 });
    await page.click('#play');
    assert.equal((await state(page)).playing, false);
    const paused = (await state(page)).frame;
    await page.waitForTimeout(800);
    assert.equal((await state(page)).frame, paused);
    await page.click('#play');
    for (const camera of ['front', 'side', 'orbit']) {
      await page.click(`[data-camera=${camera}]`);
      assert.equal(await page.getAttribute(`[data-camera=${camera}]`, 'aria-pressed'), 'true');
    }
    const exampleButtons = page.locator('#examples button');
    assert(await exampleButtons.count() >= 20);
    await exampleButtons.nth(3).click();
    s = await state(page);
    assert.equal(s.prompt, examples[3].prompt);
    assert.equal(await exampleButtons.nth(3).getAttribute('aria-pressed'), 'true');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const move = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(move.time.length, examples[3].moves[0].time.length);
    assert.deepEqual(move.set_target_data[0].head, examples[3].moves[0].set_target_data[0].head);
    // Re-open the downloaded move as a file.
    await page.setInputFiles('#file', { name: 'opened.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(move)) });
    await page.waitForFunction(() => window.BrainSNNMotion.state().source === 'file', null, { timeout: 10000 });
    s = await state(page);
    assert.equal(s.source, 'file');
    assert.equal(s.frames, move.time.length);
    await page.setInputFiles('#file', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"time":[0]}') });
    await page.waitForFunction(() => /not a Reachy Mini move/.test(document.querySelector('#run-message').textContent), null, { timeout: 10000 });
    assert.equal((await state(page)).source, 'file');
    await page.screenshot({ path: nodePath.join(artifacts, 'motion-offline-desktop.png'), fullPage: true });
    assert.equal(requests.length, 0);
    await page.close();

    // Connected worker: the instruction, planner and variation count reach the API; the reply plays as live.
    mode = 'online';
    page = await open({ width: 1440, height: 1000 });
    assert.equal(await page.locator('#generate').isDisabled(), false);
    assert.deepEqual(await page.$$eval('#effort option', (options) => options.map((option) => option.value)), ['medium', 'low']);
    await page.click('#generate');
    assert.match(await page.textContent('#run-message'), /Describe the behaviour first/);
    assert.equal(await page.getAttribute('#prompt', 'aria-invalid'), 'true');
    await page.fill('#prompt', '  excited.   Greet a visitor   who just walked in. ');
    await page.selectOption('#effort', 'low');
    await page.selectOption('#variants', '2');
    await page.click('#generate');
    await page.waitForFunction(() => window.BrainSNNMotion.state().source === 'live_worker', null, { timeout: 30000 });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prompt, 'excited. Greet a visitor who just walked in.');
    assert.equal(requests[0].effort, 'low');
    assert.equal(requests[0].n, 2);
    assert(Number.isInteger(requests[0].seed));
    s = await state(page);
    assert.equal(s.moves, 2);
    assert.match(await page.textContent('#source-label'), /LIVE/);
    assert.equal(await page.textContent('#planner'), '0.8B · live');
    assert.equal(await page.textContent('#latency'), '315 ms');
    assert.equal(await page.locator('#variant-tabs').isVisible(), true);
    await page.click('#variant-tabs button:nth-child(2)');
    assert.equal((await state(page)).variant, 1);
    assert.equal(await page.getAttribute('#variant-tabs button:nth-child(2)', 'aria-pressed'), 'true');
    await page.screenshot({ path: nodePath.join(artifacts, 'motion-live-desktop.png'), fullPage: true });

    mode = 'planner_failed';
    await page.fill('#prompt', 'something the planner cannot express');
    await page.click('#generate');
    await page.waitForFunction(() => document.querySelector('#run-message').classList.contains('error'), null, { timeout: 30000 });
    assert.match(await page.textContent('#run-message'), /planner could not write a valid motion/);
    assert.equal((await state(page)).source, 'live_worker');
    await page.close();

    // Mobile: no horizontal overflow, the viewer and the instruction box are reachable.
    mode = 'online';
    page = await open({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal((await state(page)).viewer, true);
    await page.locator('#prompt').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#prompt').isVisible(), true);
    await page.screenshot({ path: nodePath.join(artifacts, 'motion-mobile.png'), fullPage: true });
    await page.close();

    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('Expressive motion browser flows passed (offline, live contract, planner failure, file round trip, mobile).');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
