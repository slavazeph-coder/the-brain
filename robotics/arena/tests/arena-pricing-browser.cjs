/* Actual browser pricing interactions. All assumptions are hypothetical; no worker runs. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module');
const { makeReport } = require('./arena-campaign-report-fixture.cjs');
const app = path.resolve(__dirname, '../../../brainsnn-r3f-app'), assets = path.join(app, 'public/arena');
const { chromium } = createRequire(path.join(app, 'package.json'))('@playwright/test');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Illustrative pricing fixture</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/arena-campaign.css"><style>body{margin:0;background:#080c12;color:#f4f7fb}main{max-width:1160px;margin:auto;padding:0 22px}</style></head><body><main><div id="arena-campaign-root"></div></main><script>window.BrainSNNExperiment={getState:()=>({robotId:'panda',modelId:'pi05',task:'libero_spatial:0',seed:'7',mode:'robot-preview',protocol:'benchmark'})}</script><script src="/arena-profiles.js"></script><script src="/arena-pricing.js"></script><script src="/arena-campaign.js"></script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/test.html') { res.setHeader('Content-Type', 'text/html'); res.end(html); return; }
  const name = req.url.slice(1);
  if (!/^[a-z-]+\.(js|css)$/.test(name) || !fs.existsSync(path.join(assets, name))) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/css'); res.end(fs.readFileSync(path.join(assets, name)));
});
(async () => {
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : process.platform === 'darwin' ? { channel: 'chrome' } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), requests = [], errors = [];
    page.on('request', req => requests.push(req.url())); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/test.html'); await page.waitForLoadState('networkidle');
    const baselineRequests = requests.length, preview = page.locator('[data-arena-pricing]');
    const field = key => preview.locator(`[data-pricing-field="${key}"]`), output = key => preview.locator(`[data-pricing-output="${key}"]`);
    const total = preview.locator('[data-pricing-total]');
    const fill = async values => { for (const [key, value] of Object.entries(values)) await field(key).fill(String(value)); };
    const defaults = { episodes: 100000, episodesPerWorkerHour: 500, hourlyRateUSD: .60, grossMarginPercent: 30 };
    await page.getByRole('heading', { name: 'Test packs & pricing', exact: true }).waitFor();
    assert.equal(await total.innerText(), 'US$171.43');
    assert.equal(await output('runtimeCostUSD').innerText(), 'US$120.00');
    assert.equal(await output('serviceMarginAllowanceUSD').innerText(), 'US$51.43');
    assert.equal(await output('workerHours').innerText(), '200');
    assert.equal(await output('pricePerEpisodeUSD').innerText(), 'US$0.001714');
    assert.equal(await field('grossMarginPercent').getAttribute('max'), '75');
    assert.match(await preview.innerText(), /unmeasured for Panda/);
    assert.match(await preview.innerText(), /operator support and tax. Not a quote/);
    assert.equal(await preview.getByRole('button').count(), 3, 'pricing has only count presets, no purchase or execution action');
    await page.screenshot({ path: '/tmp/arena-transparent-pricing-desktop.png', fullPage: true });

    for (const [episodes, price] of [[10, 'US$0.02'], [1000, 'US$1.71'], [100000, 'US$171.43']]) {
      await preview.locator(`[data-pricing-episodes="${episodes}"]`).click();
      assert.equal(await total.innerText(), price);
      assert.equal(await page.locator('[data-campaign-field="totalTrials"]').inputValue(), '10', 'hypothetical pricing count never alters executable campaign draft');
      assert.equal(await page.locator('[data-campaign-field="pilotEpisodes"]').inputValue(), '');
      assert.equal(await page.locator('[data-campaign-field="hourlyRateUSD"]').inputValue(), '');
    }
    await fill({ grossMarginPercent: 0 }); assert.equal(await total.innerText(), 'US$120.00');
    await fill({ hourlyRateUSD: 1.2, grossMarginPercent: 30 }); assert.equal(await total.innerText(), 'US$342.86');
    await fill({ episodesPerWorkerHour: .01 }); assert.equal(await total.innerText(), 'US$17,142,857.14', 'slow counterfactual throughput is allowed');
    await fill({ episodes: 1, episodesPerWorkerHour: 40, hourlyRateUSD: .6, grossMarginPercent: 50 });
    assert.equal(await total.innerText(), 'US$0.03'); assert.equal(await output('runtimeCostUSD').innerText(), 'US$0.02'); assert.equal(await output('serviceMarginAllowanceUSD').innerText(), 'US$0.01', 'displayed breakdown sums to the rounded price');

    for (const [key, invalid] of [['episodes', ''], ['episodes', '0'], ['episodes', '1.5'], ['episodes', '100001'], ['episodesPerWorkerHour', '0'], ['episodesPerWorkerHour', '-1'], ['episodesPerWorkerHour', '10000001'], ['hourlyRateUSD', '0'], ['hourlyRateUSD', '-1'], ['hourlyRateUSD', '10001'], ['grossMarginPercent', '-1'], ['grossMarginPercent', '76'], ['grossMarginPercent', '100']]) {
      await fill(defaults); await field(key).fill(invalid);
      assert.equal(await field(key).getAttribute('aria-invalid'), 'true', key + '=' + invalid);
      assert.equal(await total.innerText(), '—', 'invalid edit clears stale total');
      assert.deepEqual(await preview.locator('[data-pricing-output]').allTextContents(), ['—', '—', '—', '—']);
      assert.equal(await field(key).inputValue(), invalid, 'invalid assumptions are not clamped or replaced');
    }
    await field('episodesPerWorkerHour').evaluate(element => { element.value = '1e309'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await total.innerText(), '—', 'nonfinite number input cannot produce a price');

    await fill({ episodes: 512, episodesPerWorkerHour: 32, hourlyRateUSD: 2, grossMarginPercent: 25 });
    assert.equal(await total.innerText(), 'US$42.67');
    await page.locator('[data-campaign-tools] > summary').click();
    const download = page.waitForEvent('download'); await page.locator('[data-campaign-export]').click();
    const plan = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
    assert.equal(plan.trials.total, 10); assert.equal(plan.pilot, null); assert.equal(plan.estimate, null);
    assert.equal(plan.execution.workersStarted, 0); assert.equal(plan.execution.budgetEnforced, false);
    assert(!JSON.stringify(plan).includes('episodesPerWorkerHour'), 'pricing assumptions never enter execution export');
    await page.locator('[data-campaign-report-file]').setInputFiles({ name: 'report.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(makeReport())) });
    await page.getByText('Complete execution · 2/2 episodes completed', { exact: true }).waitFor();
    assert.equal(await total.innerText(), 'US$42.67', 'imported evidence does not replace hypothetical assumptions');
    assert.equal(await field('episodes').inputValue(), '512');
    assert.equal(await page.locator('[data-campaign-field="pilotEpisodes"]').inputValue(), '', 'report summary cannot become pilot proof');
    await page.locator('[data-campaign-tools] > summary').click();

    await fill(defaults);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no overflow at ' + width);
      const bounds = await total.boundingBox(); assert(bounds.y >= 0 && bounds.y + bounds.height < 844, 'default public price is visible on first mobile screen');
      await fill({ episodesPerWorkerHour: .001, hourlyRateUSD: 10000, grossMarginPercent: 75 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'large valid prices do not overflow at ' + width);
      await fill(defaults);
    }
    await page.screenshot({ path: '/tmp/arena-transparent-pricing-mobile.png', fullPage: true });
    assert.deepEqual(requests.slice(baselineRequests).filter(url => !url.startsWith('blob:')), [], 'pricing and local evidence inspection make no new network requests');
    assert.deepEqual(errors, []);
    console.log('ARENA_PRICING_BROWSER_OK: US$171.43 defaults, service-margin breakdown, presets, slower throughput, consistent cent rounding, invalid edits clear totals, no quote/execution calls, pricing isolated from campaign exports and report evidence,390px and320px layout.');
  } finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
