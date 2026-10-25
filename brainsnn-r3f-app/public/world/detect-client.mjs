/** Cancellable on-device detection plus the lossless frame it ran on. No media upload is performed. */

/** The exact pixels the detector sees, as PNG bytes, so the reviewed frame and its hash match the detector input. */
export async function framePng(photo) {
  const canvas = document.createElement('canvas'); canvas.width = photo.width; canvas.height = photo.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(photo.rgba), photo.width, photo.height), 0, 0);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('This browser could not encode the frame.')), 'image/png'));
  return blob.arrayBuffer();
}

export function detectObjects(photo, { signal, onStatus = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./detect-worker.mjs', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate(); fn(value);
    };
    const abort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error('Object detection timed out after 5 minutes. Try a desktop browser or a processing worker.')), 300_000);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') onStatus(data.text);
      if (data.type === 'error') finish(reject, new Error(data.text));
      if (data.type === 'result') finish(resolve, data);
    };
    worker.onerror = () => finish(reject, new Error('The object detector could not start. Check network access and browser support.'));
    const pixels = photo.rgba.slice().buffer;
    worker.postMessage({ type: 'infer', pixels, width: photo.width, height: photo.height }, [pixels]);
  });
}
