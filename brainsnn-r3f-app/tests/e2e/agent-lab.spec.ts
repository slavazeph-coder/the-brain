import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const endpoint = '**/api/agent-lab/summary';
const snapshot = {
  schemaVersion: 1, mode: 'recorded', generatedAt: '2026-09-08T12:00:00Z',
  mission: { title: 'AI Team Setup Day', priceUsd: 1500 },
  work: { ready: 2, running: 0, blocked: 1, review: 1, accepted: 0 },
  evidence: { acceptedDeliveries: 0, verifiedPaidDeliveries: 0, contextCandidates: 1, promotedContexts: 0 },
  events: [],
};

test('engine homepage leads with its tools and scopes unavailable XIO evidence', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('An evidence engine for agent work.');
  await expect(page.locator('.al-hero').getByRole('link', { name: 'Analyze your content' })).toHaveAttribute('href', '/app');
  await expect(page.locator('.al-hero').getByRole('link', { name: 'Inspect the benchmark' })).toHaveAttribute('href', '/evidence');
  await expect(page.locator('#office')).toContainText('not BrainSNN-wide usage');
  await expect(page.locator('#roadmap')).toContainText('NEXT ENGINE WORK');
  await expect(page.locator('#roadmap')).toContainText('not a claim of autonomous learning already running');
  await expect(page.locator('#builders')).toContainText('POST /api/engine/compare');
  await expect(page.locator('#builders')).toContainText('brain_compare');
  await expect(page.locator('#builders')).toContainText('REVIEW_REQUIRED');
  await expect(page.locator('#builders').getByRole('link', { name: 'Compare two drafts' })).toHaveAttribute('href', '/engine');
  await expect(page.locator('#builders').getByRole('link', { name: 'Use the API and MCP tools' })).toHaveAttribute('href', '/engine#api');
  await expect(page.getByText('Recorded evidence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ready: unknown', { exact: true })).toHaveText('—');
  await expect(page.getByLabel('Verified paid deliveries: unknown', { exact: true })).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Play recorded replay' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'View the existing XIO experiment' })).toHaveAttribute('href', 'https://www.xioai.co/ai-team-setup-day');
  await expect(page.locator('.al-hero')).not.toContainText('XIO');
  await expect(page.locator('.al-site')).not.toContainText('US$1,500');
  for (const path of ['/app', '/missions', '/arcade', '/lab', '/evidence', '/reconstruct']) {
    await expect(page.locator(`#tools a[href="${path}"]`)).toBeVisible();
  }
  await page.getByRole('button', { name: /Improve Edits you can review/ }).click();
  await expect(page.getByRole('heading', { name: 'Turn a finding into a specific edit.' })).toBeVisible();
  await expect(page.locator('#al-department-detail')).toContainText('Run a scan in the workspace, then open Improve.');
  await page.getByRole('button', { name: /Memory Scans and versions/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep the evidence behind an edit.' })).toBeVisible();
  await expect(page.locator('#al-department-detail')).toContainText('browser-local history');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('refresh distinguishes approved zero results from unavailable evidence', async ({ page }) => {
  let available = false;
  await page.route(endpoint, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify(available ? snapshot : { schemaVersion: 1, mode: 'unavailable' }),
  }));
  await page.goto('/');
  await expect(page.getByLabel('Ready: unknown', { exact: true })).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Refresh records' })).toBeEnabled();
  available = true;
  await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.getByText('Recorded snapshot · not a live feed', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ready: 2', { exact: true })).toHaveText('2');
  await expect(page.getByLabel('Verified paid deliveries: 0', { exact: true })).toHaveText('0');
  await expect(page.getByRole('heading', { name: 'No approved replay events yet.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play recorded replay' })).toBeDisabled();
  available = false;
  await page.getByRole('button', { name: 'Refresh records' }).click();
  await expect(page.getByText('Recorded evidence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ready: unknown', { exact: true })).toHaveText('—');
});

test('recorded replay selects chronological evidence and never autoplays', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...snapshot, events: [
      { id: 'second', label: 'Fixture: delivery accepted', at: '2026-09-08T11:00:00Z', status: 'accepted' },
      { id: 'first', label: 'Fixture: work started', at: '2026-09-08T10:00:00Z', status: 'running' },
    ] }),
  }));
  await page.goto('/');
  await expect(page.locator('.al-replay-event h3')).toHaveText('Fixture: work started');
  await expect(page.getByRole('button', { name: 'Play recorded replay' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Previous recorded event' })).toBeDisabled();
  await page.getByRole('button', { name: 'Next recorded event' }).click();
  await expect(page.locator('.al-replay-event h3')).toHaveText('Fixture: delivery accepted');
  await expect(page.getByRole('button', { name: 'Next recorded event' })).toBeDisabled();
  await page.getByRole('button', { name: /01 Fixture: work started/ }).click();
  await expect(page.locator('.al-replay-event h3')).toHaveText('Fixture: work started');
  await page.getByRole('button', { name: 'Play recorded replay' }).click();
  await expect(page.getByRole('button', { name: 'Pause recorded replay' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause recorded replay' }).click();
  await expect(page.getByRole('button', { name: 'Play recorded replay' })).toBeVisible();
});

test('agent lab has accessible controls and no serious accessibility violations', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(snapshot) }));
  await page.goto('/');
  await expect(page.getByText('Recorded snapshot · not a live feed', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  const results = await new AxeBuilder({ page }).include('.al-site').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
});
