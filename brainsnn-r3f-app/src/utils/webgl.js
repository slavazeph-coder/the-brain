/**
 * WebGL availability probe.
 *
 * R3F's <Canvas> throws (and lands in the nearest error boundary with a
 * generic message) when the browser can't create a WebGL context — old
 * hardware, software-rendering blocklists, headless browsers, or GPU
 * acceleration disabled. Probing up front lets the app swap in a helpful
 * message instead while every non-3D panel keeps working.
 */
let cached = null;

export function isWebGLAvailable() {
  if (cached !== null) return cached;
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false; // non-browser environment — don't cache, it may hydrate later
  }
  try {
    const canvas = document.createElement('canvas');
    cached = Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl')),
    );
  } catch {
    cached = false;
  }
  return cached;
}
