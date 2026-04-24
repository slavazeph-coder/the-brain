/**
 * Layer 91 — PWA runtime
 *
 * Registers the service worker + captures the `beforeinstallprompt`
 * event so the Install panel can trigger it on demand.
 */

let deferredPrompt = null;
const listeners = new Set();

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  // Defer registration to idle time so we don't compete with the SPA boot
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('[pwa] sw register failed', err?.message || err));
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
  });
}

function emit() {
  for (const cb of listeners) try { cb(getInstallState()); } catch { /* noop */ }
}

export function subscribeInstall(cb) {
  listeners.add(cb);
  cb(getInstallState());
  return () => listeners.delete(cb);
}

export function getInstallState() {
  const isStandalone = typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true);
  return {
    hasPrompt: !!deferredPrompt,
    isStandalone,
    hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  };
}

export async function triggerInstall() {
  if (!deferredPrompt) return { ok: false, reason: 'no prompt available' };
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  emit();
  return { ok: true, outcome: choice?.outcome || 'unknown' };
}
