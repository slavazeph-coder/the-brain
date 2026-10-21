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
  await test('deformable task serves real WASM and versioned local modules', async () => {
    const bare = await get('/arena/deformable?source=arcade');
    assert.equal(bare.status, 308);
    assert.equal(bare.headers.get('location'), '/arena/deformable/?source=arcade');
    const document = await get('/arena/deformable/');
    assert.equal(document.status, 200);
    assert.match(document.headers.get('content-type'), /text\/html/);
    assert.match(await document.text(), /deformable-physics-2026-10-17-v1/);
    for (const name of ['app.js', 'simulation-worker.js', 'rope-physics.js', 'journal.js', 'renderer.js', 'vendor/mujoco.js']) {
      const response = await get('/arena/deformable/' + name);
      assert.equal(response.status, 200, name);
      assert.match(response.headers.get('content-type'), /javascript/, name);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    }
    const wasm = await get('/arena/deformable/vendor/mujoco.wasm', { headers: { Range: 'bytes=0-7' } });
    assert.equal(wasm.status, 206);
    assert.match(wasm.headers.get('content-type'), /application\/wasm/);
    assert.deepEqual(Array.from(new Uint8Array(await wasm.arrayBuffer())), [0, 97, 115, 109, 1, 0, 0, 0]);
    const manifest = await (await get('/arena/deformable/runtime-manifest.json')).json();
    assert.equal(manifest.engine.version, '3.16.0');
    assert(manifest.assets.some(asset => asset.path === 'vendor/mujoco.wasm' && /^[a-f0-9]{64}$/.test(asset.sha256)));
    assert.equal((await get('/arena/deformable/', { method: 'POST' })).status, 405);
  });
  await test('expressive motion page serves its viewer, robot model and Draco decoder locally', async () => {
    const bare = await get('/arena/motion?source=arcade');
    assert.equal(bare.status, 308);
    assert.equal(bare.headers.get('location'), '/arena/motion/?source=arcade');
    const document = await get('/arena/motion/');
    assert.equal(document.status, 200);
    assert.match(await document.text(), /reachy-motion-2026-10-21-v1/);
    for (const name of ['app.js', 'renderer.js', 'robot/draco/draco_wasm_wrapper.js']) {
      const response = await get('/arena/motion/' + name);
      assert.equal(response.status, 200, name);
      assert.match(response.headers.get('content-type'), /javascript/, name);
    }
    const urdf = await get('/arena/motion/robot/reachy-mini.urdf');
    assert.equal(urdf.status, 200);
    const meshes = [...(await urdf.text()).matchAll(/filename="meshes_optimized\/([^"]+\.glb)"/g)].map(match => match[1]);
    assert(meshes.length > 30);
    for (const mesh of new Set(meshes)) assert.equal((await get('/arena/motion/robot/meshes_optimized/' + mesh, { method: 'HEAD' })).status, 200, mesh);
    const wasm = await get('/arena/motion/robot/draco/draco_decoder.wasm', { headers: { Range: 'bytes=0-3' } });
    assert.equal(wasm.status, 206);
    assert.deepEqual(Array.from(new Uint8Array(await wasm.arrayBuffer())), [0, 97, 115, 109]);
    const examples = await (await get('/arena/motion/examples.json')).json();
    assert(examples.length >= 20 && examples.every(example => example.moves.length && example.recipe));
    const manifest = await (await get('/arena/motion/runtime-manifest.json')).json();
    assert.equal(manifest.upstream.commit, '96497d69a31cc89da209f224bd9c1fee1834b864');
    assert(manifest.assets.some(asset => asset.path === 'robot/reachy-mini.urdf' && /^[a-f0-9]{64}$/.test(asset.sha256)));
    for (const licence of ['LICENSE-reachy-motion-generator.txt', 'robot/LICENSE-reachy_mini_3d_web_viz.txt', 'robot/ATTRIBUTIONS.md']) {
      assert.equal((await get('/arena/motion/' + licence, { method: 'HEAD' })).status, 200, licence);
    }
    assert.equal((await get('/arena/motion/', { method: 'POST' })).status, 405);
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
