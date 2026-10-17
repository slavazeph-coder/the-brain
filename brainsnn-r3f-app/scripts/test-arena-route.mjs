// Real HTTP checks for the exact static middleware used by server.ts. No
// paid services or browser are needed. Pass --dist to inspect Vite's output.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { createArenaRouter } from '../src/server/arenaStatic.js';

const directory = path.resolve(process.argv.includes('--dist') ? 'dist/arena' : 'public/arena');
const expected = readFileSync(path.join(directory, 'index.html'), 'utf8');
const app = express();
app.use('/arena', createArenaRouter({ directory }));
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.get('*', (_req, res) => res.type('html').send('<html>MAIN_SPA_FALLBACK</html>'));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const get = (url, options = {}) => fetch(base + url, { redirect: 'manual', ...options });
const raw = pathname => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port, path: pathname }, response => {
    let body = ''; response.setEncoding('utf8'); response.on('data', part => { body += part; });
    response.on('end', () => resolve({ status: response.statusCode, body }));
  }).on('error', reject);
});
let count = 0;
async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
try {
  await test('bare arena URL redirects permanently to relative-asset-safe path', async () => {
    const r = await get('/arena?source=home'); assert.equal(r.status, 308); assert.equal(r.headers.get('location'), '/arena/?source=home');
  });
  await test('arena document is delivered byte-for-byte without the main SPA', async () => {
    for (const url of ['/arena/', '/arena/index.html', '/arena/?source=home']) {
      const r = await get(url); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/html/); assert.equal(await r.text(), expected);
    }
  });
  await test('all local entry scripts and styles resolve with their correct content types', async () => {
    const resources = [...expected.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"#]+)"/g)].map(x => x[1]).filter(x => !/^(?:https?:|data:)/.test(x) && /\.(?:css|js)(?:\?|$)/.test(x));
    assert(resources.length >= 10);
    for (const file of resources) {
      const r = await get(new URL(file, base + '/arena/').pathname); assert.equal(r.status, 200, file);
      assert.match(r.headers.get('content-type'), file.endsWith('.css') ? /text\/css/ : /javascript/, file);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.match(r.headers.get('cache-control'), /must-revalidate/);
      assert(!(await r.text()).includes('MAIN_SPA_FALLBACK'), file);
    }
  });
  await test('robot assets support normal HEAD and byte-range delivery', async () => {
    const full = await get('/arena/assets/robots/panda.png', { method: 'HEAD' }); assert.equal(full.status, 200); assert.match(full.headers.get('content-type'), /image\/png/); assert.equal(await full.text(), '');
    const r = await get('/arena/assets/robots/panda.png', { headers: { Range: 'bytes=0-15' } }); assert.equal(r.status, 206); assert.equal((await r.arrayBuffer()).byteLength, 16);
  });
  await test('worker setup and downloadable kit are reachable', async () => {
    const docs = await get('/arena/worker-setup.html'); assert.equal(docs.status, 200); assert.match(docs.headers.get('content-type'), /text\/html/);
    const evaluation = await get('/arena/evaluation-setup.html'); assert.equal(evaluation.status, 200); assert.match(evaluation.headers.get('content-type'), /text\/html/); assert.match(await evaluation.text(), /run-campaign\.py/);
    const kit = await get('/arena/downloads/brainsnn-arena-worker.zip', { method: 'HEAD' }); assert.equal(kit.status, 200); assert.match(kit.headers.get('content-type'), /(?:zip|octet-stream)/);
  });
  await test('site testing viewer and private-worker setup are published as isolated assets', async () => {
    for (const name of ['site-renderer.js', 'site-core.js', 'site-operations.js', 'site-plan-worker.js', 'site-workspace.js', 'site-workspace.css', 'site-scan-worker.html', 'gym-pilot.html', 'downloads/brainsnn-site-scan-worker.zip']) {
      const response = await get('/arena/' + name, { method: 'HEAD' });
      assert.equal(response.status, 200, name);
      assert(Number(response.headers.get('content-length')) > 100, name);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    // Reconstruction uses an authenticated private worker. No upload API or
    // private capture data is exposed through the public static arena route.
    assert.equal((await get('/arena/site-scans', { method: 'POST' })).status, 405);
  });
  await test('missing assets, unknown arena routes and directories remain 404s', async () => {
    for (const url of ['/arena/missing.js', '/arena/missing.css', '/arena/unknown-page', '/arena/assets/robots/']) {
      const r = await get(url); assert.equal(r.status, 404, url); assert.equal(await r.text(), 'Arena asset not found.');
    }
  });
  await test('invalid traversal and dotfiles do not expose source or hit the SPA', async () => {
    for (const url of ['/arena/%2e%2e%2fpackage.json', '/arena/.env', '/arena/%00.js']) {
      const r = await raw(url); assert([400, 403, 404].includes(r.status), `${url}: ${r.status}`); assert(!r.body.includes('MAIN_SPA_FALLBACK')); assert(!r.body.includes('react-example'));
    }
  });
  await test('non-read methods are bounded to the arena and rejected clearly', async () => {
    const r = await get('/arena/', { method: 'POST' }); assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'GET, HEAD');
  });
  await test('health and the original application continue beyond the isolated arena router', async () => {
    const health = await get('/healthz'); assert.deepEqual(await health.json(), { status: 'ok' });
    assert.match(await (await get('/app')).text(), /MAIN_SPA_FALLBACK/);
  });
  console.log(`${count} arena HTTP integration checks passed (${directory}).`);
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
