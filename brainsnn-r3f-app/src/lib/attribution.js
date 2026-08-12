// Where a visitor came from.
//
// The event pipeline measures everything that happens *after* someone arrives —
// 65 event names, every one of them post-arrival — and nothing about the arrival
// itself. So "did that link work" had no answer, and every traffic experiment
// was unfalsifiable: ship a tactic, watch a number that cannot attribute it, and
// guess.
//
// Two limits are deliberate, and this module exists partly to enforce them in
// one place rather than at each call site:
//
//   1. HOST ONLY. `document.referrer` is a full URL. On a search engine it
//      carries the query someone typed; on a private tool it can identify a page
//      nobody meant to disclose. Only the hostname survives this module — never
//      the path, never the query.
//
//   2. FIRST TOUCH. Captured once per session and then frozen. Someone who
//      arrives from Hacker News and clicks three internal links must not have
//      their source quietly rewritten to "direct" by the second page view, which
//      is the classic way a referral channel disappears from its own report.
//
// Same shape as routeMeta.js and eventSink.js: mostly pure functions, so the
// interesting parts are testable without a DOM.

/** One key, so Layer 86-style storage audits have one thing to find. */
export const STORAGE_KEY = 'brainsnn.attribution.v1';

/** Matches the property cap in eventSink.js — these are labels, not prose. */
const MAX_VALUE_LENGTH = 120;

const UTM_PARAMS = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign']);

/** Short on purpose: it rides along on every shared URL. See share.ts. */
export const SHARE_PARAM = 's';

/** Fields allowed out of this module. The server re-checks against this list. */
export const ATTRIBUTION_FIELDS = Object.freeze([...UTM_PARAMS, 'share', 'ref']);

function clean(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, MAX_VALUE_LENGTH);
}

/**
 * The hostname of a referrer, or '' when there is nothing worth recording.
 *
 * `www.` is stripped so google.com and www.google.com are one channel rather
 * than two half-channels that each look too small to matter.
 *
 * @param {string} referrer full referrer URL, as the browser reports it
 * @param {string} currentHost this page's hostname; a match means internal
 */
export function referrerHost(referrer, currentHost = '') {
  const raw = clean(referrer);
  if (!raw) return '';

  let host;
  try {
    ({ hostname: host } = new URL(raw));
  } catch {
    return ''; // a referrer we cannot parse is not a channel
  }

  host = host.replace(/^www\./, '');
  // An in-app navigation is not an acquisition source, and counting it as one
  // would make the site its own biggest referrer.
  if (host && host === String(currentHost).replace(/^www\./, '')) return '';
  return host;
}

/**
 * Pure form: given a query string and a referrer, what is the source?
 *
 * @returns {object} only the fields that are actually present — a direct visit
 *   yields `{}`, which is a real answer and is stored as one.
 */
export function readAttribution(search = '', referrer = '', currentHost = '') {
  const found = {};
  let params;
  try {
    params = new URLSearchParams(search);
  } catch {
    params = new URLSearchParams();
  }

  for (const key of UTM_PARAMS) {
    const value = clean(params.get(key));
    if (value) found[key] = value;
  }

  // `s=lab` is ours, set by the share buttons. Kept distinct from utm_source
  // rather than folded into it, because claiming the visitor's own campaign tag
  // said something it did not say is how attribution data starts lying.
  const share = clean(params.get(SHARE_PARAM));
  if (share) found.share = share;

  const ref = referrerHost(referrer, currentHost);
  if (ref) found.ref = ref;

  return found;
}

function sessionStore() {
  try {
    // Safari in private mode throws on *access*, not just on write.
    return window.sessionStorage || null;
  } catch {
    return null;
  }
}

/**
 * First-touch attribution for this session.
 *
 * Never throws: analytics must not be able to break the page it measures.
 */
export function attribution() {
  if (typeof window === 'undefined') return {};

  const store = sessionStore();
  if (store) {
    try {
      const saved = store.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      }
    } catch {
      // Unreadable or corrupt: recompute below rather than give up on the visit.
    }
  }

  const found = readAttribution(
    window.location?.search || '',
    typeof document === 'undefined' ? '' : document.referrer || '',
    window.location?.hostname || '',
  );

  if (store) {
    try {
      // Stored even when empty, so a direct visit stays direct instead of
      // acquiring a referrer from whatever link the visitor clicks next.
      store.setItem(STORAGE_KEY, JSON.stringify(found));
    } catch {
      // Quota or a blocked store. The event still goes out with what we found.
    }
  }

  return found;
}
