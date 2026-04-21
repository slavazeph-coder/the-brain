/**
 * Layer 58 — Image OCR Firewall
 *
 * Lazy-loads Tesseract.js from a CDN on first use so the initial
 * bundle stays lean. Accepts either a File/Blob or a Data URL,
 * returns the OCRed text.
 */

const CDN = 'https://esm.sh/tesseract.js@5.1.1';

let _loader = null;
let _worker = null;

async function loadTesseract() {
  if (_loader) return _loader;
  _loader = (async () => {
    const mod = await import(/* @vite-ignore */ CDN);
    return mod.default || mod;
  })();
  return _loader;
}

async function ensureWorker(onProgress) {
  if (_worker) return _worker;
  const Tesseract = await loadTesseract();
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: (m) => {
      if (!onProgress) return;
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress(m.progress);
      }
    },
  });
  _worker = worker;
  return worker;
}

export async function ocrImage(source, { onProgress } = {}) {
  const worker = await ensureWorker(onProgress);
  const result = await worker.recognize(source);
  return {
    text: (result?.data?.text || '').trim(),
    confidence: result?.data?.confidence || 0,
  };
}

/**
 * Extract an image from a ClipboardEvent (paste) if one is present.
 * Returns a Blob or null.
 */
export function imageFromClipboard(e) {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Release the worker — useful on component unmount for long sessions.
 */
export async function disposeOcr() {
  try { if (_worker) await _worker.terminate(); } catch { /* noop */ }
  _worker = null;
  _loader = null;
}

export function isOcrWarm() {
  return _worker !== null;
}
