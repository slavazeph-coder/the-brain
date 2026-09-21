// Glass presentation acceptance. Real first-party geometry; never submits a design or payment.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const live = process.argv.includes('--live');
const out = path.resolve('sponsorship/gt3/reports');
fs.mkdirSync(out, { recursive: true });
const report = { scope: live ? 'Published glass UI, actual WebGL, GET only' : 'Isolated glass UI, actual WebGL, GET only', checks: [], errors: [], requests: [] };
const check = (name, ok) => { assert.ok(ok, name); report.checks.push(name); console.log('PASS ' + name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let server, handler, dir, browser;
let base = 'https://www.brainsnn.com';
try {
  if (!live) {
    process.env.GT3_SKIP_PRELOAD = 'true';
    const { createHandler } = createRequire(import.meta.url)('../server.cjs');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt3-glass-'));
    server = http.createServer((req, res) => handler.matches(req.url) ? void handler.handle(req, res) : (res.writeHead(404), res.end()));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
    handler = createHandler({ origin: base, dbPath: path.join(dir, 'glass.sqlite'), env: {} });
  } else {
    let found = false;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetch(base + '/sponsor/gt3/?glass-check=' + Date.now(), { signal: AbortSignal.timeout(15000) });
        if (r.ok && (await r.text()).includes('data-ui="glass-v1"')) { found = true; break; }
      } catch {}
      await sleep(6000);
    }
    check('Expected glass release is published', found);
  }
  browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.setDefaultTimeout(60000);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) report.requests.push({ url: new URL(r.url()).origin + new URL(r.url()).pathname, method: r.method() }); });
  await page.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort());
  await page.goto(base + '/sponsor/gt3/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.GT3_RENDER_STATUS?.ready || window.GT3_RENDER_STATUS?.fail, {}, { timeout: 120000 });
  report.render = await page.evaluate(() => window.GT3_RENDER_STATUS);
  check('The real Porsche renders inside the glass layout', report.render.ready && report.render.triangles > 100000);
  check('Glass release marker present', await page.locator('body').getAttribute('data-ui') === 'glass-v1');
  check('Eight placement options preserved', await page.locator('#placement option').count() === 8);
  check('One first-party canvas and no iframe', await page.locator('#scene canvas').count() === 1 && await page.locator('iframe').count() === 0);
  const surfaces = await page.evaluate(() => ['aside', '.visual', '#scene', '#scene canvas'].map(s => { const e = document.querySelector(s), c = getComputedStyle(e); return { selector: s, filter: c.filter, backdrop: c.backdropFilter, radius: c.borderTopLeftRadius, background: c.backgroundColor }; }));
  report.surfaces = surfaces;
  check('Inspector has a real frosted-glass treatment', surfaces[0].backdrop.includes('blur'));
  check('No expensive blur or filter is put over the 3D canvas', surfaces.slice(1).every(s => s.filter === 'none' && s.backdrop === 'none'));
  check('No external fonts or image dependencies', await page.locator('link[href*="fonts.googleapis"],script[src^="https://"]').count() === 0);
  await page.locator('#scene canvas').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  check('The model receives pointer input, not an overlay', await page.locator('#scene canvas').evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; }));
  await page.screenshot({ path: path.join(out, live ? 'glass-live-desktop.png' : 'glass-desktop.png'), fullPage: true, timeout: 60000 });
  const logo = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#a4e4ec'; x.fillRect(20, 76, 8, 72); x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.font = '600 48px Arial'; x.fillText('YOUR BRAND', 275, 135); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('#logo').setInputFiles({ name: 'local-visual-fixture.png', mimeType: 'image/png', buffer: Buffer.from(logo, 'base64') });
  await page.waitForFunction(() => window.GT3_RENDER_STATUS?.decals === 1);
  check('Actual uploaded logo remains on the car surface', await page.evaluate(() => window.GT3_DESIGN.snapshot().zone === 'driver-door'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, live ? 'glass-live-logo.png' : 'glass-logo.png'), fullPage: true, timeout: 60000 });
  const start = await page.evaluate(() => window.GT3_RENDER_STATUS.camera);
  const rect = await page.locator('#scene canvas').boundingBox();
  await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height * .5); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * .35, rect.y + rect.height * .52, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  check('Drag still moves the real 3D camera', JSON.stringify(start) !== JSON.stringify(await page.evaluate(() => window.GT3_RENDER_STATUS.camera)));
  await page.locator('#primary-cta').click();
  await page.waitForFunction(() => !document.getElementById('submit').disabled);
  check('The real review form still connects', await page.locator('#proposal').evaluate(e => e.open));
  check('Uploaded logo appears in the glass review', await page.locator('#review-logo').evaluate(e => e.complete && e.naturalWidth === 512));
  check('Payment activation is not changed by this release', (await page.locator('#submit').textContent()).includes('request checkout'));
  await page.screenshot({ path: path.join(out, live ? 'glass-live-review.png' : 'glass-review.png'), timeout: 60000 });
  await page.keyboard.press('Escape');
  check('Escape returns focus to the review button', await page.locator('#primary-cta').evaluate(e => e === document.activeElement));
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    check('No horizontal overflow at ' + width, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#placement').selectOption('driver-door');
  await page.locator('#scene canvas').scrollIntoViewIfNeeded(); await page.waitForTimeout(700);
  check('Touch layout uses readable 16px form controls', await page.locator('#placement').evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 16));
  check('Mobile canvas still receives input', await page.locator('#scene canvas').evaluate(e => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; }));
  await page.screenshot({ path: path.join(out, live ? 'glass-live-mobile.png' : 'glass-mobile.png'), fullPage: true, timeout: 60000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-reduced-transparency', value: 'reduce' }] });
  check('Reduced-motion preference disables decorative animation', await page.locator('.loader-orbit').evaluate(e => getComputedStyle(e).animationName === 'none'));
  check('Reduced transparency switches glass to a solid surface', await page.locator('aside').evaluate(e => getComputedStyle(e).backdropFilter === 'none' && getComputedStyle(e).backgroundColor === 'rgb(24, 33, 51)'));
  check('All model and data requests stay same-origin', report.requests.every(r => r.url.startsWith(base + '/')));
  check('No design submission or charge attempted', report.requests.every(r => ['GET', 'HEAD'].includes(r.method)));
  check('No top-level JavaScript errors', report.errors.length === 0);
} catch (e) { report.failure = e.stack; process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(out, live ? 'glass-live.json' : 'glass-ui.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  handler?.close(); if (dir) fs.rmSync(dir, { recursive: true, force: true });
}
