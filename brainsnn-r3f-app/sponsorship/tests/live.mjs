import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// Public, read-only deployment verification. Never submit real applications,
// sign in as the owner, create reservations, or contact Stripe from this test.
const base = 'https://www.brainsnn.com';
const out = path.resolve('sponsorship/reports/live');
await fs.mkdir(out, { recursive: true });
const evidence = { base, checkedAt: new Date().toISOString(), productionApplicationsSubmitted: 0, stripeChargesCreated: 0, http: [], screenshots: [], checks: [] };
const get = async (url) => fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await get(base + '/api/sponsors/status');
      const state = await response.json();
      if (response.ok && state.storage === 'persistent_sqlite') { ready = true; break; }
    } catch {}
    if (attempt < 29) await new Promise(resolve => setTimeout(resolve, 10000));
  }
  assert.ok(ready, 'Sponsor API is not active in the publicly hosted application.');
  for (const endpoint of ['/', '/healthz', '/sponsor/', '/api/sponsors/status', '/api/sponsors/catalog', '/api/sponsors/admin/applications']) {
    const response = await get(base + endpoint);
    evidence.http.push({ endpoint, status: response.status, contentType: response.headers.get('content-type') });
    assert.equal(response.status, endpoint.includes('/admin/') ? 401 : 200, endpoint);
    if (endpoint === '/sponsor/') assert.match(await response.text(), /Your brand/);
    if (endpoint === '/api/sponsors/status') { const state = await response.json(); evidence.storage = state.storage; evidence.payments = state.payments; assert.equal(state.storage, 'persistent_sqlite'); }
    if (endpoint === '/api/sponsors/catalog') { const catalog = await response.json(); evidence.zoneCount = catalog.zones.length; assert.equal(catalog.zones.length, 8); }
  }
  const apex = await get('https://brainsnn.com/sponsor/');
  assert.equal(apex.status, 200); assert.match(await apex.text(), /Your brand/);
  evidence.http.push({ endpoint: 'https://brainsnn.com/sponsor/', status: apex.status });
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Guard the test itself against creating customer records or payments.
  await page.route('**/api/sponsors/**', async route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) throw new Error('Live QA attempted a write request.');
    return route.continue();
  });
  await page.goto(base + '/sponsor/', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('#hero-robot[data-ready="true"]', { timeout: 120000 });
  evidence.title = await page.title();
  evidence.robotHeight = Number(await page.locator('#hero-robot').getAttribute('data-robot-height'));
  assert.ok(evidence.robotHeight > 1 && evidence.robotHeight < 1.6);
  assert.equal(await page.locator('.zone-button').count(), 8);
  await page.screenshot({ path: path.join(out, 'live-desktop-hero.png') });
  evidence.screenshots.push('live-desktop-hero.png');
  await page.locator('#studio').scrollIntoViewIfNeeded();
  await page.waitForSelector('#studio-robot[data-ready="true"]', { timeout: 120000 });
  await page.locator('#brand-text').fill('XIO');
  const logo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 200;
    const c = canvas.getContext('2d'); c.fillStyle = '#2049bb'; c.font = 'bold 100px Arial'; c.textAlign = 'center'; c.fillText('XIO', 250, 140);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#logo-upload').setInputFiles({ name: 'xio-local-preview.png', mimeType: 'image/png', buffer: Buffer.from(logo, 'base64') });
  await page.waitForTimeout(2000);
  evidence.decals = Number(await page.locator('#studio-robot').getAttribute('data-decals'));
  assert.ok(evidence.decals > 0, 'No on-surface logo decals rendered.');
  await page.locator('.studio-grid').screenshot({ path: path.join(out, 'live-studio-logo.png') });
  evidence.screenshots.push('live-studio-logo.png');
  await page.locator('.zone-button[data-zone="back"]').click();
  await page.waitForTimeout(1800);
  assert.equal(await page.locator('#placement-name').textContent(), 'Back');
  await page.locator('.showroom').screenshot({ path: path.join(out, 'live-back-view.png') });
  evidence.screenshots.push('live-back-view.png');
  await page.locator('.zone-button[data-zone="chest"]').click();
  await page.locator('#fixed-button').click();
  await page.locator('#application-dialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('[name=amount]').getAttribute('readonly'), '');
  await page.locator('#application-dialog').screenshot({ path: path.join(out, 'live-application.png') });
  evidence.screenshots.push('live-application.png');
  await page.keyboard.press('Escape');
  const accessibility = await new AxeBuilder({ page }).analyze();
  evidence.accessibility = accessibility.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) }));
  assert.equal(accessibility.violations.filter(v => ['critical', 'serious'].includes(v.impact)).length, 0);
  await page.screenshot({ path: path.join(out, 'live-full-page.png'), fullPage: true });
  evidence.screenshots.push('live-full-page.png');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/sponsor/', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForSelector('#hero-robot[data-ready="true"]', { timeout: 120000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow at ' + width);
    const filename = `live-mobile-${width}.png`;
    await page.screenshot({ path: path.join(out, filename) }); evidence.screenshots.push(filename);
  }
  assert.equal(errors.length, 0, errors.join('; '));
  evidence.browserErrors = errors;
  evidence.checks.push('Public HTTPS home, health, sponsor page, persistent API, catalogue and protected admin verified.', 'G1 reference geometry, logo upload, surface decals, back-view selection and fixed-price form verified.', 'Desktop and 390/320-pixel mobile checked without creating any customer record.');
  evidence.ok = true;
} catch (error) {
  evidence.ok = false; evidence.error = error.stack; process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await fs.writeFile(path.join(out, 'live-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}
