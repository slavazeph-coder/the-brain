import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from '../test/tinyVitest.js';
import { createGpuBridge } from './gpuBridge.js';
import { createGpuInferenceClient, analyzeContentWithGpu } from './gpuInference.js';

const nativeFetch = globalThis.fetch;
const key = 'worker-fixture-key-'.padEnd(40, 'w');
const env = { GPU_INFERENCE_TRANSPORT: 'outbound', GPU_INFERENCE_MODEL: 'brainsnn-local',
  GPU_BRIDGE_WORKER_KEY: key, GPU_BRIDGE_SINGLE_REPLICA: '1' };
const headers = { Authorization: 'Bearer ' + key, 'X-BrainSNN-Worker': 'test-worker-01', 'Content-Type': 'application/json' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, port: server.address().port,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

async function harness(run, options = {}) {
  const bridge = createGpuBridge(env, { pollMs: 30, deadlineMs: 500, ...options });
  const server = await serve(bridge.handle);
  try { await run(bridge, server.url); }
  finally { bridge.close(); await server.close(); }
}

it('GPU bridge is disabled unless explicitly configured for one replica', async () => {
  for (const config of [{}, { ...env, GPU_BRIDGE_SINGLE_REPLICA: '' }, { ...env, GPU_BRIDGE_WORKER_KEY: 'short' }]) {
    const bridge = createGpuBridge(config);
    const client = createGpuInferenceClient(config, { transport: bridge });
    assert.equal(bridge.configured, false);
    assert.equal(client.snapshot().configured, false);
    bridge.close();
  }
});

it('GPU bridge authenticates before parsing and fast-fails with no connected worker', async () => {
  await harness(async (bridge, url) => {
    const denied = await nativeFetch(url + '/jobs/00000000-0000-0000-0000-000000000000',
      { method: 'POST', headers: { ...headers, Authorization: 'Bearer wrong' }, body: '{broken' });
    assert.equal(denied.status, 401);
    assert.equal((await bridge.request('models', { method: 'GET' })).status, 503);
    const client = createGpuInferenceClient(env, { transport: bridge });
    const result = await analyzeContentWithGpu({ client, content: 'Consider the evidence before deciding.' });
    assert.equal(result.isFallback, true);
    assert.ok(result.engineTrace.some((r) => r.stage === 'Local fallback'));
  });
});

it('GPU bridge caps queued plus leased jobs and rejects expired or duplicate results', async () => {
  await harness(async (bridge, url) => {
    await nativeFetch(url + '/next', { headers }); // Register a worker; idle poll completes.
    const first = bridge.request('models', { method: 'GET' });
    const second = bridge.request('models', { method: 'GET' });
    assert.equal((await bridge.request('models', { method: 'GET' })).status, 429);
    const lease = await (await nativeFetch(url + '/next', { headers })).json();
    assert.equal(bridge.snapshot().outstanding, 2);
    const posted = await nativeFetch(url + '/jobs/' + lease.id, { method: 'POST', headers,
      body: JSON.stringify({ status: 200, body: { data: [{ id: 'brainsnn-local' }] } }) });
    assert.equal(posted.status, 200);
    assert.equal((await first).status, 200);
    const duplicate = await nativeFetch(url + '/jobs/' + lease.id, { method: 'POST', headers, body: '{}' });
    assert.equal(duplicate.status, 410);
    const expiredLease = await (await nativeFetch(url + '/next', { headers })).json();
    assert.equal((await second).status, 504);
    const late = await nativeFetch(url + '/jobs/' + expiredLease.id, { method: 'POST', headers,
      body: JSON.stringify({ status: 200, body: { data: [] } }) });
    assert.equal(late.status, 410);
    assert.equal(bridge.snapshot().outstanding, 0);
  }, { deadlineMs: 150 });
});

it('GPU bridge cancellation frees queued and leased jobs and caps result bodies', async () => {
  await harness(async (bridge, url) => {
    await nativeFetch(url + '/next', { headers });
    const queued = new AbortController();
    const cancelled = bridge.request('models', { method: 'GET', signal: queued.signal });
    queued.abort();
    assert.equal((await cancelled).status, 504);
    assert.equal(bridge.snapshot().outstanding, 0);
    const leased = new AbortController();
    const pending = bridge.request('models', { method: 'GET', signal: leased.signal });
    const job = await (await nativeFetch(url + '/next', { headers })).json();
    const large = await nativeFetch(url + '/jobs/' + job.id, { method: 'POST', headers,
      body: JSON.stringify({ status: 200, body: { data: 'x'.repeat(65536) } }) });
    assert.equal(large.status, 413);
    leased.abort();
    assert.equal((await pending).status, 504);
    assert.equal((await nativeFetch(url + '/jobs/' + job.id, { headers })).status, 410);
  });
});

it('GPU bridge bounds long polls, cleans disconnected polls and expires worker presence', async () => {
  await harness(async (bridge, url) => {
    const one = new AbortController(), two = new AbortController();
    const pending = [one, two].map((c) => nativeFetch(url + '/next', { headers, signal: c.signal }).catch(() => null));
    await delay(25);
    assert.equal((await nativeFetch(url + '/next', { headers })).status, 429);
    one.abort(); two.abort(); await Promise.all(pending);
    await delay(25);
    const connected = await nativeFetch(url + '/next', { headers });
    assert.equal(connected.status, 200);
    await delay(50);
    assert.equal(bridge.snapshot().workerOnline, false);
    assert.equal((await bridge.request('models', { method: 'GET' })).status, 503);
  }, { pollMs: 80, staleMs: 40 });
});

