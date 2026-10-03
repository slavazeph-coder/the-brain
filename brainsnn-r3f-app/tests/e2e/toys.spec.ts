import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// The playground toys: the poke hero on the homepage and the three toy routes.
// WebGL may not exist in CI, so these assert on what every tier shares — the
// counter, the controls, the share sheet — rather than on the 3D canvas.

test('the homepage brain is pokeable straight away and counts the signals it fires', async ({ page }) => {
  await page.goto('/');
  const hero = page.getByTestId('poke-hero');
  // The 3-second rule: something to poke, with no signup, modal or tutorial in the way.
  await expect(hero).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Poke the brain and watch the signal travel.');
  await expect(page.getByTestId('poke-count')).toHaveText('0000');

  const stage = await page.locator('.poke-stage').boundingBox();
  if (!stage) throw new Error('poke stage has no box');
  for (const [fx, fy] of [[0.45, 0.45], [0.58, 0.4], [0.5, 0.58]]) {
    await page.mouse.click(stage.x + stage.width * fx, stage.y + stage.height * fy);
  }
  await expect.poll(async () => Number(await page.getByTestId('poke-count').textContent())).toBeGreaterThan(0);

  await page.getByTestId('poke-shake').click();
  await page.getByTestId('poke-reset').click();
  await expect(page.getByTestId('poke-count')).toHaveText('0000');

  // The watermark rides on the stage itself, so any screen recording carries it.
  await expect(page.locator('.poke-stage')).toContainText('brainsnn.com');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('slice chops the jelly in two, a swipe re-cuts it, and heal puts it back', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  // Slicing is a 3D-only control; a browser without WebGL keeps the 2D brain.
  const has3d = await page.locator('[data-testid="poke-hero"][data-render="3d"]').waitFor({ timeout: 60_000 }).then(() => true, () => false);
  test.skip(!has3d, 'no WebGL in this browser');

  const slice = page.getByTestId('poke-slice');
  await expect(slice).toHaveText(/Slice/);
  await slice.click();
  // The cut lands once the blade bites; then the button offers to heal it.
  await expect(slice).toHaveText(/Heal/, { timeout: 15_000 });
  await expect(slice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.poke-hint.is-knife')).toHaveText('Swipe through the brain to slice it');

  // With the knife out, a swipe from off the brain straight through it cuts again.
  const stage = await page.locator('.poke-stage').boundingBox();
  if (!stage) throw new Error('poke stage has no box');
  const from = [stage.x + stage.width * 0.62, stage.y + stage.height * 0.06];
  const to = [stage.x + stage.width * 0.4, stage.y + stage.height * 0.8];
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let step = 1; step <= 14; step += 1) {
    await page.mouse.move(from[0] + (to[0] - from[0]) * step / 14, from[1] + (to[1] - from[1]) * step / 14);
  }
  await page.mouse.up();
  await expect(slice).toHaveText(/Heal/);

  await slice.click();
  await expect(slice).toHaveText(/Slice/);
  await expect(slice).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.poke-hint.is-knife')).toHaveCount(0);
});

test('share this brain saves a watermarked poster and copies a tagged caption', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are chromium-only in Playwright');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  const stage = await page.locator('.poke-stage').boundingBox();
  if (!stage) throw new Error('poke stage has no box');
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5);

  await page.getByTestId('poke-share-button').click();
  await expect(page.getByTestId('poke-share')).toBeVisible();

  await page.getByTestId('poke-copy').click();
  const caption = await page.evaluate(() => navigator.clipboard.readText());
  expect(caption.split('\n')[0]).toBe('Poke the brain and watch the signal travel');
  expect(caption).toContain('https://www.brainsnn.com/?src=toy1-share');

  // The poster is a frame of the 3D scene, so it is offered only where WebGL runs.
  if (await page.getByTestId('poke-poster').count()) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('poke-poster').click()]);
    expect(download.suggestedFilename()).toBe('brainsnn-poke-poster.png');
  }
});

test('more toys and both CTAs sit under the hero', async ({ page }) => {
  await page.goto('/');
  const toys = page.locator('#toys');
  for (const path of ['/toys/fool-the-detector', '/toys/draft-duel', '/toys/defend-the-brain']) {
    await expect(toys.locator(`a[href="${path}"]`)).toBeVisible();
  }
  await expect(page.getByRole('link', { name: 'Sponsor BrainSNN' })).toHaveAttribute('href', '/sponsor/gt3/');
  await expect(page.getByRole('link', { name: 'Enterprise builds' })).toHaveAttribute('href', '/arcade#brief');
  // Sponsor slots are wired but empty until a sponsor is signed.
  await expect(page.locator('[data-sponsor-slot]').first()).toBeHidden();
  const results = await new AxeBuilder({ page }).include('.bh-site').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
});

test('fool the detector scores a round and keeps its honesty note', async ({ page }) => {
  await page.goto('/toys/fool-the-detector');
  await expect(page).toHaveTitle('Fool the Detector | BrainSNN');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Can you fool our AI detector?');
  await page.getByTestId('fool-input').fill('The window shuts Friday and we are not reopening it.');
  await page.getByTestId('fool-submit').click();
  await expect(page.getByTestId('fool-result')).toBeVisible();
  await expect(page.locator('body')).toContainText('they do not establish universal capability');
});

test('draft duel fights two drafts to a verdict with a shareable card', async ({ page }) => {
  await page.goto('/toys/draft-duel');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make two drafts fight.');
  await page.getByRole('button', { name: 'Load a sample fight' }).click();
  await page.getByTestId('duel-fight').click();
  await expect(page.getByTestId('duel-verdict')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('duel-arena')).toContainText('Draft B wins 4–1');
  await expect(page.getByTestId('duel-share')).toBeVisible();
});

test('defend the brain has its own route with the game and its disclaimers verbatim', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/toys/defend-the-brain');
  await expect(page).toHaveTitle('Defend the Brain | BrainSNN');
  await expect(page.getByTestId('brain-game-lab')).toBeVisible({ timeout: 30_000 });
  const card = page.getByTestId('defend-card');
  await expect(card).toContainText('Scores are 0–100 indices, not probabilities.');
  await expect(card).toContainText('Results describe tested conditions, not universal capability.');
});

// Server-rendered previews: only meaningful against `npm start` (PLAYWRIGHT_BASE_URL),
// same as the social-card tests in brainsnn.spec.ts.
test('each toy unfurls as its own rendered screenshot', async ({ request }) => {
  for (const [path, image] of [
    ['/', '/og/toy-poke.png'],
    ['/toys/fool-the-detector', '/og/toy-fool.png'],
    ['/toys/draft-duel', '/og/toy-duel.png'],
    ['/toys/defend-the-brain', '/og/toy-defend.png'],
  ]) {
    const html = await (await request.get(path)).text();
    expect(html).toContain(`<meta property="og:image" content="https://www.brainsnn.com${image}"`);
    const png = await request.get(image);
    expect(png.status()).toBe(200);
    expect(png.headers()['content-type']).toContain('image/png');
  }
});
