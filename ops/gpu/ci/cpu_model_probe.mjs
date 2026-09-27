#!/usr/bin/env node
// Proves a candidate model can satisfy BrainSNN's production contract WITHOUT a
// GPU, by running the real gpuInference.js adapter against a CPU llama-server.
//
// Why two passes
// --------------
// configuration() clamps GPU_INFERENCE_TIMEOUT_MS to 30s, and CPU inference of
// this schema takes longer than that. Rather than weaken the production timeout
// (which would make the test lie about production behaviour), pass 1 captures
// the model's real reply with no deadline, and pass 2 replays that exact reply
// into the real adapter so the real validateAnalysis runs on real model output.
//
// What this proves: the model emits coherent output that satisfies every field
// rule in validateAnalysis, and the production adapter accepts it.
// What it does NOT prove: anything about the RTX 4090, CUDA, or GPU latency.
import {
  createGpuInferenceClient,
  analyzeContentWithGpu,
} from "../../../brainsnn-r3f-app/src/server/gpuInference.js";

const BASE = process.env.GPU_INFERENCE_URL;
const KEY = process.env.GPU_INFERENCE_KEY || "";
const MODEL = process.env.GPU_INFERENCE_MODEL || "brainsnn-local";
const CONTENT =
  process.env.PROBE_CONTENT ||
  "Breaking: officials refuse to answer questions about the missing funds. Share before this is taken down.";

const env = {
  GPU_INFERENCE_URL: BASE,
  GPU_INFERENCE_KEY: KEY,
  GPU_INFERENCE_MODEL: MODEL,
  GPU_INFERENCE_TIMEOUT_MS: "30000",
};

let captured = null;
let capturePromise = null;
let capturedBodyBytes = 0;
let inferenceSeconds = null;

// Pass 1: let the adapter build its own request (real SYSTEM_PROMPT, real
// parameters), forward it with no deadline, and cache the reply.
async function capturingFetch(url, options) {
  const started = Date.now();
  const work = (async () => {
    const response = await fetch(url, { ...options, signal: undefined });
    const text = await response.text();
    if (String(url).includes("chat/completions")) {
      captured = { status: response.status, text };
      capturedBodyBytes = Buffer.byteLength(text);
      inferenceSeconds = (Date.now() - started) / 1000;
    }
    return new Response(text, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  })();
  // The adapter's own 30s deadline will usually fire first on CPU, abandoning
  // this call. Hold the promise so pass 1 can still wait for the real reply -
  // otherwise `captured` is read while the request is in flight and the probe
  // blames the model for what is only slowness.
  if (String(url).includes("chat/completions")) capturePromise = work;
  return work;
}

// Pass 2: replay the cached reply instantly so the adapter's own deadline is
// never the thing under test.
function replayFetch(url) {
  if (String(url).includes("chat/completions")) {
    return Promise.resolve(
      new Response(captured.text, {
        status: captured.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }
  return fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });
}

const report = {
  CPU_MODEL_PROBE_OK: false,
  model: MODEL,
  utc: new Date().toISOString(),
};

try {
  const capturing = createGpuInferenceClient(env, {
    fetchImpl: capturingFetch,
  });
  if (!capturing.enabled || !capturing.snapshot().configured) {
    throw new Error("adapter refused the configuration");
  }
  // The adapter may abandon this on its own 30s deadline; the cache is what matters.
  await analyzeContentWithGpu({
    client: capturing,
    content: CONTENT,
    contentType: "text",
    engineStatus: {},
  }).catch(() => null);

  // Wait for the real generation even though the adapter already gave up on it.
  if (capturePromise) await capturePromise.catch(() => null);

  if (!captured)
    throw new Error("no chat/completions response was captured from the model");
  report.inferenceSeconds = Number(inferenceSeconds?.toFixed(1));
  report.responseBytes = capturedBodyBytes;

  // Surface what the model actually emitted, for eyeballing coherence.
  report.httpStatus = captured.status;
  try {
    const parsed = JSON.parse(captured.text);
    const content = parsed?.choices?.[0]?.message?.content;
    report.finishReason = parsed?.choices?.[0]?.finish_reason ?? null;
    report.modelJsonPreview =
      typeof content === "string" ? content.slice(0, 400) : null;
    // A non-200, or a 200 carrying an error envelope, is a SERVER fault. Surface
    // it verbatim rather than reporting a null preview, which reads as though the
    // model simply produced nothing and sends debugging in the wrong direction.
    if (captured.status !== 200 || parsed?.error) {
      report.upstreamError = captured.text.slice(0, 600);
    }
  } catch {
    report.modelJsonPreview = "<unparseable>";
    report.upstreamError = captured.text.slice(0, 600);
  }

  const replaying = createGpuInferenceClient(env, { fetchImpl: replayFetch });
  const result = await analyzeContentWithGpu({
    client: replaying,
    content: CONTENT,
    contentType: "text",
    engineStatus: {},
  });

  const trace = (result.engineTrace || [])
    .filter((e) => e && e.provider)
    .map(({ stage, provider, status }) => ({ stage, provider, status }));
  const gpu = trace.find((e) => e.provider === "gpu");

  report.gpuStatus = gpu ? gpu.status : "absent";
  report.isFallback = result.isFallback === true;
  report.localFallbackInTrace = trace.some((e) => e.provider === "local");
  report.title =
    typeof result.title === "string" ? result.title.slice(0, 120) : null;
  report.payloadType = result.payloadType ?? null;
  report.riskRating = result.riskRating ?? null;
  report.confidence = result.confidence ?? null;
  report.attentionCurvePoints = Array.isArray(result.attentionCurve)
    ? result.attentionCurve.length
    : 0;
  report.insights = Array.isArray(result.insights) ? result.insights.length : 0;
  report.recommendations = Array.isArray(result.recommendations)
    ? result.recommendations.length
    : 0;
  report.providerTrace = trace;

  // Same bar the real probe uses: the production validator accepted it and no
  // fallback was substituted.
  report.CPU_MODEL_PROBE_OK =
    report.gpuStatus === "completed" &&
    report.isFallback === false &&
    report.localFallbackInTrace === false &&
    report.attentionCurvePoints === 10 &&
    report.insights === 3 &&
    report.recommendations === 3;
} catch (error) {
  report.error = String(error && error.message ? error.message : error).slice(
    0,
    300,
  );
}

console.log(JSON.stringify(report, null, 2));
process.exit(report.CPU_MODEL_PROBE_OK ? 0 : 1);
