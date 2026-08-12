// The sitemap.
//
// There wasn't one, and robots.txt was two lines that named no sitemap at all.
// Five real routes existed and a crawler had to find every one of them by
// following links out of a JavaScript bundle it may not execute.
//
// The URL list is derived from ROUTE_PATHS rather than written out again here.
// That is the whole design: a hand-maintained sitemap drifts from the app the
// first time someone adds a route and forgets this file, and a sitemap listing a
// route that 404s or omitting the one you just launched is worse than none,
// because it is confidently wrong.

import { ROUTE_PATHS } from './routeMeta.js';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A sitemap for every route the server actually serves.
 *
 * Deliberately carries no `<lastmod>`, `<priority>` or `<changefreq>`. Google
 * ignores the latter two outright, and a `lastmod` set from build time would
 * claim every page changed every deploy — a signal that is false often enough to
 * be worth less than its absence.
 *
 * @param {string} origin e.g. 'https://www.brainsnn.com' (trailing slash fine)
 * @param {string[]} paths defaults to every route in routeMeta.js
 */
export function buildSitemap(origin, paths = ROUTE_PATHS) {
  const base = String(origin || '').replace(/\/$/, '');
  const urls = [...new Set(paths)]
    .map((path) => `${base}${path === '/' ? '/' : path}`)
    .map((loc) => `  <url><loc>${escapeXml(loc)}</loc></url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
