import { ROUTE_PATHS } from './routeMeta.js';

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSitemap(origin = 'https://www.brainsnn.com', paths = ROUTE_PATHS) {
  const cleanOrigin = String(origin).replace(/\/+$/, '');
  const uniquePaths = [...new Set(paths)];
  const urls = uniquePaths
    .map((path) => {
      const normalized = path.startsWith('/') ? path : `/${path}`;
      return `  <url><loc>${escapeXml(`${cleanOrigin}${normalized}`)}</loc></url>`;
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ].join('\n');
}
