/**
 * Layer 101 — Deep-link capture entrypoints
 *
 * Three URL contracts so external surfaces (bookmarklet, browser
 * extension, mobile share sheet, MCP relay tool) can drop content
 * straight into the Episodic Cortex without opening a panel:
 *
 *   ?capture=<text>           — raw text
 *   ?capture-url=<url>        — fetch + capture as an artifact
 *   ?capture-title=<title>    — optional title override (combine
 *                               with either of the above)
 *
 * After a successful capture the params are stripped from the URL
 * so reloads don't double-add the same note.
 */

import { addCapture } from './episodicMemory';

export const DEEP_LINK_KEYS = ['capture', 'capture-url', 'capture-title'];

export function consumeDeepLinkCapture() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const text = params.get('capture');
  const url = params.get('capture-url');
  const title = params.get('capture-title') || undefined;

  if (!text && !url) return null;

  let capture = null;
  if (text) {
    capture = addCapture(text, { title, source: 'deeplink' });
  } else if (url) {
    // Fetching arbitrary cross-origin URLs from the browser is unreliable
    // (CORS), so the conservative move is to capture the URL as an artifact
    // with whatever title the caller provided. Tools that can pre-extract
    // the article text should pass it via `capture` instead.
    const text = title ? `${title}\n\n${url}` : url;
    capture = addCapture(text, { title: title || url, source: 'deeplink-url' });
  }

  // Clean up the URL so reloads don't re-trigger.
  cleanUrl(params);
  return capture;
}

function cleanUrl(params) {
  for (const k of DEEP_LINK_KEYS) params.delete(k);
  const search = params.toString();
  const next = window.location.pathname + (search ? `?${search}` : '') + window.location.hash;
  try { window.history.replaceState(null, '', next); } catch { /* ignore */ }
}

/**
 * Bookmarklet source — drag this string into the bookmarks bar.
 * Selecting any text on any page and clicking the bookmarklet opens
 * BrainSNN with the selection / page title pre-captured.
 *
 * Mirrors Layer 49's "Scan Anywhere" pattern — separate keys so the
 * two surfaces don't collide.
 */
export function bookmarkletSource(origin = '') {
  const root = origin || (typeof window !== 'undefined' ? window.location.origin : 'https://brainsnn.com');
  const code = `(function(){var s=window.getSelection&&window.getSelection().toString();var t=s||document.title;var u=location.href;var url='${root}/?capture='+encodeURIComponent(t)+'&capture-url='+encodeURIComponent(u)+'&capture-title='+encodeURIComponent(document.title.slice(0,80));window.open(url,'_blank','noopener');})();`;
  return `javascript:${code}`;
}
