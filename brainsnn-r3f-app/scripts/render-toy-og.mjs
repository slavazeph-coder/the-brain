// Renders the social preview cards for the playground toys from the real,
// running toys — so a shared link unfurls as what the toy actually looks like.
//
//   npm run build && PORT=4180 npm start        # or any running build
//   node scripts/render-toy-og.mjs              # writes public/og/toy-*.png
//
// Env:
//   TOY_OG_BASE              base URL of the running site (default http://127.0.0.1:4180)
//   PLAYWRIGHT_CHROMIUM_PATH use an installed Chromium instead of Playwright's own
//
// WebGL runs on SwiftShader here, which is slow; the waits below allow for it.
// Output is 1200x630, the size every major unfurler crops to.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.TOY_OG_BASE || 'http://127.0.0.1:4180';
const OUT = join(process.cwd(), 'public', 'og');
const SIZE = { width: 1200, height: 630 };

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function page(path, css = '') {
  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const tab = await context.newPage();
  await tab.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  // Cards are about the toy, not the site chrome.
  await tab.addStyleTag({ content: `.bh-nav,.bh-skip,.poke-hint{display:none!important}${css}` });
  return { tab, context };
}

// Put the toy's headline at the top of the card so the hook is always legible.
async function scrollToHeading(tab, offset = 30) {
  await tab.locator('.toy-hero').evaluate((node, top) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - top), offset);
  await tab.waitForTimeout(200);
}

async function poke() {
  const { tab, context } = await page('/');
  await tab.waitForSelector('[data-testid="poke-hero"][data-render="3d"]', { timeout: 60_000 });
  const stage = await tab.locator('.poke-stage').boundingBox();
  for (const [fx, fy] of [[0.42, 0.45], [0.6, 0.38], [0.52, 0.6]]) {
    await tab.mouse.click(stage.x + stage.width * fx, stage.y + stage.height * fy);
    await tab.waitForTimeout(260);
  }
  await tab.waitForTimeout(500);
  await tab.screenshot({ path: join(OUT, 'toy-poke.png') });
  await context.close();
}

async function fool() {
  // The lead and the worked example are page copy; the card is the hook and the result.
  const { tab, context } = await page('/toys/fool-the-detector', '.toy-hero .toy-lead{display:none!important}body{zoom:.86}');
  await tab.fill('[data-testid="fool-input"]', 'The window shuts Friday and we are not reopening it.');
  await tab.click('[data-testid="fool-submit"]');
  await tab.waitForSelector('[data-testid="fool-result"]');
  await scrollToHeading(tab);
  await tab.screenshot({ path: join(OUT, 'toy-fool.png') });
  await context.close();
}

async function duel() {
  const { tab, context } = await page('/toys/draft-duel');
  await tab.click('text=Load a sample fight');
  await tab.click('[data-testid="duel-fight"]');
  await tab.waitForSelector('[data-testid="duel-verdict"]', { timeout: 15_000 });
  await tab.waitForTimeout(900);
  // Once the fight is over the inputs are noise; the card is the hook and the verdict.
  await tab.addStyleTag({ content: '.toy-hero .toy-lead,.duel-form{display:none!important}body{zoom:.72}' });
  await scrollToHeading(tab);
  await tab.screenshot({ path: join(OUT, 'toy-duel.png') });
  await context.close();
}

async function defend() {
  const { tab, context } = await page('/toys/defend-the-brain');
  await tab.waitForSelector('[data-testid="brain-game-lab"]', { timeout: 30_000 });
  await tab.waitForTimeout(6000);
  await tab.locator('[data-testid="brain-game-lab"]').evaluate((node) => window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - 10));
  await tab.waitForTimeout(1500);
  await tab.screenshot({ path: join(OUT, 'toy-defend.png') });
  await context.close();
}

for (const [name, render] of [['poke', poke], ['fool', fool], ['duel', duel], ['defend', defend]]) {
  await render();
  console.log(`rendered public/og/toy-${name}.png`);
}
await browser.close();
