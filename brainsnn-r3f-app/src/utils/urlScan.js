/**
 * urlScan — the link side of the single scan engine.
 *
 * The main scan box (ScanHero → analyzeForBrain) accepts EITHER text OR a link.
 * This module owns the two link-specific jobs:
 *   1. Deciding whether a paste IS a link to read (looksLikeUrl).
 *   2. Reading it into clean text via the server's /api/fetch-url reader
 *      (fetchUrlText) so the scorer sees the ARTICLE, not the URL string.
 *
 * Kept framework-free (no React, no DOM beyond fetch) so it's unit-testable and
 * reusable by any caller that wants link-aware scanning.
 */

// "Bare link only" policy: treat a paste as a link to fetch ONLY when the whole
// trimmed input is a single URL with no surrounding prose. A sentence that
// merely CONTAINS a link is scored as text — we never hijack the user's words.
const BARE_HTTP = /^https?:\/\/[^\s]+$/i;
const BARE_WWW = /^www\.[^\s]+\.[^\s]+$/i;

/**
 * Is this paste a bare link we should fetch-and-read?
 * Returns false for sentences-with-links, multi-line text, or non-URLs.
 */
export function looksLikeUrl(raw = "") {
  const s = String(raw).trim();
  if (!s || /\s/.test(s)) return false; // any whitespace ⇒ it's prose, not a bare link
  return BARE_HTTP.test(s) || BARE_WWW.test(s);
}

/** Normalize a bare link to a fetchable absolute https URL. */
export function normalizeUrl(raw = "") {
  const s = String(raw).trim();
  if (BARE_WWW.test(s)) return `https://${s}`;
  return s;
}

/** Turn raw reader errors into one clean, human sentence. */
function prettyError(raw, status) {
  const e = String(raw || "").toLowerCase();
  if (!raw) return `The page didn't load (HTTP ${status})`;
  if (e.includes("fetch failed") || e.includes("network"))
    return "The site couldn't be reached";
  if (e.includes("403") || e.includes("401"))
    return "The site blocked the read";
  if (e.includes("invalid or disallowed")) return "That link can't be read";
  if (e.includes("unsupported content-type"))
    return "That link isn't a readable page";
  return String(raw);
}

/** Short, human-readable origin for provenance chips ("nytimes.com"). */
export function domainOf(raw = "") {
  try {
    return new URL(normalizeUrl(raw)).hostname.replace(/^www\./, "");
  } catch {
    return (
      String(raw)
        .replace(/^https?:\/\//i, "")
        .split("/")[0] || "the link"
    );
  }
}

/**
 * Read a link into clean article text via the server reader.
 * Resolves to { ok, text, title, url, words } or { ok:false, error }.
 * Never throws — callers branch on `ok`.
 */
export async function fetchUrlText(raw = "") {
  const url = normalizeUrl(raw);
  try {
    const resp = await fetch(`/api/fetch-url?u=${encodeURIComponent(url)}`);
    let data = {};
    try {
      data = await resp.json();
    } catch {
      /* non-JSON body — fall through to the generic error below */
    }
    if (!resp.ok || data.error || !data.text) {
      return {
        ok: false,
        url,
        error: prettyError(data.error, resp.status),
      };
    }
    const text = String(data.text).trim();
    return {
      ok: true,
      url: data.url || url,
      title: data.title || "",
      text,
      words: text ? text.split(/\s+/).length : 0,
    };
  } catch (err) {
    return {
      ok: false,
      url,
      error: err?.message || "network error reaching the link",
    };
  }
}
