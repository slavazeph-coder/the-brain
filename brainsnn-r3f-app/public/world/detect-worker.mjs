// Instantiated only after the user approves downloading the detector/runtime.
// Inference happens on this device. This worker never sends source pixels remotely.
import { DETECTOR } from './detections.mjs';

let busy = false;
self.onmessage = async ({ data }) => {
  if (data.type !== 'infer' || busy) return;
  busy = true;
  let detector;
  try {
    const { width, height, pixels } = data;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
        width > DETECTOR.maxEdge || height > DETECTOR.maxEdge || !(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4) {
      throw new Error('Invalid bounded image input.');
    }
    self.postMessage({ type: 'status', text: 'Loading the object detector onto this device…' });
    const { pipeline, RawImage, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    // Same plain WASM build as the depth worker: the default JSEP/Asyncify build can crash WebKit (ORT #26827).
    const ort = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
    env.backends.onnx.wasm.wasmPaths = { mjs: ort + 'ort-wasm-simd-threaded.mjs', wasm: ort + 'ort-wasm-simd-threaded.wasm' };
    detector = await pipeline('object-detection', DETECTOR.id, {
      revision: DETECTOR.revision, device: DETECTOR.device, dtype: DETECTOR.dtype,
      progress_callback: progress => {
        if (progress.status === 'progress') self.postMessage({ type: 'status', text:
          `Downloading detector: ${progress.file || 'weights'}${Number.isFinite(progress.progress) ? ` · ${Math.round(progress.progress)}%` : ''}` });
      },
    });
    self.postMessage({ type: 'status', text: 'Identifying objects on this device…' });
    const started = performance.now();
    const output = await detector(new RawImage(new Uint8ClampedArray(pixels), width, height, 4), { threshold: DETECTOR.threshold, percentage: true });
    if (!Array.isArray(output) || output.length > 200) throw new Error('Invalid detector output.');
    const detections = output.map(d => ({ label: String(d?.label ?? ''), score: Number(d?.score),
      box: { xmin: Number(d?.box?.xmin), ymin: Number(d?.box?.ymin), xmax: Number(d?.box?.xmax), ymax: Number(d?.box?.ymax) } }));
    const inferenceMs = Math.round(performance.now() - started);
    await detector.dispose();
    detector = null;
    self.postMessage({ type: 'result', detections, model: DETECTOR, inferenceMs });
  } catch (error) {
    self.postMessage({ type: 'error', text: error?.message || 'Object detection failed on this device.' });
  } finally {
    if (detector) await detector.dispose().catch(() => {});
    busy = false;
  }
};
