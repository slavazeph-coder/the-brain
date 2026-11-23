import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { it } from '../test/tinyVitest.js';
import { createCompression, setStaticCacheHeaders } from './staticDelivery.js';

const nativeFetch = globalThis.fetch;  // other suites stub fetch

async function site() {
  const root = mkdtempSync(path.join(tmpdir(), 'brainsnn-static-'));
  mkdirSync(path.join(root, 'assets')); mkdirSync(path.join(root, 'world'));
  const script = 'export const x = 1;\n'.repeat(400);
  writeFileSync(path.join(root, 'assets', 'index-Bmv2oPlC.js'), script);
  writeFileSync(path.join(root, 'assets', 'logo.svg'), '<svg/>'.repeat(400));
  writeFileSync(path.join(root, 'world', 'app.mjs'), script);
  const app = express();
  app.use(createCompression());
  app.get('/api/big', (_req, res) => res.json({ text: 'x'.repeat(5000) }));
  app.use(express.static(root, { index: false, setHeaders: setStaticCacheHeaders }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  // fetch decodes gzip and Brotli itself, so each check compares the decoded body with the original file.
  const get = (url, encoding) => nativeFetch(base + url, { headers: encoding ? { 'Accept-Encoding': encoding } : {} });
  return { get, script, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

it('static delivery: scripts and pages are compressed when the browser accepts it', async () => {
  const s = await site();
  try {
    for (const url of ['/world/app.mjs', '/assets/index-Bmv2oPlC.js']) {
      const gzip = await s.get(url, 'gzip');
      assert.equal(gzip.headers.get('content-encoding'), 'gzip', url);
      assert.match(gzip.headers.get('vary') || '', /Accept-Encoding/i);
      assert.equal(await gzip.text(), s.script, 'the decoded body is unchanged');
      const br = await s.get(url, 'br');
      assert.equal(br.headers.get('content-encoding'), 'br', url);
      assert.equal(await br.text(), s.script);
    }
    const plain = await s.get('/world/app.mjs', 'identity');
    assert.equal(plain.headers.get('content-encoding'), null, 'no encoding unless asked');
    assert.equal(await plain.text(), s.script);
  } finally { await s.close(); }
});

it('static delivery: API responses are never compressed', async () => {
  const s = await site();
  try {
    const api = await s.get('/api/big', 'gzip, br');
    assert.equal(api.headers.get('content-encoding'), null);
    assert.equal((await api.json()).text.length, 5000);
  } finally { await s.close(); }
});

it('static delivery: only content-hashed assets are cached for a year', async () => {
  const s = await site();
  try {
    assert.equal((await s.get('/assets/index-Bmv2oPlC.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    // Stable names must revalidate so a deploy is seen at once.
    for (const url of ['/world/app.mjs', '/assets/logo.svg']) {
      assert.equal((await s.get(url)).headers.get('cache-control'), 'public, max-age=0', url);
    }
  } finally { await s.close(); }
});

