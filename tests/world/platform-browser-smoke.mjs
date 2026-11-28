// BrainSNN developer platform in a real browser, against the production World Projects handlers (PGlite by default):
// the live-key workflow from first request to an independent client approval, keys, usage, the sandbox, hostile
// text, idempotent replays, keys never stored, phone layout, dark mode and an axe WCAG A/AA scan.
//   node tests/world/platform-browser-smoke.mjs     (CHROMIUM_PATH, PLATFORM_SMOKE_OUT optional)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { startProjectPlatformFixture } from './project-platform-server.mjs';
import { createProjectsClient } from '../../brainsnn-r3f-app/public/world/projects-client.mjs';

const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const { chromium } = require('playwright');
const axePath = require.resolve('axe-core/axe.min.js');
const executablePath = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium'].find(p => p && existsSync(p));
const output = process.env.PLATFORM_SMOKE_OUT || join(tmpdir(), 'brainsnn-platform-smoke');
await mkdir(output, { recursive: true });

// Its own workspace: CI shares one PostgreSQL database with the earlier browser smoke, and this test counts projects and keys.
const fixture = await startProjectPlatformFixture({ tenantId: `tenant_platform_smoke_${randomUUID().slice(0, 8)}` });
const key = role => fixture.credentials[role].token;
const sdk = role => createProjectsClient({ apiKey: key(role), baseUrl: `${fixture.url}/api/world/v1` });
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [];
const watch = page => {
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  // Chrome logs every 4xx answer as "Failed to load resource"; the explorer provokes API refusals on purpose and
  // shows them on the page, which the steps above assert. Anything else logged as an error fails the run.
  page.on('console', message => {
    if (message.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(message.text())) errors.push(`console: ${message.text()}`);
  });
};
const toast = (page, text) => page.waitForFunction(value => document.getElementById('pf-toast')?.textContent.includes(value), text);
const approvable = page => page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Approve' && !b.disabled));
async function noOverflow(page, where) {
  const size = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth }));
  assert.ok(size.html <= size.width + 1, `${where}: horizontal overflow ${JSON.stringify(size)}`);
}
async function noStoredKeys(page) {
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  for (const role of ['admin', 'editor', 'reviewer', 'reader']) assert.ok(!stored.includes(key(role)), `${role} key stored`);
  assert.ok(!/bsk_/.test(stored) && !/bsk_/.test(page.url()), 'no key in storage or URL');
}
async function connect(page, role) {
  if (await page.locator('#pf-disconnect').isVisible()) await page.locator('#pf-disconnect').click();
  await page.locator('#pf-connect-open').click();
  await page.getByRole('tab', { name: 'My key' }).click();
  await page.locator('#pf-key').fill(key(role));
  await page.locator('#pf-key-form').getByRole('button', { name: 'Connect' }).click();
  await page.waitForFunction(() => document.getElementById('pf-mode')?.dataset.mode === 'live');
  assert.equal(await page.locator('#pf-key').inputValue(), '', 'the key field is cleared');
  await noStoredKeys(page);
}
async function explorerSend(page, opId, expectStatus) {
  await page.goto(`${fixture.url}/platform/#/explorer/${opId}`);
  await page.getByRole('heading', { level: 2 }).first().waitFor();
  // Repeating an operation (as-is, then proposed revision) refills the body from what the session learned.
  const refill = page.getByRole('button', { name: 'Refill from my session' });
  if (await refill.count()) await refill.click();
  const button = page.getByRole('button', { name: /^Send (GET|POST)/ });
  // The last result stays on screen until the new response renders: mark it, then wait for a fresh one.
  await page.evaluate(() => document.querySelectorAll('.pf-status').forEach(el => { el.dataset.stale = 'true'; }));
  await button.click();
  await page.locator('.pf-status:not([data-stale])').waitFor();
  const status = (await page.locator('.pf-status').textContent()).trim();
  assert.equal(status, String(expectStatus), `${opId}: ${status} ${await page.locator('.pf-response').innerText()}`);
}
async function axe(page, where) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations
    .map(v => `${v.id}: ${v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(', ')}`));
  assert.deepEqual(violations, [], `${where}: axe WCAG A/AA`);
}

