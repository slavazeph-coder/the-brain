import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const endpoint = '**/api/engine/compare';
const original = 'Act   now!\nThis guaranteed solution will change everything.';
const candidate = 'Review the source material and compare alternatives before deciding.';

test('real comparison preserves inputs, measured signals and downloadable evidence', async ({ page }) => {
  await page.goto('/engine');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test the edit.Inspect the evidence.');
  await expect(page.getByText(/Running a comparison sends both texts to BrainSNN/)).toBeVisible();
  await page.getByLabel('Original text', { exact: true }).fill(original);
  await page.getByLabel('Candidate text', { exact: true }).fill(candidate);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/engine/compare') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Run comparison', exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const record = await response.json();
  expect(record.original.content).toBe(original);
  expect(record.candidate.content).toBe(candidate);
  expect(record.original.sha256).toBe(createHash('sha256').update(original).digest('hex'));
  expect(record.candidate.sha256).toBe(createHash('sha256').update(candidate).digest('hex'));
  expect(record.decision).toBe('REVIEW_REQUIRED');
  expect(record.execution).toMatchObject({ persisted: false, providerCalls: 0, providerTokens: 0 });
  expect(record.evidence).toEqual({ factsVerified: false, marketOutcomeMeasured: false, workAccepted: false, contextPromoted: false });
  await expect(page.getByRole('heading', { name: 'Review required.', exact: true })).toBeVisible();
  const trustRow = page.getByRole('row', { name: /^Trust/ });
  await expect(trustRow.getByRole('cell').nth(0)).toHaveText(String(record.original.signals.trust));
  await expect(trustRow.getByRole('cell').nth(1)).toHaveText(String(record.candidate.signals.trust));
  await expect(page.locator('.ew-checks li')).toHaveCount(2);
  for (const [index, check] of record.checks.entries()) {
    await expect(page.locator('.ew-checks li').nth(index)).toContainText(check.passed ? 'Within limit' : 'Outside limit');
  }
  await page.getByText('Original text, hash and source signals', { exact: true }).click();
  await expect(page.locator('.ew-evidence').first().locator('.ew-source')).toHaveText(original, { useInnerText: false });
  await expect(page.getByText(record.original.sha256, { exact: true })).toBeVisible();
  for (const finding of record.original.findings) expect(original.slice(finding.start, finding.end)).toBe(finding.quotation);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download review JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${record.id}.json`);
  const path = await download.path();
  expect(JSON.parse(await readFile(path!, 'utf8'))).toEqual(record);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('.ew-site').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
  await page.getByLabel('Candidate text', { exact: true }).fill('A different version needs its own comparison.');
  await expect(page.getByRole('status')).toContainText('Inputs changed. Run a new comparison');
  await expect(page.getByRole('heading', { name: 'Review required.', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download review JSON' })).toHaveCount(0);
});

test('empty input is rejected and an illustrative sample never invents a result', async ({ page }) => {
  let requests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/api/engine/compare')) requests += 1; });
  await page.goto('/engine');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.getByRole('button', { name: 'Run comparison', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter non-empty text in both fields.');
  await page.getByRole('button', { name: 'Load illustrative sample' }).click();
  await expect(page.getByRole('status')).toContainText('Illustrative sample loaded. Run comparison');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Original text', { exact: true })).toHaveValue(/Act now/);
  await expect(page.getByLabel('Candidate text', { exact: true })).toHaveAttribute('maxlength', '8000');
  await expect(page.getByRole('heading', { name: 'Review required.', exact: true })).toHaveCount(0);
  expect(requests).toBe(0);
});

test('editing during a request cancels it and an old response cannot restore its result', async ({ page, request }) => {
  const actual = await request.post('/api/engine/compare', { data: { original, candidate } });
  expect(actual.status()).toBe(200);
  const body = await actual.text();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let delivered: () => void = () => {};
  const handled = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route(endpoint, async (route) => {
    await gate;
    try { await route.fulfill({ status: 200, contentType: 'application/json', body }); } finally { delivered(); }
  });
  await page.goto('/engine');
  await page.getByLabel('Original text', { exact: true }).fill(original);
  await page.getByLabel('Candidate text', { exact: true }).fill(candidate);
  const sent = page.waitForRequest((value) => value.url().endsWith('/api/engine/compare'));
  await page.getByRole('button', { name: 'Run comparison', exact: true }).click();
  await sent;
  await expect(page.getByRole('button', { name: 'Comparing…', exact: true })).toBeDisabled();
  await page.getByLabel('Candidate text', { exact: true }).fill('Edited during the request.');
  await expect(page.getByRole('button', { name: 'Run comparison', exact: true })).toBeEnabled();
  release(); await handled;
  await expect(page.getByRole('status')).toContainText('Inputs changed. Run a new comparison');
  await expect(page.getByRole('heading', { name: 'Review required.', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a failed request preserves entered text and permits retry without showing invented results', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"Rate limited"}' }));
  await page.goto('/engine');
  await page.getByRole('button', { name: 'Load illustrative sample' }).click();
  const entered = await page.getByLabel('Original text', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Run comparison', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Too many requests. Wait a moment, then try again.');
  await expect(page.getByRole('button', { name: 'Run comparison', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Original text', { exact: true })).toHaveValue(entered);
  await expect(page.getByRole('button', { name: 'Download review JSON' })).toHaveCount(0);
});
