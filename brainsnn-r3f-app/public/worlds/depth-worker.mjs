// Created only after an explicit user action. Pixels never go to a model API.
let pipe;
self.onmessage = async ({ data }) => {
  if (data.type !== 'infer') return;
  try {
    self.postMessage({ type: 'status', text: 'Loading the local depth engine…' });
    const { pipeline, RawImage, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    if (!pipe) pipe = await pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device: 'wasm', dtype: 'q8', progress_callback: p => {
      if (p.status === 'progress') self.postMessage({ type: 'status', text: 'Downloading model: ' + (p.file || 'weights') + (Number.isFinite(p.progress) ? ' · ' + Math.round(p.progress) + '%' : '') });
    } });
    self.postMessage({ type: 'status', text: 'Estimating relative depth on this device…' });
    const input = new RawImage(new Uint8ClampedArray(data.pixels), data.width, data.height, 4);
    const result = await pipe(input);
    const tensor = result.predicted_depth;
    const dims = tensor.dims;
    const depth = new Float32Array(tensor.data);
    self.postMessage({ type: 'result', depth: depth.buffer, width: dims[dims.length - 1], height: dims[dims.length - 2] }, [depth.buffer]);
  } catch (error) { self.postMessage({ type: 'error', text: error?.message || 'Local depth inference failed. Try a smaller photo or connect a worker.' }); }
};
