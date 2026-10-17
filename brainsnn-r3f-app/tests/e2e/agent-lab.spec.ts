import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { buildMissionContract, DEFAULT_MISSION_DRAFT } from '../../src/features/missions/missionBuilder.js';

test('homepage leads with robotics and keeps other tools in overflow', async ({ page }) => {
  let feedRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/agent-lab/summary')) feedRequests++; });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Test your robot.See where it fails.');
  const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
  await expect(navigation.locator('> a')).toHaveText(['Robot arcade', 'Pricing']);
  for (const name of ['Review', 'Evidence', 'Lab']) await expect(navigation.getByRole('link', { name, exact: true })).not.toBeVisible();
  await navigation.getByLabel('More navigation').click();
  await expect(navigation.getByRole('link', { name: 'Lab', exact: true })).toBeVisible();
  await expect(page.locator('.bh-lobby-slice')).toContainText('Local practice · no AI model running');
  await expect(page.getByText('Local scripted practice is open now. Hosted policy tests are not yet available.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'See pricing', exact: true })).toHaveAttribute('href', '/arena/#campaigns');
  await expect(page.locator('.bh-price-preview')).toContainText('US$171.43');
  await expect(page.locator('canvas')).toHaveCount(0);
  expect(feedRequests).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'See pricing', exact: true }).click();
  await expect(page.getByRole('heading', { name: '10-episode test pack', exact: true })).toBeVisible();
  await expect(page.locator('[data-pricing-total]')).toHaveText('US$171.43');
  await page.getByRole('button', { name: '1,000 episodes', exact: true }).click();
  await expect(page.locator('[data-pricing-total]')).toHaveText('US$1.71');
  await page.getByRole('button', { name: '100,000 episodes', exact: true }).click();
  await expect(page.locator('[data-pricing-total]')).toHaveText('US$171.43');
  await expect(page.locator('[data-campaign-tools]')).not.toHaveAttribute('open');
  await expect(page.locator('[data-campaign-profile]')).not.toBeVisible();
  await page.getByRole('button', { name: 'Try the arcade' }).click();
  await expect(page.getByLabel('01 · Choose your robot')).toBeVisible();
  await expect(page.getByLabel('02 · Model / LLM')).toBeVisible();
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

// Keep the document alive so React.lazy has resolved before the page remounts.
// A full page.goto would reload the modules and mask the parent/child effect race.
async function openLabWithinDocument(page) {
  await page.evaluate(() => {
    window.history.pushState({}, '', '/lab');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Lab', exact: true })).toBeVisible();
}

async function finishPageEffects(page) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('Review tab titles survive warm remounts and query history navigation', async ({ page }) => {
  await page.goto('/office?tab=video');
  await expect(page.getByLabel('Timestamped captions')).toBeVisible();
  await finishPageEffects(page);
  await expect(page).toHaveTitle('Video cues · Review | BrainSNN');
  await openLabWithinDocument(page);
  await page.goBack();
  await expect(page.getByLabel('Timestamped captions')).toBeVisible();
  await finishPageEffects(page);
  await expect(page).toHaveTitle('Video cues · Review | BrainSNN');
  await page.getByRole('link', { name: 'Claim split', exact: true }).click();
  await expect(page).toHaveTitle('Claim split · Review | BrainSNN');
  await page.goBack();
  await expect(page.getByLabel('Timestamped captions')).toBeVisible();
  await finishPageEffects(page);
  await expect(page).toHaveTitle('Video cues · Review | BrainSNN');
});

test('Arena task title survives a warm remount while index and unavailable tasks keep a fallback', async ({ page }) => {
  await page.goto('/arena/tasks/refund-authority');
  await expect(page.getByRole('button', { name: 'Run mission', exact: true })).toBeVisible();
  await finishPageEffects(page);
  await expect(page).toHaveTitle('Arena Task 001 · Refund Authority | BrainSNN');
  await openLabWithinDocument(page);
  await page.goBack();
  await expect(page.getByRole('button', { name: 'Run mission', exact: true })).toBeVisible();
  await finishPageEffects(page);
  await expect(page).toHaveTitle('Arena Task 001 · Refund Authority | BrainSNN');
  for (const [path, heading] of [['/arena/tasks', 'Arena tasks'], ['/arena/tasks/not-implemented', 'Task unavailable']]) {
    await openLabWithinDocument(page);
    await page.evaluate(pathname => {
      window.history.pushState({}, '', pathname);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    await finishPageEffects(page);
    await expect(page).toHaveTitle('Arena tasks | BrainSNN');
  }
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

async function expectSingleTaskShell(page) {
  // Count DOM nodes as well as accessible landmarks: hiding legacy chrome with
  // CSS is not sufficient, and can bring duplicate navigation back on a refactor.
  await expect(page.locator('.bh-site')).toHaveCount(1);
  await expect(page.locator('header.bh-nav')).toHaveCount(1);
  await expect(page.locator('.public-nav')).toHaveCount(1);
  await expect(page.getByRole('navigation')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('footer')).toHaveCount(1);
  await expect(page.locator('footer.bh-footer')).toHaveCount(1);
  await expect(page.locator('.public-nav nav > a')).toHaveText(['Robot arcade', 'Pricing']);
  await expect(page.locator('.task-context a[href="/arena/tasks"]')).toBeVisible();
}

test('curated Arena tasks and the builder render one shared navigation shell', async ({ page }) => {
  for (const slug of ['refund-authority', 'workflow-efficiency', 'authorized-bug-hunt', 'reproduce-result', 'navigation-baseline', 'build']) {
    await page.goto(`/arena/tasks/${slug}`);
    await expect(page.locator('main h1')).toBeVisible();
    await expectSingleTaskShell(page);
  }
});

test('published Arena tasks retain one shell while loading, ready, and unavailable', async ({ page }) => {
  for (const outcome of ['ready', 'unavailable']) {
    let release = () => {};
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const id = `navigation-${outcome}`;
    await page.route(`**/api/v1/missions/${id}/leaderboard`, route => route.fulfill({ json: { ok: true, entries: [] } }));
    await page.route(`**/api/v1/missions/${id}`, async route => {
      await waiting;
      await route.fulfill(outcome === 'ready' ? { json: {
        ok: true, mission: { id, configuration: DEFAULT_MISSION_DRAFT, contract: buildMissionContract(DEFAULT_MISSION_DRAFT) },
      } } : { status: 404, json: { ok: false, error: 'Fixture task unavailable.' } });
    });
    try {
      await page.goto(`/arena/tasks/published/${id}`);
      await expect(page.getByRole('heading', { name: 'Loading mission…', exact: true })).toBeVisible();
      await expectSingleTaskShell(page);
    } finally { release(); }
    if (outcome === 'ready') await expect(page.getByRole('button', { name: 'Run locally', exact: true })).toBeVisible();
    else await expect(page.getByRole('heading', { name: 'Mission unavailable', exact: true })).toBeVisible();
    await expectSingleTaskShell(page);
  }
});
