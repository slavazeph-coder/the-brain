import { expect, test, type Page } from '@playwright/test';

// The reconstruction worker is replaced by a contract double that follows
// robotics/arena/workers/site_scan (tickets, scan keys, artifacts). The real
// worker and a real capture are exercised in docs/site-scan-worker.md runs.
const WORKER = 'https://worker.test';
const ID = 'c0ffee'.padEnd(32, '0');
const KEY = 'scan-key-'.padEnd(43, 'k');
const MP4 = Buffer.from('00000018667479706d703432', 'hex');

function room() {
  const points: number[][] = [];
  for (let i = 0; i < 4000; i += 1) {
    const a = (i * 2.399) % (Math.PI * 2), r = 2 + (i % 7) * 0.05;
    points.push([Math.cos(a) * r, (i % 3) - 1.5, Math.sin(a) * r, 120 + (i % 120), 140, 160]);
  }
  const cameras = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return { frame: `image_${String(i).padStart(4, '0')}.jpg`, centre: [Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6], forward: [Math.cos(a), 0, Math.sin(a)], down: [0, 1, 0] };
  });
  return { points, cameras };
}

async function worker(page: Page, { outcome = 'complete' }: { outcome?: 'complete' | 'failed' } = {}) {
  const seen = { tickets: 0, uploads: [] as { auth: string; type: string }[], deletes: 0, polls: 0 };
  const { points, cameras } = room();
  await page.route('**/api/world/status', (route) => route.fulfill({ json: { configured: true, status: 'configured', workerUrl: WORKER } }));
  await page.route('**/api/world/ticket', (route) => { seen.tickets += 1; route.fulfill({ json: { ticket: 'v1.9999999999.' + 'a'.repeat(32) + '.sig', expiresAt: 9999999999, workerUrl: WORKER } }); });
  await page.route(`${WORKER}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url()), headers = { 'access-control-allow-origin': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-headers': 'authorization,content-type,x-filename', 'access-control-allow-methods': 'GET,POST,DELETE' } });
    if (request.method() === 'POST' && url.pathname === '/v1/site-scans') {
      seen.uploads.push({ auth: request.headers().authorization, type: request.headers()['content-type'] });
      return route.fulfill({ status: 202, headers, json: { version: 1, id: ID, status: 'queued', stage: 'Waiting for reconstruction', progress: 0.05, createdAt: Date.now() / 1000, accessKey: KEY, artifacts: [] } });
    }
    expect(request.headers().authorization).toBe(`Scan ${KEY}`);
    if (request.method() === 'DELETE') { seen.deletes += 1; return route.fulfill({ headers, json: { version: 1, deleted: true } }); }
    if (url.pathname === `/v1/site-scans/${ID}`) {
      seen.polls += 1;
      const done = seen.polls > 1;
      const status = done ? outcome : 'running';
      return route.fulfill({ headers, json: {
        version: 1, id: ID, status, stage: done ? 'Ready' : 'Matching overlapping views', progress: done ? 1 : 0.45, createdAt: Date.now() / 1000 - 30,
        error: status === 'failed' ? { code: 'no_reconstruction', message: 'The views could not be aligned. Recapture with more overlap and visible stationary detail.' } : null,
        artifacts: status === 'complete' ? ['scan.json', 'point-cloud.json', 'cameras.json', 'sparse.ply'].map((name) => ({ name })) : [],
      } });
    }
    const artifact = url.pathname.split('/').pop();
    if (artifact === 'scan.json') return route.fulfill({ headers, json: { capture: { images: 40, registeredCameras: 40, reconstructedPoints: 4000, registrationFraction: 1 }, provenance: { colmapBackend: 'pycolmap', colmapBuild: 'COLMAP fixture' }, warnings: [] } });
    if (artifact === 'point-cloud.json') return route.fulfill({ headers, json: { version: 1, units: 'arbitrary', points } });
    if (artifact === 'cameras.json') return route.fulfill({ headers, json: { version: 1, cameras } });
    if (artifact === 'sparse.ply') return route.fulfill({ headers, body: 'ply\nformat ascii 1.0\nend_header\n', contentType: 'application/octet-stream' });
    return route.fulfill({ status: 404, headers, json: { version: 1, error: { code: 'not_found', message: 'missing' } } });
  });
  return seen;
}

test('a video becomes an explorable world without passing through the website', async ({ page }) => {
  test.setTimeout(90_000);
  const seen = await worker(page);
  await page.goto('/scan');
  await page.getByLabel('Select phone video or photographs').setInputFiles({ name: 'kitchen.mov', mimeType: 'video/quicktime', buffer: MP4 });
  await page.getByLabel('Name your space (optional)').fill('Kitchen');
  await page.getByRole('button', { name: /Build my 3D world/ }).click();
  await page.waitForURL(new RegExp(`/world/${ID}#k=${KEY}$`));
  expect(seen.tickets).toBe(1);
  expect(seen.uploads).toEqual([{ auth: 'Ticket v1.9999999999.' + 'a'.repeat(32) + '.sig', type: 'video/quicktime' }]);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kitchen');
  await expect(page.locator('.world-view-badge')).toContainText('4,000 points', { timeout: 20_000 });
  await expect(page.locator('.world-view-facts')).toContainText('40 / 40');
  await page.getByRole('button', { name: 'Walk the path' }).click();
  await expect(page.locator('.world-view-actions')).toContainText(/Walking \d+%/);
  await page.getByRole('button', { name: 'Overview' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Point cloud (PLY)' }).click();
  expect((await download).suggestedFilename()).toBe('kitchen-sparse.ply');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete world' }).click();
  await expect(page.getByRole('heading', { name: 'World deleted' })).toBeVisible();
  expect(seen.deletes).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('capture page explains what cannot be built and when reconstruction is offline', async ({ page }) => {
  await page.route('**/api/world/status', (route) => route.fulfill({ json: { configured: false, status: 'not_configured', workerUrl: null } }));
  await page.goto('/scan');
  await page.getByLabel('Select phone video or photographs').setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 });
  await expect(page.getByText(/Reconstruction is not connected right now/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Build my 3D world/ })).toHaveCount(0);
  await worker(page);
  await page.reload();
  const photos = Array.from({ length: 3 }, (_, i) => ({ name: `p${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, i]) }));
  await page.getByLabel('Select phone video or photographs').setInputFiles(photos);
  await expect(page.getByText('Add at least 8 overlapping photos, or use a video.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Build my 3D world/ })).toBeDisabled();
});

test('a failed reconstruction and an incomplete link explain what to do next', async ({ page }) => {
  await worker(page, { outcome: 'failed' });
  await page.goto(`/world/${ID}#k=${KEY}`);
  await expect(page.getByRole('heading', { name: 'This capture could not become a world' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/could not be aligned/)).toBeVisible();
  await page.goto(`/world/${ID}`);
  await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
});