try {
  // ---------------------------------------------------------------- live key, desktop
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  watch(page);
  await page.goto(`${fixture.url}/platform/`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.getElementById('pf-service')?.dataset.ok === 'true');
  await page.getByRole('heading', { name: /Build with/ }).waitFor();
  await page.getByRole('button', { name: 'Drop a crate in the aisle' }).click();
  await page.waitForFunction(() => /rerouted|blocked/.test(document.getElementById('pf-toy-results')?.textContent || ''));
  await axe(page, 'home');
  await page.screenshot({ path: join(output, 'home.png'), fullPage: true });

  await connect(page, 'editor');
  await explorerSend(page, 'getMe', 200);
  await explorerSend(page, 'createProject', 201);
  // A retry with the same Idempotency-Key is answered from the ledger, not done twice.
  await page.getByRole('button', { name: 'Send again with the same Idempotency-Key' }).click();
  await page.getByText('Replayed: same key, same answer').waitFor();
  assert.equal((await sdk('editor').listProjects()).projects.length, 1, 'the replay created nothing');
  await explorerSend(page, 'addSource', 201);
  await explorerSend(page, 'createRevision', 201);
  assert.match(await page.locator('.pf-next button').innerText(), /Record the proposed revision/, 'next step after the as-is revision');
  await explorerSend(page, 'createRevision', 201);
  assert.match(await page.locator('.pf-next button').innerText(), /Add evidence/, 'next step after the proposed revision');
  for (const [op, status] of [['addEvidence', 201], ['createChange', 201]]) await explorerSend(page, op, status);
  await page.getByRole('button', { name: /Confirm the evidence/ }).waitFor();
  await page.screenshot({ path: join(output, 'explorer.png'), fullPage: true });
  // The editor cannot decide: the explorer shows the API's refusal and what to do.
  await explorerSend(page, 'decideChange', 403);
  await page.getByText('Your key\'s role cannot do this').waitFor();
  await axe(page, 'explorer');

  // The client reviewer approves in plain words.
  await connect(page, 'reviewer');
  await page.goto(`${fixture.url}/platform/#/projects`);
  await page.locator('.pf-project').first().click();
  await page.getByRole('heading', { name: 'Waiting on you' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Approve' }).isDisabled(), 'approval waits for confirmed evidence');
  // A reason typed before confirming the evidence survives the reload that confirming triggers.
  const reasonText = 'The crate is in the walk frames; the route is fine.';
  await page.getByLabel('Your reason (kept with the decision)').fill(reasonText);
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await toast(page, 'Evidence confirmed.');
  await approvable(page);
  assert.equal(await page.getByLabel('Your reason (kept with the decision)').inputValue(), reasonText, 'the typed reason survives the reload');
  await page.getByRole('button', { name: 'Approve' }).click();
  await toast(page, 'Approved:');
  await page.getByText('approved a change').first().waitFor();
  const [project] = (await sdk('reader').listProjects()).projects;
  const record = (await sdk('reader').getProject(project.id)).project;
  assert.equal(record.changes[0].status, 'approved');
  assert.equal(record.changes[0].decisions.at(-1).actor_name, 'Fixture reviewer');
  await axe(page, 'client view');
  await page.screenshot({ path: join(output, 'client-view.png'), fullPage: true });

  // Keys: refused politely without keys:manage; an admin issues a key once and revokes another.
  await page.goto(`${fixture.url}/platform/#/keys`);
  await page.getByText('Only an admin key can manage keys').waitFor();
  await connect(page, 'admin');
  await page.goto(`${fixture.url}/platform/#/keys`);
  await page.getByRole('cell', { name: /Fixture reader/ }).waitFor();
  await page.getByPlaceholder('e.g. Dana at Acme Robotics').fill('Dana at Acme Robotics');
  await page.getByRole('button', { name: 'Issue key' }).click();
  const secret = (await page.locator('.pf-secret code').textContent()).trim();
  assert.match(secret, /^bsk_[A-Za-z0-9_-]{43}$/);
  assert.equal((await createProjectsClient({ apiKey: secret, baseUrl: `${fixture.url}/api/world/v1` }).me()).actor.name, 'Dana at Acme Robotics');
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.ok(!stored.includes(secret), 'an issued key is never stored');
  await page.getByRole('button', { name: 'I saved it' }).click();
  const readerRow = page.getByRole('row', { name: /Fixture reader/ });
  await readerRow.getByRole('button', { name: 'Revoke' }).click();
  await readerRow.getByRole('button', { name: /Revoke Fixture reader/ }).click();
  await toast(page, 'no longer works');
  await assert.rejects(sdk('reader').me(), error => error.code === 'invalid-api-key');
  await axe(page, 'keys');

  await page.goto(`${fixture.url}/platform/#/usage`);
  await page.getByRole('meter', { name: 'Projects' }).waitFor();
  await page.goto(`${fixture.url}/platform/#/docs`);
  await page.getByRole('heading', { name: 'The eight words' }).waitFor();
  await axe(page, 'docs');

  // Hostile text from the API is shown as text.
  await sdk('editor').createProject({ title: '<img src=x onerror="window.platformXss=1">Aisle' });
  await page.goto(`${fixture.url}/platform/#/projects`);
  await page.getByText('<img src=x onerror="window.platformXss=1">Aisle').waitFor();
  assert.equal(await page.evaluate(() => window.platformXss), undefined);
  await noStoredKeys(page);

  // Dark mode keeps working.
  await page.locator('#pf-theme').click();
  assert.ok(['dark', 'light'].includes(await page.evaluate(() => document.documentElement.dataset.theme)));
  await page.goto(`${fixture.url}/platform/#/`);
  await page.getByRole('heading', { name: /Build with/ }).waitFor();
  await axe(page, 'home, other theme');
  await context.close();

  // ---------------------------------------------------------------- sandbox, phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await phone.newPage();
  watch(p);
  await p.goto(`${fixture.url}/platform/`, { waitUntil: 'networkidle' });
  await noOverflow(p, 'phone home');
  await p.getByRole('button', { name: 'Start in the sandbox' }).click();
  await p.waitForFunction(() => document.getElementById('pf-mode')?.dataset.mode === 'sandbox');
  await p.getByRole('button', { name: 'Fill the sandbox with a sample site' }).click();
  await p.getByRole('heading', { name: 'Warehouse aisle 4 (sample)' }).waitFor();
  await p.getByRole('button', { name: 'Confirm', exact: true }).click();
  await toast(p, 'Evidence confirmed.');
  await approvable(p);
  await p.getByLabel('Your reason (kept with the decision)').fill('Looks right.');
  await p.getByRole('button', { name: 'Approve' }).click();
  await toast(p, 'Approved:');
  await noOverflow(p, 'phone client view');
  await p.screenshot({ path: join(output, 'phone-client-view.png'), fullPage: true });
  // The person who proposed cannot approve: in the sandbox, the page says so and offers to switch.
  await p.locator('#pf-role').getByRole('button', { name: 'Operator' }).click();
  await p.goto(`${fixture.url}/platform/#/explorer/decideChange`);
  await p.getByRole('heading', { name: /Record approval/ }).waitFor();
  await noOverflow(p, 'phone explorer');
  await p.goto(`${fixture.url}/platform/#/processing`);
  await p.getByText('The sandbox does not run processing').waitFor();
  await p.goto(`${fixture.url}/platform/#/`);
  assert.equal((await p.locator('.pf-checklist li.is-done').count()) >= 4, true, 'the sandbox walk ticks the checklist');
  await noOverflow(p, 'phone home after');
  await noStoredKeys(p);
  await phone.close();

  assert.deepEqual(errors, [], 'no page or console errors');
  console.log(`platform smoke passed; screenshots in ${output}`);
} finally {
  await browser.close();
  await fixture.close();
}
