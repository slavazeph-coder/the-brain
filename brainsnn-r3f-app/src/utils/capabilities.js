/**
 * capabilities — runtime feature detection for the Beast stack.
 *
 * Reports which performance + offline features are actually available
 * in the current browser. Surfaces in the Privacy Budget panel and
 * gates opt-in flags (?engine=webgpu, etc.) so we don't try to use
 * something the browser can't deliver.
 *
 * All probes are cheap and synchronous — except WebGPU which requires
 * an async adapter request. That one is cached after first await.
 */

let _webgpuPromise = null;

export function hasBroadcastChannel() {
  return typeof BroadcastChannel !== 'undefined';
}

export function hasWebLocks() {
  return typeof navigator !== 'undefined'
    && !!navigator.locks
    && typeof navigator.locks.request === 'function';
}

export function hasBackgroundSync() {
  return typeof window !== 'undefined'
    && 'SyncManager' in window;
}

export function hasOffscreenCanvas() {
  return typeof OffscreenCanvas !== 'undefined';
}

export function hasFileSystemAccess() {
  return typeof window !== 'undefined'
    && typeof window.showSaveFilePicker === 'function';
}

export function hasWorker() {
  return typeof Worker !== 'undefined';
}

export function hasIndexedDB() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; }
  catch { return false; }
}

export function cores() {
  if (typeof navigator === 'undefined') return 1;
  return navigator.hardwareConcurrency || 2;
}

/**
 * WebGPU is async because it requires requestAdapter(). Returns a
 * stable cached Promise<boolean>; safe to call repeatedly.
 */
export function hasWebGPU() {
  if (_webgpuPromise) return _webgpuPromise;
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    _webgpuPromise = Promise.resolve(false);
    return _webgpuPromise;
  }
  _webgpuPromise = (async () => {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      return !!adapter;
    } catch { return false; }
  })();
  return _webgpuPromise;
}

/**
 * Snapshot of every probe except hasWebGPU (which is async). Returns
 * a flat object ready for JSON rendering in the Privacy Budget /
 * Theme settings panel.
 */
export function capabilitySnapshot() {
  return {
    cores: cores(),
    worker: hasWorker(),
    indexedDB: hasIndexedDB(),
    broadcastChannel: hasBroadcastChannel(),
    webLocks: hasWebLocks(),
    backgroundSync: hasBackgroundSync(),
    offscreenCanvas: hasOffscreenCanvas(),
    fileSystemAccess: hasFileSystemAccess()
  };
}
