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

test('agent lab keeps unavailable evidence unknown and preserves all tool routes', async ({ page }) => {
  await page.route(endpoint, (route) => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('AI work that earns its keep.');
  await expect(page.getByText('Recorded evidence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Ready: unknown', { exact: true })).toHaveText('—');
  await expect(page.getByLabel('Verified paid deliveries: unknown', { exact: true })).toHaveText('—');
  await expect(page.getByRole('button', { name: 'Play recorded replay' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'See the XIO offer' })).toHaveAttribute('href', 'https://www.xioai.co/ai-team-setup-day');
  for (const path of ['/app', '/missions', '/arcade', '/lab']) {
    await expect(page.locator(`#tools a[href="${path}"]`)).toBeVisible();
  }
  await page.getByRole('button', { name: /Robotics simulator farm/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep the research. Earn the expansion.' })).toBeVisible();
  await expect(page.locator('#al-department-detail')).toContainText('New farm spending stays at zero');
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
