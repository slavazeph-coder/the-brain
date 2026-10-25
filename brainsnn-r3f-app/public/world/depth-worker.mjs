// Instantiated only after the user approves downloading the model/runtime.
// Inference happens on this device. This worker never sends source pixels remotely.
export const MODEL = Object.freeze({
  id: 'onnx-community/depth-anything-v2-small',
  revision: '4472b7362082ad9968fee890ca0f1e5aca36b93d',
  runtime: '@huggingface/transformers@3.8.1',
  wasmRuntime: 'onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/plain-wasm',
  dtype: 'q8', license: 'Apache-2.0', device: 'wasm',
});

let busy = false;
self.onmessage = async ({ data }) => {
  if (data.type !== 'infer' || busy) return;
  busy = true;
  let pipelineInstance;
  try {
    const { width, height, pixels } = data;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
        width > 768 || height > 768 || !(pixels instanceof ArrayBuffer) || pixels.byteLength !== width * height * 4) {
      throw new Error('Invalid bounded image input.');
    }
    self.postMessage({ type: 'status', text: 'Loading the depth model onto this device…' });
    const { pipeline, RawImage, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    // Use the matching plain WASM build. The default JSEP/Asyncify build can
    // crash WebKit during compilation even with device:'wasm' (ORT #26827).
    const ort = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/';
    env.backends.onnx.wasm.wasmPaths = {
      mjs: ort + 'ort-wasm-simd-threaded.mjs',
      wasm: ort + 'ort-wasm-simd-threaded.wasm',
    };
    pipelineInstance = await pipeline('depth-estimation', MODEL.id, {
      revision: MODEL.revision, device: MODEL.device, dtype: MODEL.dtype,
      progress_callback: progress => {
        if (progress.status === 'progress') self.postMessage({ type: 'status', text:
          `Downloading model: ${progress.file || 'weights'}${Number.isFinite(progress.progress) ? ` · ${Math.round(progress.progress)}%` : ''}` });
      },
    });
    self.postMessage({ type: 'status', text: 'Estimating relative depth on this device…' });
    const started = performance.now();
    const output = await pipelineInstance(new RawImage(new Uint8ClampedArray(pixels), width, height, 4));
    const tensor = output.predicted_depth;
    const dw = tensor.dims.at(-1), dh = tensor.dims.at(-2);
    if (!Number.isInteger(dw) || !Number.isInteger(dh) || dw * dh > 2_000_000 || tensor.data.length !== dw * dh) throw new Error('Invalid model depth output.');
    const depth = new Float32Array(tensor.data);
    if (!depth.every(Number.isFinite)) throw new Error('Model returned non-finite depth.');
    const inferenceMs = Math.round(performance.now() - started);
    await pipelineInstance.dispose();
    pipelineInstance = null;
    self.postMessage({ type: 'result', depth: depth.buffer, width: dw, height: dh,
      model: MODEL, inferenceMs, metricVerified: false }, [depth.buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', text: error?.message || 'Depth inference failed on this device.' });
  } finally {
    if (pipelineInstance) await pipelineInstance.dispose().catch(() => {});
    busy = false;
  }
};
