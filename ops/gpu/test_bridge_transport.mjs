import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test as it } from 'node:test';
import { createGpuBridge } from '../../brainsnn-r3f-app/src/server/gpuBridge.js';
import { createGpuInferenceClient, analyzeContentWithGpu } from '../../brainsnn-r3f-app/src/server/gpuInference.js';
const key = 'worker-fixture-key-'.padEnd(40, 'w');
const env = { GPU_INFERENCE_TRANSPORT: 'outbound', GPU_INFERENCE_MODEL: 'brainsnn-local',
  GPU_BRIDGE_WORKER_KEY: key, GPU_BRIDGE_SINGLE_REPLICA: '1' };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function serve(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, port: server.address().port,
    close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

it('Real Python worker carries the production adapter across HTTP and preserves fallback validation', async () => {
  const analysis = { title: 'Measured pilot', fear: 0, anger: 0, urgency: 0, trust: 80, excitement: 10, empathy: 20,
    firingRate: 40, plasticity: 50, attentionCurve: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], riskRating: 'Low',
    riskDescription: 'Verify the data.', viralScore: 0, gaugeGapScore: 0, confidence: 0,
    summary: 'Evidence supports a cautious conclusion.', insights: ['Evidence.', 'Scope.', 'Limits.'],
    recommendations: ['Cite data.', 'Explain scope.', 'State limits.'], payloadType: 'Organic Baseline' };
  const gatewayKey = 'gateway-only-fixture-key'.padEnd(40, 'g');
  let corrupt = false, calls = 0;
  const gateway = await serve(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + gatewayKey);
    assert.equal(req.headers['x-brainsnn-worker'], undefined);
    let data = '';
    for await (const chunk of req) data += chunk;
    let result;
    if (req.url === '/v1/models') result = { data: [{ id: 'brainsnn-local' }] };
    else {
      assert.equal(req.url, '/v1/chat/completions');
      const value = JSON.parse(data);
      assert.equal(value.response_format.type, 'json_object');
      assert.equal(value.stream, false);
      calls += 1;
      result = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(corrupt ? { bad: true } : analysis) } }] };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
  });
  const bridge = createGpuBridge(env);
  const server = await serve((req, res) => { req.url = req.url.replace(/^\/api\/gpu-worker/, ''); bridge.handle(req, res); });
  const worker = spawn('python3', [fileURLToPath(new URL('./bridge_worker.py', import.meta.url))],
    { env: { PATH: process.env.PATH, GPU_BRIDGE_URL: server.url + '/api/gpu-worker', GPU_BRIDGE_ALLOW_LOOPBACK_HTTP: '1',
      GPU_BRIDGE_WORKER_KEY: key, GPU_API_KEY: gatewayKey, GATEWAY_PORT: String(gateway.port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; worker.stderr.on('data', (part) => { errors += part; });
  try {
    const until = Date.now() + 5000;
    while (!bridge.snapshot().workerOnline && Date.now() < until && worker.exitCode === null) await delay(20);
    assert.equal(bridge.snapshot().workerOnline, true, errors);
    const client = createGpuInferenceClient(env, { transport: bridge, healthTtlMs: 0 });
    assert.equal((await client.health()).status, 'reachable');
    const result = await analyzeContentWithGpu({ client, content: 'Our pilot measured a 12% improvement in 30 teams.' });
    assert.equal(result.isFallback, false);
    assert.equal(result.metrics.fear, 0);
    assert.equal(result.confidence, 0);
    assert.ok(result.engineTrace.some((r) => r.stage === 'GPU inference' && r.status === 'completed'));
    corrupt = true;
    const fallback = await analyzeContentWithGpu({ client, content: 'Our pilot measured a 12% improvement in 30 teams.' });
    assert.equal(fallback.isFallback, true);
    assert.equal(client.snapshot().lastInferenceStatus, 'invalid_output');
    assert.equal(calls, 2);
    assert.ok(!JSON.stringify(bridge.snapshot()).includes(key));
  } finally {
    worker.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), delay(4000)]);
    if (worker.exitCode === null) worker.kill('SIGKILL');
    bridge.close(); await server.close(); await gateway.close();
  }
});
