import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve('sponsorship');
const out = path.join(root, 'reports');
await fs.mkdir(out, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sponsor-browser-'));
const base = 'http://127.0.0.1:8091';
const child = spawn(process.execPath, [path.join(root, 'server.cjs')], {
  env: { ...process.env, NODE_ENV: 'test', PORT: '8091', SPONSOR_DB_PATH: path.join(temp, 'browser.sqlite'), SPONSOR_PUBLIC_ORIGIN: base, SPONSOR_SESSION_SECRET: 'browser-test-only-secret', SPONSOR_ADMIN_KEY: 'browser-test-only-owner-key-at-least-32', SPONSOR_PAYMENTS_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => logs += data);
child.stderr.on('data', data => logs += data);
let browser;
const errors = [];
const evidence = { base, isolatedDatabase: true, paymentMode: 'disabled', checks: [], screenshots: [], viewports: [] };
const shot = async (locator, name, options = {}) => {
  await locator.screenshot({ path: path.join(out, name), ...options });
  evidence.screenshots.push(name);
};
try {
  for (let n = 0; n < 80; n++) {
    try { const r = await fetch(base + '/api/sponsors/status'); if (r.ok) break; } catch {}
    if (n === 79) throw new Error('Test server did not start: ' + logs);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/sponsor/', { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForSelector('#hero-robot[data-ready="true"]', { timeout: 120000 });
  const robotHeight = Number(await page.locator('#hero-robot').getAttribute('data-robot-height'));
  const robotWidth = Number(await page.locator('#hero-robot').getAttribute('data-robot-width'));
  assert.ok(robotHeight > 1 && robotHeight < 1.6 && robotHeight > robotWidth * 1.7, 'Reference G1 must be upright and correctly scaled.');
  evidence.checks.push(`Upright reference model: ${robotHeight} m tall / ${robotWidth} m wide.`);
  assert.equal(await page.locator('.zone-button').count(), 8);
  await page.waitForSelector('.zone-price');
  assert.equal(await page.locator('.zone-price').count(), 8);
  const catalog = await (await fetch(base + '/api/sponsors/catalog')).json();
  for (const zone of catalog.zones) {
    const name = await page.locator(`.zone-button[data-zone="${zone.id}"] .zone-name`).textContent();
    assert.equal(name, zone.name);
    const price = await page.locator(`.zone-button[data-zone="${zone.id}"] .zone-price`).textContent();
    assert.equal(Number(price.replace(/[^0-9]/g, '')), zone.opening / 100, 'Price card must match the real catalogue.');
  }
  const order = await page.locator('main > section').evaluateAll(nodes => nodes.map(node => node.id || node.classList[0]));
  assert.deepEqual(order, ['hero', 'studio', 'experience', 'formats-section', 'fleet', 'questions', 'closing']);
  assert.equal(await page.locator('.studio-journey li').count(), 3);
  assert.equal(await page.locator('.fleet-unit').count(), 3);
  evidence.checks.push('Seven-section journey, three campaign steps and eight real catalogue prices verified.');
  await shot(page, 'desktop-hero.png');
  await page.locator('#studio').scrollIntoViewIfNeeded();
  await page.waitForSelector('#studio-robot[data-ready="true"]', { timeout: 120000 });
  assert.equal(await page.locator('#placement-adjustments').getAttribute('open'), null);
  await page.locator('#placement-adjustments summary').click();
  await page.locator('#logo-scale').fill('110');
  await page.locator('#logo-rotation').fill('10');
  assert.equal(await page.locator('#scale-value').textContent(), '110%');
  assert.equal(await page.locator('#rotation-value').textContent(), '10°');
  await page.locator('.zone-button[data-zone="shin"]').click();
  await page.locator('#panel-side').selectOption('right');
  assert.equal(await page.locator('#side-row').isVisible(), true);
  await page.locator('.zone-button[data-zone="chest"]').click();
  await page.locator('#clear-logo').click();
  await page.locator('#placement-adjustments summary').click();
  evidence.checks.push('Progressive logo size, angle, side controls and reset verified.');
  await page.locator('#brand-text').fill('NORTHSTAR');
  await page.waitForTimeout(1600);
  const decals = Number(await page.locator('#studio-robot').getAttribute('data-decals'));
  assert.ok(decals > 0, 'Expected genuine surface decals on G1 geometry.');
  evidence.checks.push('Sponsor branding projected onto robot surfaces; ' + decals + ' decals rendered.');
  const logo = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 200;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#2850c4'; ctx.font = 'bold 76px Arial'; ctx.textAlign = 'center'; ctx.fillText('NORTHSTAR', 250, 120);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('#logo-upload').setInputFiles({ name: 'example-brand-logo.png', mimeType: 'image/png', buffer: Buffer.from(logo, 'base64') });
  await page.waitForTimeout(1800);
  await shot(page.locator('.studio-grid'), 'desktop-studio-logo.png');
  await page.locator('.zone-button[data-zone="back"]').click();
  await page.waitForTimeout(2000);
  assert.equal(await page.locator('#placement-name').textContent(), 'Back');
  await shot(page.locator('.showroom'), 'robot-back-preview.png');
  await page.locator('.zone-button[data-zone="chest"]').click();
  await page.locator('#offer-button').click();
  await page.locator('[name="name"]').fill('Automated QA');
  await page.locator('[name="company"]').fill('Isolated Example Test');
  await page.locator('[name="email"]').fill('qa@example.com');
  await page.locator('[name="campaign"]').fill('This is an isolated browser test of the sponsorship application and must never be used as a real sales lead.');
  await page.locator('[name="privacyConsent"]').check();
  await shot(page.locator('#application-dialog'), 'application-desktop.png');
  await page.locator('#submit-application').click();
  await page.waitForSelector('#application-success:not([hidden])');
  const reference = await page.locator('#application-reference').inputValue();
  assert.match(reference, /^[a-f0-9-]{36}$/);
  evidence.checks.push('Real POST application saved to isolated persistent database and returned reference ' + reference + '.');
  await page.locator('#done-dialog').click();
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.waitForTimeout(500);
  evidence.desktopPageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  await shot(page, 'desktop-full-page.png', { fullPage: true });
  const axe = await new AxeBuilder({ page }).analyze();
  await fs.writeFile(path.join(out, 'accessibility.json'), JSON.stringify(axe.violations, null, 2));
  evidence.accessibility = axe.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length }));
  assert.equal(axe.violations.filter(v => ['critical', 'serious'].includes(v.impact)).length, 0, 'Accessibility issue.');
  const ownerContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const owner = await ownerContext.newPage();
  await owner.goto(base + '/sponsor/admin/');
  await owner.locator('#owner-login:not([hidden])').waitFor();
  await owner.locator('[name=password]').fill('browser-test-only-owner-key-at-least-32');
  await owner.locator('#owner-login button').click();
  await owner.locator('#owner-workspace:not([hidden])').waitFor();
  await owner.getByRole('heading', { name: 'Isolated Example Test' }).waitFor();
  evidence.checks.push('Owner authenticated and reviewed the actual saved application.');
  await shot(owner, 'owner-dashboard.png', { fullPage: true });
  await ownerContext.close();
  for (const width of [390, 320, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + '/sponsor/', { waitUntil: 'networkidle' });
    await page.waitForSelector('#hero-robot[data-ready="true"]', { timeout: 120000 });
    await page.waitForSelector('.zone-price');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(overflow, false, 'Horizontal overflow at ' + width + 'px');
    evidence.viewports.push({ width, overflow, pageHeight: await page.evaluate(() => document.documentElement.scrollHeight) });
    await shot(page, `mobile-${width}-hero.png`);
    if (width < 700) {
      await page.locator('#menu-toggle').click();
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
      await page.locator('#menu-toggle').click();
      await page.locator('#section-navigation a[href="#studio"]').click();
      assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');
    }
    await page.locator('#studio').scrollIntoViewIfNeeded();
    await page.waitForSelector('#studio-robot[data-ready="true"]', { timeout: 120000 });
    await shot(page.locator('.studio-grid'), `studio-${width}.png`);
    await page.locator('#fixed-button').click();
    assert.equal(await page.locator('[name=amount]').getAttribute('readonly'), '');
    await shot(page, `mobile-${width}-application.png`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#application-dialog').isVisible(), false);
    if (width === 390) {
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
      await page.waitForTimeout(500);
      await shot(page, 'mobile-full-page.png', { fullPage: true });
    }
    evidence.checks.push('Responsive ' + width + 'px layout, fixed-price form, Escape close and applicable mobile navigation verified.');
  }
  assert.equal(errors.length, 0, 'Browser errors: ' + errors.join('; '));
  evidence.browserErrors = errors;
  evidence.ok = true;
} catch (error) {
  evidence.ok = false; evidence.error = error.stack; throw error;
} finally {
  await fs.writeFile(path.join(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
  await fs.writeFile(path.join(out, 'server.log'), logs);
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await fs.rm(temp, { recursive: true, force: true });
}
