import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('lobby has three primary routes, Lab overflow and an honest paused preview', async ({ page }) => {
  let feedRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/agent-lab/summary')) feedRequests++; });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('See the moment it breaks.');
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await expect(navigation.locator('> a')).toHaveText(['Arena', 'Review', 'Evidence']);
  await expect(navigation.getByRole('link', { name: 'Lab', exact: true })).not.toBeVisible();
  await navigation.getByLabel('More navigation').click();
  await expect(navigation.getByRole('link', { name: 'Lab', exact: true })).toBeVisible();
  await expect(page.locator('.bh-lobby-slice')).toContainText('Paused · local practice — not a model score');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(feedRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('old review links select addressable tabs, browser Back keeps a draft', async ({ page }) => {
  for (const [route, tab] of [['/app', 'passage'], ['/engine', 'drafts'], ['/reconstruct', 'claims']]) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`/office\\?tab=${tab}$`));
    await expect(page.locator(`#review-tabs a[aria-current="page"]`)).toHaveAttribute('href', `/office?tab=${tab}`);
  }
  await page.goto('/office');
  await page.getByLabel('Passage to review').fill('Keep this draft while switching tabs.');
  await page.getByRole('link', { name: 'Video cues', exact: true }).click();
  await expect(page.getByLabel('Timestamped captions')).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Passage to review')).toHaveValue('Keep this draft while switching tabs.');
});

test('passage findings highlight exact source text with misses beside the score', async ({ page }) => {
  await page.goto('/office');
  await page.getByLabel('Passage to review').fill('Act now! This guaranteed solution will change everything.');
  await page.getByRole('button', { name: 'Review passage', exact: true }).click();
  const results = page.getByRole('region', { name: 'Passage results' });
  await expect(results.getByLabel('Known detector misses and false alarms')).toBeVisible();
  const finding = results.locator('.review-findings a').first();
  await expect(finding).toBeVisible();
  await finding.click();
  await expect(results.locator('pre mark')).not.toBeEmpty();
  await expect(results).toContainText('False alarm example:');
  await expect(results).toContainText('Missed example:');
  const accessibility = await new AxeBuilder({ page }).include('#review-main').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
});

test('video cues honor supplied timestamps and never invent untimed locations', async ({ page }) => {
  await page.goto('/office?tab=video');
  await page.getByLabel('Timestamped captions').fill('00:02 Act now.\n00:08 We tested it on three tasks.');
  await page.getByRole('button', { name: 'Review video cues', exact: true }).click();
  const results = page.getByRole('region', { name: 'Video cue results' });
  await expect(results).toContainText('Playback unavailable');
  await results.locator('.review-findings a').first().click();
  await expect(results.getByRole('status')).toContainText('Selected caption timestamp');
  await page.getByLabel('Timestamped captions').fill('A sentence with no supplied timecode.');
  await page.getByRole('button', { name: 'Review video cues', exact: true }).click();
  await expect(results).toContainText('no usable timestamps');
  await expect(results.locator('.review-findings a')).toHaveCount(0);
});

test('Lab links every retained toy and Arcade carries no pricing or lead capture', async ({ page }) => {
  await page.goto('/lab');
  for (const path of ['/play', '/lab/powder', '/arcade', '/toys/fool-the-detector', '/toys/draft-duel', '/toys/defend-the-brain']) await expect(page.locator(`.lab-cards a[href="${path}"]`)).toBeVisible();
  await page.locator('.lab-cards a[href="/arcade"]').click();
  await expect(page.getByRole('heading', { name: 'Arcade', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pricing', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type=email]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});


test('legacy task and powder links redirect without losing their identifiers', async ({ request }) => {
  for (const [path, destination] of [
    ['/missions', '/arena/'],
    ['/missions/refund-authority?src=old', '/arena/tasks/refund-authority?src=old'],
    ['/m/task-42', '/arena/tasks/published/task-42'],
    ['/lab?grid=example&s=lab', '/lab/powder?grid=example&s=lab'],
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers().location).toBe(destination);
  }
  expect((await request.get('/arena/does-not-exist.js')).status()).toBe(404);
});

test('an existing deterministic task still runs inside Arena', async ({ page }) => {
  await page.goto('/missions/refund-authority');
  await expect(page).toHaveURL(/arena\/tasks\/refund-authority$/);
  await expect(page.getByRole('navigation', { name: 'Main navigation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run mission', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'MISSION SUCCESS', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Fork permission + rerun', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'BOUNDARY FAILURE', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export ProofPack', exact: true })).toBeVisible();
});
