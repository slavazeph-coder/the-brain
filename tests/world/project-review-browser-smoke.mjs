/** Real browser + loopback HTTP acceptance. The model transport is explicitly
 * authored test data; this does not qualify live AI, reconstruction or pricing.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveProjectReviewFixture, REVIEW_FIXTURE_PASSCODE } from './project-review-browser-server.mjs';
import { demoSceneText } from '../../brainsnn-r3f-app/public/world/project-review.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const { chromium, webkit, devices, expect } = require('@playwright/test');
const output = new URL('../../output/playwright/world/', import.meta.url);
await mkdir(output, { recursive: true });
const fixture = await serveProjectReviewFixture();
const overallDeadline = setTimeout(() => {
  console.error('TIMEOUT project review browser acceptance or transport cleanup');
  process.exit(1);
}, 360000);
overallDeadline.unref();
const sha = value => createHash('sha256').update(value).digest('hex');
const results = [];

async function download(page, selector, label, extension) {
  console.log(`DOWNLOAD ${label}.${extension}`);
  const [item] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.locator(selector).click(),
  ]);
  const path = fileURLToPath(new URL(`project-review-${label}.${extension}`, output));
  await item.saveAs(path);
  console.log(`SAVED ${label}.${extension}`);
  return { path, text: await readFile(path, 'utf8') };
}

async function assertNoOverflow(page, label) {
  const width = await page.evaluate(() => ({
    layout: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    window: innerWidth,
  }));
  // Mobile browsers can enlarge innerWidth to accommodate overflowing content.
  // Compare against the actual configured viewport, not that expanded width.
  width.viewport = page.viewportSize().width;
  assert.ok(width.document <= width.viewport + 1, `Page overflows at ${label}: ${JSON.stringify(width)}`);
}

async function fillRates(page) {
  await page.locator('#pr-rate-details').evaluate(element => { element.open = true; });
  for (const [id, low, high] of [
    ['wall-standard', 10, 12], ['wall-premium', 20, 25],
    ['floor-standard', 25, 30], ['floor-premium', 30, 35],
  ]) {
    const row = page.locator(`[data-rate="${id}"]`);
    await row.locator('[data-rate-low]').fill(String(low));
    await row.locator('[data-rate-high]').fill(String(high));
    await row.locator('[data-rate-source]').fill('Authored fixture rates');
    await row.locator('[data-rate-date]').fill('2026-11-18');
    await row.locator('[data-rate-reviewed]').check();
  }
  await page.locator('#pr-rate-details').evaluate(element => { element.open = false; });
}

async function approve(page, name = 'Browser fixture reviewer') {
  await page.locator('#pr-reviewer').fill(name);
  await page.locator('#pr-decision-note').fill('Preliminary finish scope only; confirm site dimensions.');
  await page.locator('#pr-approval-check').check();
  await page.locator('#pr-approve').click();
  await expect(page.locator('#pr-mode')).toHaveText('PRELIMINARY APPROVAL');
}

async function check(browser, phone) {
  const label = `${browser.browserType().name()}-${phone ? 'phone' : 'desktop'}`;
  const context = await browser.newContext({
    ...(phone ? devices['iPhone 15'] : { viewport: { width: 1440, height: 1050 } }),
    deviceScaleFactor: 1, acceptDownloads: true, reducedMotion: 'reduce',
  });
  const page = await context.newPage(), errors = [];
  context.setDefaultTimeout(15000);
  context.setDefaultNavigationTimeout(30000);
  let stage = 'open studio';
  const mark = value => { stage = value; console.log(`STAGE ${label}: ${stage}`); };
  const deadline = setTimeout(() => {
    console.error(`TIMEOUT project review ${label} at ${stage}`);
    const stop = setTimeout(() => process.exit(1), 6000);
    void page.screenshot({ path: fileURLToPath(new URL(`project-review-${label}-timeout.png`, output)), fullPage: true, timeout: 5000 })
      .catch(error => console.error(`Timeout screenshot: ${error.message}`))
      .finally(() => { clearTimeout(stop); process.exit(1); });
  }, 120000);
  deadline.unref();
  page.on('pageerror', error => errors.push(error.message));
  try {
    mark('open studio');
    await page.goto(`${fixture.origin}/world/review.html`);
    await expect(page.locator('#project-review-host')).toHaveAttribute('data-build-marker', 'world-project-review-v1');
    // Honor the user's reduced-motion setting so long-page clicks and visual
    // assertions do not race the site's optional smooth scrolling.
    assert.equal(await page.locator('html').evaluate(element => getComputedStyle(element).scrollBehavior), 'auto');
    await expect(page.locator('#pr-run-local')).toBeDisabled();
    await page.locator('#pr-example').click();
    await expect(page.locator('#pr-run-local')).toBeEnabled();
    await expect(page.locator('#pr-source-name')).toContainText('authored');

    const beforeLocal = fixture.calls.length;
    mark('unpriced local comparison');
    await page.locator('#pr-run-local').click();
    await expect(page.locator('.pr-option')).toHaveCount(2);
    await expect(page.locator('#pr-mode')).toHaveText('LOCAL COMPARISON');
    await expect(page.locator('.pr-option').first()).toContainText('Rates needed');
    await assertNoOverflow(page, `${label} unpriced comparison`);
    assert.equal(fixture.calls.length, beforeLocal, 'Local comparison must never call a model.');
    const unpriced = JSON.parse((await download(page, '#pr-export-json', `${label}-unpriced`, 'json')).text);
    assert.equal(unpriced.approval, null);
    assert.equal(unpriced.report.execution, undefined);
    assert.equal(unpriced.report.options[0].subtotal, null);
    assert.deepEqual(unpriced.report.options[0].knownSubtotal, { low: 0, high: 0 });

    mark('enter reviewed rates');
    await fillRates(page);
    await page.locator('#pr-budget').fill('1000');
    await page.locator('#pr-run-local').click();
    await expect(page.locator('#pr-mode')).toHaveText('LOCAL COMPARISON');
    await expect(page.locator('.pr-option').first()).toContainText('564.30');

    mark('pending decision change');
    // Defer a real digest to exercise a human choice changing during approval.
    // No digest value is faked; the original Web Crypto operation still runs.
    await page.locator('#pr-reviewer').fill('Pending reviewer');
    await page.locator('#pr-approval-check').check();
    await page.evaluate(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      window.__reviewDigestHeld = false;
      window.__reviewDigestSettled = false;
      crypto.subtle.digest = async (...args) => {
        crypto.subtle.digest = original;
        window.__reviewDigestHeld = true;
        await new Promise(resolve => { window.__releaseReviewDigest = resolve; });
        try { return await original(...args); }
        finally { window.__reviewDigestSettled = true; }
      };
    });
    await page.locator('#pr-approve').click();
    await expect.poll(() => page.evaluate(() => window.__reviewDigestHeld)).toBe(true);
    await page.locator('[data-pr-select="option-b"]').click();
    await page.evaluate(() => window.__releaseReviewDigest());
    await expect.poll(() => page.evaluate(() => window.__reviewDigestSettled)).toBe(true);
    await expect(page.locator('.pr-approval')).toHaveAttribute('data-approved', 'false');
    const raced = JSON.parse((await download(page, '#pr-export-json', `${label}-decision-race`, 'json')).text);
    assert.equal(raced.approval, null, 'A stale asynchronous decision must not install an approval.');
    await page.locator('[data-pr-select="option-a"]').click();
    mark('record and export preliminary approval');
    await approve(page);
    const approved = JSON.parse((await download(page, '#pr-export-json', `${label}-approved`, 'json')).text);
    assert.equal(approved.input.source.sceneSha256, sha(demoSceneText()));
    assert.equal(approved.input.source.origin, 'authored-example');
    assert.deepEqual(approved.report.options[0].subtotal, { low: 564.3, high: 677.16 });
    assert.deepEqual(approved.report.options[1].subtotal, { low: 1992.6, high: 2418.75 });
    assert.equal(approved.report.options[0].budgetStatus, 'within');
    assert.equal(approved.report.options[1].budgetStatus, 'over');
    assert.equal(approved.approval.inputSha256, approved.input.inputSha256);
    assert.equal(approved.approval.optionId, 'option-a');
    assert.equal(approved.approval.validation.metricVerified, false);
    assert.equal(approved.approval.selfReported, true);

    mark('invalidate changed decision and brief');
    // Changing a decision clears its visible approval and exported approval.
    await page.locator('#pr-reviewer').fill('Changed reviewer');
    await expect(page.locator('.pr-approval')).toHaveAttribute('data-approved', 'false');
    const changed = JSON.parse((await download(page, '#pr-export-json', `${label}-changed`, 'json')).text);
    assert.equal(changed.approval, null);
    await approve(page);
    await page.locator('#pr-title').fill('Revised room refresh');
    await expect(page.locator('#pr-mode')).toHaveText('DRAFT WORKSPACE');
    await expect(page.locator('#pr-export-json')).toHaveCount(0);
    await page.locator('#pr-run-local').click();
    await expect(page.locator('.pr-option')).toHaveCount(2);
    await page.locator('[data-pr-select="option-b"]').click();
    await expect(page.locator('[data-pr-select="option-b"]')).toHaveAttribute('aria-pressed', 'true');

    mark('consent and owner session');
    // Review gates make no provider calls until consent and an owner session.
    await expect(page.locator('#pr-run-ai')).toBeEnabled();
    await page.locator('#pr-run-ai').click();
    await expect(page.locator('#pr-status')).toContainText('Confirm sending');
    assert.equal(fixture.calls.length, beforeLocal);
    await page.locator('#pr-ai-consent').check();
    await page.locator('#pr-run-ai').click();
    await expect(page.locator('#pr-status')).toContainText('Connect the owner');
    assert.equal(fixture.calls.length, beforeLocal);
    await page.locator('#pr-passcode').fill(REVIEW_FIXTURE_PASSCODE);
    await page.locator('#pr-connect').click();
    await expect(page.locator('#pr-login-status')).toContainText('Owner connected');

    mark('run authenticated AI transport');
    // Real authenticated HTTP uses all three specialists; HTML remains inert.
    const beforeAI = fixture.calls.length;
    await page.locator('#pr-run-ai').click();
    await expect(page.locator('#pr-mode')).toHaveText('AI REVIEW COMPLETE');
    assert.deepEqual(fixture.calls.slice(beforeAI).map(call => call.role), ['scope-planner', 'estimator', 'reviewer']);
    assert.equal(await page.evaluate(() => window.__reviewXss), undefined);
    await expect(page.locator('#pr-results img')).toHaveCount(0);
    await approve(page);
    const ai = JSON.parse((await download(page, '#pr-export-json', `${label}-ai`, 'json')).text);
    assert.equal(ai.report.execution.callCount, 3);
    assert.equal(ai.report.execution.provider, 'browser-transport-fixture');
    assert.equal(ai.report.transcript.length, 3);
    assert.deepEqual(ai.report.options[0].subtotal, { low: 564.3, high: 677.16 });
    assert.deepEqual(ai.report.options[1].subtotal, { low: 1992.6, high: 2418.75 });
    mark('export and inspect proposal');
    const html = await download(page, '#pr-export-html', `${label}-proposal`, 'html');
    assert.ok(html.text.includes('Approved for preliminary review'));
    assert.ok(html.text.includes('brainsnn.project-review-package.v1'));
    assert.ok(html.text.includes('&lt;img src=x onerror='));
    assert.ok(!html.text.includes('<img src=x onerror='));
    mark('open downloaded proposal file');
    const preview = await context.newPage();
    // Open the real downloaded document. document.write/setContent is not a
    // faithful navigation for an HTML file with a restrictive meta CSP.
    await preview.goto(pathToFileURL(html.path).href, { waitUntil: 'domcontentloaded' });
    mark('inspect downloaded proposal file');
    await expect(preview.locator('h1')).toHaveText('Revised room refresh');
    assert.equal(await preview.evaluate(() => window.__reviewXss), undefined);
    await preview.close();
    mark('capture review layout');

    // Closing a separate tab may focus the page's keyboard skip link. Return
    // focus to the reviewed content before taking its normal pointer-use view.
    await page.locator('.pr-results-heading h2').click();
    await expect(page.locator('.skip')).not.toBeFocused();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.skip')).not.toBeInViewport();
    if (phone) {
      const table = await page.locator('.pr-quantity-wrap').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth, tabIndex: element.tabIndex }));
      assert.ok(table.scroll >= 620 && table.scroll > table.width, 'Phone quantity details must scroll at a readable column width.');
      assert.equal(table.tabIndex, 0, 'Quantity details must be keyboard scrollable.');
    }
    await page.screenshot({ path: fileURLToPath(new URL(`project-review-${label}.png`, output)), fullPage: true });
    await assertNoOverflow(page, `${label} reviewed comparison`);

    mark('cancel review on changed brief');
    // Source/brief changes abort the active request; a late result cannot return.
    fixture.hold();
    const beforePending = fixture.calls.length;
    const beforeAbort = fixture.abortedCalls;
    await page.locator('#pr-run-ai').click();
    await expect(page.locator('#pr-mode')).toHaveText('AI TEAM WORKING');
    await expect.poll(() => fixture.calls.length).toBe(beforePending + 1);
    await page.locator('#pr-goal').fill('New brief while the earlier review is in flight.');
    await expect(page.locator('#pr-mode')).toHaveText('DRAFT WORKSPACE');
    // The server cannot observe cancellation until the HTTP disconnect arrives.
    await expect.poll(() => fixture.abortedCalls).toBe(beforeAbort + 1);
    fixture.release();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#pr-export-json')).toHaveCount(0);
    assert.equal(fixture.calls.length, beforePending + 1, 'Cancellation must stop later specialists.');

    mark('replace source with exact original bytes');
    // A replacement file is bound to its exact bytes, not JSON reserialization.
    const replacement = `${demoSceneText()}\n`;
    await page.locator('#pr-source-file').setInputFiles({ name: 'original-scene.json', mimeType: 'application/json', buffer: Buffer.from(replacement) });
    await expect(page.locator('#pr-run-local')).toBeEnabled();
    await page.locator('#pr-run-local').click();
    await expect(page.locator('.pr-option')).toHaveCount(2);
    const replaced = JSON.parse((await download(page, '#pr-export-json', `${label}-source`, 'json')).text);
    assert.equal(replaced.input.source.sceneSha256, sha(replacement));
    assert.notEqual(replaced.input.inputSha256, ai.input.inputSha256);
    assert.equal(replaced.approval, null);
    assert.deepEqual(errors, [], `Browser errors in ${label}`);
    results.push({ browser: label, checks: 'local pricing, consent/auth, AI transport, approval invalidation, safe exports, cancellation, exact source bytes', provider: 'authored fixture only' });
    console.log(`PASS project review ${label}`);
  } catch (error) {
    console.error(`FAIL project review ${label} at ${stage}: ${error.message}`);
    await page.screenshot({ path: fileURLToPath(new URL(`project-review-${label}-failure.png`, output)), fullPage: true, timeout: 5000 }).catch(() => {});
    await writeFile(new URL(`project-review-${label}-failure.json`, output), JSON.stringify({ stage, error: error.message, pageErrors: errors }, null, 2));
    throw error;
  } finally { await context.close(); clearTimeout(deadline); }
}

try {
  for (const name of (process.env.WORLD_BROWSERS || 'chromium').split(',').filter(Boolean)) {
    const type = { chromium, webkit }[name];
    assert.ok(type, `Unknown browser ${name}`);
    const executablePath = process.env[`PLAYWRIGHT_${name.toUpperCase()}_PATH`];
    const browser = await type.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try { await check(browser, false); await check(browser, true); }
    finally { await browser.close(); }
  }
  await writeFile(new URL('project-review-summary.json', output), `${JSON.stringify({ kind: 'authored-transport-acceptance', results }, null, 2)}\n`);
} finally { await fixture.close(); clearTimeout(overallDeadline); }
