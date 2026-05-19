/**
 * swUpdate — service-worker lifecycle observer.
 *
 * Surfaces three states to the UI:
 *   - 'pending'   a new SW is downloading
 *   - 'waiting'   a new SW is installed but the user is still on the
 *                  old shell; reload to activate
 *   - 'active'    SW is up-to-date
 *
 * The Beast PR #11 service worker calls skipWaiting() during install,
 * which means a new SW takes over IMMEDIATELY on first idle tab close.
 * That's fine for fresh visits, but a tab the user has open during a
 * deploy will hold the OLD shell loaded and may 404 against the NEW
 * chunks. This observer detects the window and lets the UI offer a
 * "new version available — reload" action so the user can rehydrate
 * intentionally instead of mid-task.
 */

const _subs = new Set();
let _state = { status: 'unknown' };
let _registration = null;
let _started = false;

function broadcast(patch) {
  _state = { ..._state, ...patch };
  for (const cb of _subs) {
    try { cb(_state); } catch { /* noop */ }
  }
}

function track(reg) {
  _registration = reg;
  // True once we've actually observed an update transition. Guards
  // against `controllerchange` firing on first-time install (no prior
  // controller → a fresh user would otherwise see "new version
  // ready" before they've done anything).
  let sawUpdate = false;

  // Already waiting on page load — happens when a SW updated while
  // the tab was closed.
  if (reg.waiting && navigator.serviceWorker.controller) {
    broadcast({ status: 'waiting' });
  } else if (reg.active) {
    broadcast({ status: 'active' });
  }

  // Active SW slot changed (most commonly the new worker took over).
  reg.addEventListener('updatefound', () => {
    const installing = reg.installing;
    if (!installing) return;
    // Only flag this as an actual update if there was already a
    // controller before — otherwise this is the first-install path
    // and the user doesn't need a reload prompt.
    if (navigator.serviceWorker.controller) sawUpdate = true;
    broadcast({ status: 'pending' });
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed') {
        // If there's already an active controller, this new worker is
        // waiting. If not, it's a first-install and goes straight to
        // active — no need to nudge the user.
        if (navigator.serviceWorker.controller) {
          sawUpdate = true;
          broadcast({ status: 'waiting' });
        } else {
          broadcast({ status: 'active' });
        }
      } else if (installing.state === 'activated') {
        broadcast({ status: 'active' });
      } else if (installing.state === 'redundant') {
        broadcast({ status: 'active' });
      }
    });
  });

  // Worker took over — reload anything stale at the next nav.
  // controllerchange ALSO fires on the very first SW install (no
  // previous controller → a fresh controller). Gate the 'waiting'
  // emit so we only surface the reload banner when an actual update
  // has been observed (sawUpdate) OR a worker is currently waiting.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const reallyWaiting = sawUpdate || !!_registration?.waiting;
      if (reallyWaiting) {
        broadcast({ status: 'waiting' });
      }
    });
  }
}

export function startSwUpdateWatch() {
  if (_started) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  _started = true;
  navigator.serviceWorker.ready
    .then((reg) => track(reg))
    .catch(() => { /* noop */ });

  // Periodically check for updates. Browsers do this on focus + page
  // load anyway, but a 30-minute heartbeat catches long-running tabs.
  setInterval(() => {
    if (_registration && document.visibilityState === 'visible') {
      _registration.update().catch(() => { /* noop */ });
    }
  }, 30 * 60 * 1000);
}

export function subscribeSwUpdate(cb) {
  _subs.add(cb);
  cb(_state);
  return () => _subs.delete(cb);
}

export function getSwUpdateState() {
  return { ..._state };
}

/**
 * Tell the waiting worker to take over immediately, then reload so
 * we boot against the new chunks.
 */
export async function activateNewSw() {
  if (!_registration?.waiting) {
    // No waiting worker — just reload (might be a stuck state).
    window.location.reload();
    return;
  }
  // sw.js listens for { type: 'skipWaiting' } and calls
  // self.skipWaiting() in response.
  _registration.waiting.postMessage({ type: 'skipWaiting' });
  // Wait one tick for controllerchange → reload. If skipWaiting
  // doesn't fire (browser bug), fall back after 500 ms.
  setTimeout(() => window.location.reload(), 500);
}
