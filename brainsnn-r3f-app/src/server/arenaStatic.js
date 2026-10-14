import express from 'express';
import path from 'node:path';

/** Keep the standalone arena out of the React/Vite SPA fallback.
 * Its relative scripts and worker URLs resolve under the canonical /arena/.
 * Mount this router before Vite or the production catch-all. */
export function createArenaRouter({ directory }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).type('text').send('Method not allowed.');
    }
    const [pathname, ...queryParts] = req.originalUrl.split('?');
    if (req.path === '/' && !pathname.endsWith('/')) {
      return res.redirect(308, `${pathname}/${queryParts.length ? `?${queryParts.join('?')}` : ''}`);
    }
    next();
  });
  router.use(express.static(path.resolve(directory), {
    index: 'index.html',
    redirect: false,
    fallthrough: false,
    dotfiles: 'deny',
    etag: true,
    lastModified: true,
    setHeaders(res) {
      // Filenames are stable across releases, so revalidate instead of
      // letting a cached module lag behind a newly deployed arena document.
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    },
  }));
  router.use((error, _req, res, _next) => {
    const status = [400, 403, 404, 405].includes(error.status) ? error.status : 500;
    res.status(status).type('text').send(status === 404 ? 'Arena asset not found.' : status === 500 ? 'Arena could not be loaded.' : 'Invalid arena request.');
  });
  return router;
}
