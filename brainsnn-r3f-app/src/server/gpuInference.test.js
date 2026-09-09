import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from '../test/tinyVitest.js';
import { analyzeContentLocally } from '../lib/analysisEngine.js';
import { analyzeContentWithGpu, createGpuInferenceClient } from './gpuInference.js';

// tinyVitest shares beforeEach hooks across files. outcomeSync.test.js clears
// global.fetch in its hook, so retain the native transport before tests run and
// inject it only into the real HTTP contract tests below.
const nativeFetch = globalThis.fetch;

const env = {
  GPU_INFERENCE_URL: 'https://private-gpu.example/v1',
  GPU_INFERENCE_KEY: 'test-secret-not-public',
  GPU_INFERENCE_MODEL: 'test-model',
};
const sample = 'Our pilot measured a 12% improvement across 30 teams. Review the results and limitations before deciding.';
const analysis = () => ({
  title: 'Evidence before pressure', fear: 0, anger: 0, urgency: 0, trust: 90,
  excitement: 25, empathy: 55, firingRate: 40, plasticity: 60,
  attentionCurve: [0, 10, 20, 30, 40, 50, 40, 30, 20, 10],
  riskRating: 'Low', riskDescription: 'Check that the stated pilot result is supported.',
  viralScore: 0, gaugeGapScore: 0, confidence: 0,
  summary: 'The message offers specific evidence and space to decide. Verify the cited pilot.',
  insights: ['Specific evidence supports trust.', 'The reader can decide.', 'The pilot needs a source.'],
  recommendations: ['Link the pilot.', 'State the sample limitations.', 'Define the measured improvement.'],
  payloadType: 'Organic Baseline',
});
const envelope = (data = analysis(), finishReason = 'stop') => ({
  choices: [{ finish_reason: finishReason, message: { role: 'assistant', content: JSON.stringify(data) } }],
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function withHttpServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}/v1`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

it('GPU sends the authenticated OpenAI request and preserves valid zero scores in the complete layer stack', async () => {
  let received;
  await withHttpServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received = { url: req.url, method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(envelope({ ...analysis(), engineTrace: ['untrusted'], isFallback: true, secret: 'discard' })));
  }, async (url) => {
    const client = createGpuInferenceClient({ ...env, GPU_INFERENCE_URL: url }, { fetchImpl: nativeFetch });
    const result = await analyzeContentWithGpu({ client, content: sample });
    assert.equal(result.isFallback, false);
    assert.equal(result.metrics.fear, 0);
    assert.equal(result.confidence, 0);
    assert.equal(result.viralScore, 0);
    assert.equal(result.gaugeGapScore, 0);
    assert.equal(result.attentionCurve[0].level, 0);
    assert.equal(result.secret, undefined);
    assert.ok(result.receipt.id.startsWith('bsnn-'));
    assert.ok(result.engineTrace.some((row) => row.stage === 'GPU inference' && row.status === 'completed'));
    assert.ok(!result.engineTrace.includes('untrusted'));
    assert.equal(client.snapshot().lastInferenceStatus, 'completed');
  });
  assert.equal(received.url, '/v1/chat/completions');
  assert.equal(received.method, 'POST');
  assert.equal(received.authorization, `Bearer ${env.GPU_INFERENCE_KEY}`);
  assert.equal(received.body.model, env.GPU_INFERENCE_MODEL);
  assert.equal(received.body.stream, false);
  assert.equal(received.body.max_tokens, 2048);
  assert.deepEqual(received.body.response_format, { type: 'json_object' });
  assert.deepEqual(JSON.parse(received.body.messages[1].content), { contentType: 'text', content: sample });
  assert.equal(received.body.messages[0].role, 'system');
});

it('GPU declines incomplete credentials and unsafe remote transport before making any request', async () => {
  let calls = 0;
  for (const config of [
    {}, { ...env, GPU_INFERENCE_KEY: '' }, { ...env, GPU_INFERENCE_MODEL: '' },
    { ...env, GPU_INFERENCE_URL: 'http://gpu.example/v1' },
    { ...env, GPU_INFERENCE_URL: 'https://name:password@gpu.example/v1' },
    { ...env, GPU_INFERENCE_URL: 'https://gpu.example/v1?key=secret' },
    { ...env, GPU_INFERENCE_URL: 'file:///tmp/model' },
  ]) {
    const client = createGpuInferenceClient(config, { fetchImpl: async () => { calls += 1; return json(envelope()); } });
    assert.equal((await client.analyze(sample)).ok, false);
    assert.equal((await client.health()).configured, false);
  }
  assert.equal(calls, 0);
});

it('GPU malformed, incomplete, out-of-range and truncated answers fall back with the original deterministic scores', async () => {
  const invalidCases = [
    envelope({ ...analysis(), fear: '0' }),
    envelope({ ...analysis(), fear: 101 }),
    envelope({ ...analysis(), gaugeGapScore: -40 }),
    envelope({ ...analysis(), attentionCurve: [50] }),
    envelope({ ...analysis(), recommendations: [{ command: 'do something' }] }),
    envelope({ ...analysis(), summary: 'x'.repeat(2001) }),
    envelope({}), envelope(analysis(), 'length'),
    { choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] },
    { unexpected: 'schema' },
  ];
  const local = analyzeContentLocally({ content: sample, forceFallback: true });
  for (const payload of invalidCases) {
    const client = createGpuInferenceClient(env, { fetchImpl: async () => json(payload) });
    const result = await analyzeContentWithGpu({ client, content: sample });
    assert.equal(result.isFallback, true);
    assert.deepEqual(result.metrics, local.metrics);
    assert.equal(result.rawContent, sample);
    assert.ok(result.engineTrace.some((row) => row.stage === 'GPU inference' && row.status === 'invalid_output'));
    assert.ok(result.engineTrace.some((row) => row.stage === 'Local fallback' && row.status === 'completed'));
  }
});

it('GPU bounds a stalled response body with the same deadline as connection setup', async () => {
  await withHttpServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":');
    // Deliberately never finish the body: receiving headers is not success.
  }, async (url) => {
    const client = createGpuInferenceClient({ ...env, GPU_INFERENCE_URL: url }, { fetchImpl: nativeFetch, timeoutMs: 100 });
    const start = Date.now();
    const result = await analyzeContentWithGpu({ client, content: sample });
    assert.equal(result.isFallback, true);
    assert.ok(Date.now() - start < 1500);
    assert.ok(result.engineTrace.some((row) => row.stage === 'GPU inference' && row.status === 'timeout'));
    assert.equal(client.snapshot().inFlight, 0);
  });
});

it('GPU bounds connection/header wait and releases capacity after timeout', async () => {
  let calls = 0;
  const client = createGpuInferenceClient(env, {
    timeoutMs: 30,
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls > 1) return json(envelope());
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });
  assert.equal((await client.analyze(sample)).reason, 'timeout');
  assert.equal((await client.analyze(sample)).ok, true);
  assert.equal(client.snapshot().inFlight, 0);
});

it('GPU caps response bytes with and without a Content-Length header', async () => {
  for (const hasLength of [true, false]) {
    let cancelled = false;
    const client = createGpuInferenceClient(env, {
      maxResponseBytes: 1024,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(2048))); },
        cancel() { cancelled = true; },
      }), { headers: { 'Content-Type': 'application/json', ...(hasLength ? { 'Content-Length': '2048' } : {}) } }),
    });
    assert.equal((await client.analyze(sample)).reason, 'response_too_large');
    assert.equal(cancelled, true);
  }
});

it('GPU immediately falls back when two analyses are in flight and admits work after completion', async () => {
  const pending = [];
  const client = createGpuInferenceClient(env, { fetchImpl: () => new Promise((resolve) => pending.push(resolve)) });
  const first = client.analyze(sample);
  const second = client.analyze(sample);
  assert.equal(client.snapshot().inFlight, 2);
  const busy = await analyzeContentWithGpu({ client, content: sample });
  assert.equal(busy.isFallback, true);
  assert.ok(busy.engineTrace.some((row) => row.stage === 'GPU inference' && row.status === 'busy'));
  assert.equal(pending.length, 2);
  for (const resolve of pending) resolve(json(envelope()));
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(client.snapshot().inFlight, 0);
  const next = client.analyze(sample);
  pending[2](json(envelope()));
  assert.equal((await next).ok, true);
});

it('GPU health coalesces and caches checks and does not claim tested inference or reveal connection secrets', async () => {
  let calls = 0;
  let resolveCheck;
  const client = createGpuInferenceClient(env, { fetchImpl: (_url, options) => {
    calls += 1;
    assert.equal(options.headers.Authorization, `Bearer ${env.GPU_INFERENCE_KEY}`);
    return new Promise((resolve) => { resolveCheck = resolve; });
  } });
  assert.equal(client.snapshot().status, 'unverified');
  const a = client.health();
  const b = client.health();
  resolveCheck(json({ data: [{ id: env.GPU_INFERENCE_MODEL }] }));
  const statuses = await Promise.all([a, b, client.health()]);
  await client.health();
  assert.equal(calls, 1);
  for (const status of statuses) {
    assert.equal(status.status, 'reachable');
    assert.equal(status.lastInferenceStatus, 'not_tested');
    assert.equal(status.lastSuccessAt, null);
    const serialized = JSON.stringify(status);
    assert.ok(!serialized.includes(env.GPU_INFERENCE_KEY));
    assert.ok(!serialized.includes('private-gpu'));
  }
});

it('GPU health rejects missing models and authentication failures without trusting error text', async () => {
  const noModel = createGpuInferenceClient(env, { fetchImpl: async () => json({ data: [{ id: 'another-model' }] }) });
  assert.equal((await noModel.health()).status, 'model_unavailable');
  const unauthorized = createGpuInferenceClient(env, { fetchImpl: async () => json({ error: env.GPU_INFERENCE_KEY }, 401) });
  assert.equal((await unauthorized.health()).status, 'authentication_failed');
  const result = await analyzeContentWithGpu({ client: unauthorized, content: sample });
  assert.equal(result.isFallback, true);
  assert.ok(!JSON.stringify(result).includes(env.GPU_INFERENCE_KEY));
});

it('GPU refuses redirected upstream calls rather than forwarding credentials or accepting a redirected result', async () => {
  let hits = 0;
  await withHttpServer((_req, res) => {
    hits += 1;
    res.writeHead(307, { Location: '/redirected' });
    res.end();
  }, async (url) => {
    const client = createGpuInferenceClient({ ...env, GPU_INFERENCE_URL: url }, { fetchImpl: nativeFetch });
    assert.equal((await client.analyze(sample)).ok, false);
    assert.equal(hits, 1);
  });
});

it('GPU caps submitted input and never sends malformed input upstream', async () => {
  let calls = 0;
  const client = createGpuInferenceClient(env, { fetchImpl: async () => { calls += 1; return json(envelope()); } });
  for (const input of ['', {}, '🧠'.repeat(5000)]) assert.equal((await client.analyze(input)).reason, 'invalid_input');
  assert.equal((await client.analyze(sample, 'x'.repeat(81))).reason, 'invalid_input');
  assert.equal(calls, 0);
});
