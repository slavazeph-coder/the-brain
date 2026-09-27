#!/usr/bin/env node
// Real adapter + HTTP broker + actual Python worker against an operator-provided
// localhost gateway/SSH forward. Keys are inherited/generated, never printed.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGpuBridge } from '../../../brainsnn-r3f-app/src/server/gpuBridge.js';
import { createGpuInferenceClient, analyzeContentWithGpu } from '../../../brainsnn-r3f-app/src/server/gpuInference.js';

if (!process.env.GPU_API_KEY || process.env.GPU_API_KEY.length < 32) throw new Error('Set private GPU_API_KEY in the environment');
const env = { GPU_INFERENCE_TRANSPORT: 'outbound', GPU_INFERENCE_MODEL: process.env.GPU_INFERENCE_MODEL || 'brainsnn-local',
  GPU_BRIDGE_WORKER_KEY: randomBytes(32).toString('hex'), GPU_BRIDGE_SINGLE_REPLICA: '1' };
const bridge = createGpuBridge(env);
const server = createServer((req, res) => {
  if (!req.url.startsWith('/api/gpu-worker/')) { res.writeHead(404); res.end(); return; }
  req.url = req.url.slice('/api/gpu-worker'.length); bridge.handle(req, res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/api/gpu-worker`;
const worker = spawn(process.env.PYTHON_EXECUTABLE || 'python3', [fileURLToPath(new URL('../bridge_worker.py', import.meta.url))],
  { env: { PATH: process.env.PATH, GPU_BRIDGE_URL: url, GPU_BRIDGE_ALLOW_LOOPBACK_HTTP: '1',
    GPU_BRIDGE_WORKER_KEY: env.GPU_BRIDGE_WORKER_KEY, GPU_API_KEY: process.env.GPU_API_KEY,
    GATEWAY_PORT: process.env.GATEWAY_PORT || '8787' }, stdio: ['ignore', 'ignore', 'ignore'] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  const until = Date.now() + 5000;
  while (!bridge.snapshot().workerOnline && Date.now() < until && worker.exitCode === null) await sleep(20);
  if (!bridge.snapshot().workerOnline) throw new Error('Worker did not connect');
  const unauthorized = await fetch(url + '/next');
  const client = createGpuInferenceClient(env, { transport: bridge, healthTtlMs: 0 });
  const health = await client.health();
  const runs = [];
  for (let index = 0; index < Math.max(1, Math.min(5, Number(process.env.PROBE_ITERATIONS || 3))); index += 1) {
    const started = Date.now();
    const result = await analyzeContentWithGpu({ client,
      content: process.env.PROBE_CONTENT || 'Our pilot measured a 12% improvement across 30 teams. Review the results and limitations before deciding.' });
    runs.push({ durationMs: Date.now() - started, isFallback: result.isFallback,
      gpuStatus: client.snapshot().lastInferenceStatus,
      attentionCurvePoints: result.attentionCurve?.length, insights: result.insights?.length,
      recommendations: result.recommendations?.length });
  }
  bridge.close();
  const fallback = await analyzeContentWithGpu({ client, content: 'Review the evidence before deciding.' });
  const ok = unauthorized.status === 401 && runs.every((r) => !r.isFallback && r.gpuStatus === 'completed')
    && fallback.isFallback === true;
  console.log(JSON.stringify({ BRAINSNN_OUTBOUND_GPU_OK: ok, utc: new Date().toISOString(),
    unauthorizedStatus: unauthorized.status, health, runs, disconnectedFallback: fallback.isFallback === true }, null, 2));
  process.exitCode = ok ? 0 : 1;
} finally {
  worker.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => worker.once('exit', resolve)), sleep(3000)]);
  if (worker.exitCode === null) worker.kill('SIGKILL');
  bridge.close(); server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
