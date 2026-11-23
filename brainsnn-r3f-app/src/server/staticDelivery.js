import compression from 'compression';

/**
 * How the site's files travel. Pages, scripts, styles and JSON were sent uncompressed (app.mjs alone is
 * 137 KB raw), and Vite's content-hashed assets were revalidated on every visit.
 */

// Compress GET/HEAD responses outside /api. Processing uploads and downloads stream through the API with
// exact lengths, and API answers are small, so those keep their current behaviour.
export function shouldCompress(req, res) {
  if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/')) return false;
  return compression.filter(req, res);
}

export function createCompression() {
  return compression({ threshold: 1024, filter: shouldCompress });
}

// Vite names built assets name-HASH.ext, so a changed file always has a new name: cache those for a year.
// Everything else (World pages and modules, the service worker, index.html) keeps revalidating so a
// deploy is seen at once.
const HASHED_ASSET = /[\\/]assets[\\/][^\\/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2?|png|jpe?g|svg|webp|wasm)$/;

export function setStaticCacheHeaders(res, filePath) {
  if (HASHED_ASSET.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
}
