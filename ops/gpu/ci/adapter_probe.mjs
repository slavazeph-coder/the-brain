#!/usr/bin/env node
// Exercises BrainSNN's REAL production GPU adapter against a gateway reachable
// at GPU_INFERENCE_URL. In CI that URL is an SSH local port-forward to the
// container's 127.0.0.1 gateway, so neither the gateway nor vLLM is ever
// exposed publicly. Prints evidence to stdout. Never prints credentials.
import { createGpuInferenceClient, analyzeContentWithGpu } from
  '../../../brainsnn-r3f-app/src/server/gpuInference.js';

const content = process.env.PROBE_CONTENT
  || 'Breaking: officials refuse to answer questions about the missing funds. Share before this is taken down.';
const iterations = Math.max(1, Math.min(10, Number(process.env.PROBE_ITERATIONS || 1)));

const client = createGpuInferenceClient(process.env);
if (!client.enabled) {
  console.log(JSON.stringify({ BRAINSNN_REAL_GPU_INFERENCE_OK: false, reason: 'adapter_not_configured' }, null, 2));
  process.exit(2);
}

const health = await client.health();
const runs = [];
for (let index = 0; index < iterations; index += 1) {
  const started = Date.now();
  const result = await analyzeContentWithGpu({ client, content, contentType: 'text', engineStatus: {} });
  // runLayerRouter merges the provider trace into the response's engineTrace.
  const trace = (result.engineTrace || [])
    .filter((entry) => entry && entry.provider)
    .map(({ stage, provider, status }) => ({ stage, provider, status }));
  const gpu = trace.find((entry) => entry.provider === 'gpu');
  const localFallback = trace.some((entry) => entry.provider === 'local');
  runs.push({
    index,
    durationMs: Date.now() - started,
    gpuStatus: gpu ? gpu.status : 'absent',
    localFallbackInTrace: localFallback,
    isFallback: result.isFallback === true,
    // Structural proof the validated schema was populated by the model.
    title: typeof result.title === 'string' ? result.title.slice(0, 120) : null,
    payloadType: result.payloadType ?? null,
    riskRating: result.riskRating ?? null,
    confidence: result.confidence ?? null,
    attentionCurvePoints: Array.isArray(result.attentionCurve) ? result.attentionCurve.length : 0,
    insights: Array.isArray(result.insights) ? result.insights.length : 0,
    recommendations: Array.isArray(result.recommendations) ? result.recommendations.length : 0,
    providerTrace: trace,
  });
}

const ok = runs.every((run) => run.gpuStatus === 'completed' && run.isFallback === false
  && run.localFallbackInTrace === false
  && run.attentionCurvePoints === 10 && run.insights === 3 && run.recommendations === 3);

console.log(JSON.stringify({
  BRAINSNN_REAL_GPU_INFERENCE_OK: ok,
  utc: new Date().toISOString(),
  model: process.env.GPU_INFERENCE_MODEL,
  // snapshot() intentionally carries no URL or credential.
  healthSnapshot: health,
  runs,
}, null, 2));
process.exit(ok ? 0 : 1);
