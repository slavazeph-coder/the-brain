/** Bounded decoding + a cancellable module worker. No media upload is performed. */
export async function decodePhoto(file, { signal, maxEdge = 384 } = {}) {
  const url = URL.createObjectURL(file), img = new Image();
  try {
    await new Promise((resolve, reject) => {
      const abort = () => { img.src = ''; reject(new DOMException('Aborted', 'AbortError')); };
      const finish = fn => () => { signal?.removeEventListener('abort', abort); fn(); };
      img.onload = finish(resolve);
      img.onerror = finish(() => reject(new Error('This image could not be decoded. Use JPEG, PNG or WebP.')));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      img.src = url;
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (img.naturalWidth < 2 || img.naturalHeight < 2 || img.naturalWidth * img.naturalHeight > 64_000_000) throw new Error('Use an image between 2 pixels and 64 megapixels.');
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(2, Math.round(img.naturalWidth * scale)), height = Math.max(2, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(img, 0, 0, width, height);
    return { width, height, rgba: context.getImageData(0, 0, width, height).data };
  } finally { URL.revokeObjectURL(url); }
}

export function inferDepth(photo, { signal, onStatus = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./depth-worker.mjs', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); fn(value);
    };
    const abort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error('Depth preview timed out after 5 minutes. Try a desktop browser or a processing worker.')), 300_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') onStatus(data.text);
      if (data.type === 'error') finish(reject, new Error(data.text));
      if (data.type === 'result') finish(resolve, { ...data, depth: new Float32Array(data.depth) });
    };
    worker.onerror = () => finish(reject, new Error('The depth engine could not start. Check network access and browser support.'));
    const pixels = photo.rgba.slice().buffer;
    worker.postMessage({ type: 'infer', pixels, width: photo.width, height: photo.height }, [pixels]);
  });
}
