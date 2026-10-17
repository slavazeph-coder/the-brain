/* Real browser uploads and rendering of synthetic summaries. No policy or GPU runs. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { makeReport } = require('./arena-campaign-report-fixture.cjs');
const app = path.resolve(__dirname, '../../../brainsnn-r3f-app'), assets = path.join(app, 'public/arena');
const { chromium } = createRequire(path.join(app, 'package.json'))('@playwright/test');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Campaign import fixture</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/arena-campaign.css"><style>body{margin:0;background:#080c12;color:#f4f7fb}main{max-width:1160px;margin:auto;padding:0 22px}button,input,select{font:inherit}</style></head><body><main><div id="arena-campaign-root"></div></main><script>window.BrainSNNExperiment={getState:()=>({robotId:'panda',modelId:'pi05',task:'libero_spatial:0',seed:'7',mode:'robot-preview',protocol:'benchmark'})}</script><script src="/arena-profiles.js"></script><script src="/arena-campaign.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/test.html') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const name = req.url.slice(1);
  if (!/^[a-z-]+\.(js|css)$/.test(name) || !fs.existsSync(path.join(assets, name))) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(assets, name)));
});
const upload = report => ({ name: 'campaign-report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(report)) });
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), requests = [], errors = [];
    page.on('request', req => requests.push(req.url())); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/test.html'); await page.waitForLoadState('networkidle');
    const baselineRequests = requests.length, input = page.getByRole('textbox', { name: 'Open campaign report JSON' });
    const picker = page.locator('[data-campaign-report-file]'), report = page.locator('[data-campaign-report]'), status = page.locator('[data-campaign-report-status]');
    assert.equal(await page.locator('[data-campaign-field="totalTrials"]').inputValue(), '10');
    assert.equal(await page.locator('[data-campaign-field="protocol"]').inputValue(), 'benchmark');
    await picker.setInputFiles(upload(makeReport()));
    await page.getByText('Complete execution · 2/2 episodes completed', { exact: true }).waitFor();
    assert.equal(await report.locator('tbody tr').count(), 2);
    assert.match(await report.innerText(), /Task success[\s\S]*Task miss[\s\S]*Infrastructure error[\s\S]*Partial recording/);
    assert.match(await report.locator('tbody tr').nth(1).innerText(), /Task miss[\s\S]*220 steps/);
    assert.match(await status.innerText(), /Summary remains unverified/);
    assert.equal(await page.locator('[data-campaign-field="pilotEpisodes"]').inputValue(), '');
    await page.screenshot({ path: '/tmp/arena-campaign-report-desktop.png', fullPage: true });

    const hostile = makeReport(), markup = '<img src="https://untrusted.invalid/beacon" onerror="window.__reportExecuted=true">';
    hostile.campaignId = markup; hostile.checkpointRevision = markup; hostile.cases[0].bundlePath = markup; hostile.cases[0].recordingId = markup;
    hostile.workerUrl = 'https://untrusted.invalid/worker'; hostile.apiToken = 'PRIVATE_FIELD_MUST_NOT_RENDER';
    await picker.setInputFiles(upload(hostile)); await page.waitForFunction(() => document.querySelector('.campaign-report-metadata')?.textContent.includes('<img'));
    assert.equal(await report.locator('img,iframe,script,a').count(), 0, 'untrusted strings cannot create HTML or links');
    assert.equal(await page.evaluate(() => Boolean(window.__reportExecuted)), false);
    assert(!await report.innerText().then(text => text.includes('PRIVATE_FIELD_MUST_NOT_RENDER')));
    assert.match(await report.innerText(), /https:\/\/untrusted.invalid\/beacon/);
    assert.equal(await picker.inputValue(), '', 'same file can be selected again');

    await picker.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{') });
    await page.waitForFunction(() => document.querySelector('[data-campaign-report-status]')?.textContent.includes('Invalid JSON'));
    assert.equal(await report.isHidden(), true, 'invalid upload clears the previous summary');
    await picker.setInputFiles({ name: 'oversized.json', mimeType: 'application/json', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32) });
    await page.waitForFunction(() => document.querySelector('[data-campaign-report-status]')?.textContent.includes('2 MiB'));
    const contradicted = makeReport(); contradicted.counts.task_success = 2;
    await picker.setInputFiles(upload(contradicted)); await page.waitForFunction(() => document.querySelector('[data-campaign-report-status]')?.textContent.includes('counts do not match'));
    assert.equal(await report.isHidden(), true);

    await picker.setInputFiles(upload(makeReport(['infrastructure_error', 'partial_recording'])));
    await page.getByText('Partial campaign · 0/2 episodes completed', { exact: true }).waitFor();
    assert.match(await report.locator('tbody').innerText(), /Infrastructure error[\s\S]*Partial recording/);
    await picker.setInputFiles(upload(makeReport(['task_success', 'interrupted', 'unattempted'])));
    await page.getByText('Interrupted campaign · 1/3 episodes completed', { exact: true }).waitFor();
    assert.match(await report.locator('tbody').innerText(), /Interrupted[\s\S]*Not attempted/);

    await page.locator('[data-campaign-trials="1000"]').click();
    await page.locator('[data-campaign-field="maxWorkers"]').fill('10');
    await page.locator('[data-campaign-trials="10"]').click();
    assert.equal(await page.locator('[data-campaign-field="maxWorkers"]').inputValue(), '1');
    await page.locator('[data-campaign-field="protocol"]').selectOption('practice');
    assert.match(await page.locator('[data-campaign-operator-note]').textContent(), /practice plan will be rejected/);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no page overflow at ' + width);
      const table = report.locator('.campaign-report-table-wrap');
      assert.equal(await table.evaluate(element => element.scrollWidth > element.clientWidth), true, 'table stays inside its own horizontal scroller');
    }
    await page.screenshot({ path: '/tmp/arena-campaign-report-mobile.png', fullPage: true });
    assert.equal(requests.length, baselineRequests, 'import, validation and rendering issue no additional network requests');
    assert.deepEqual(errors, []);
    console.log('ARENA_CAMPAIGN_BROWSER_OK: actual file import, complete/miss/partial/interrupted outcomes, contradictory and oversized rejection, inert hostile strings, unknown-field omission, no implicit pilot data, one-worker preset, no network requests, 390px and 320px layout.');
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
