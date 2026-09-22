'use strict';
// The public robot campaign belongs to XIO. Keep the shared APIs, owner UI,
// immutable model assets and separate GT3 routes intact. This middleware is
// installed by the real Express preload, not the archived standalone fixtures.
const XIO = 'https://www.xioai.ca/robot-sponsorship/';
const PLACEMENTS = new Set(['chest','back','shoulders','arm','thigh','shin','qr','naming']);
function retirementDestination(raw) {
  let url, pathname;
  try { url = new URL(raw, 'http://localhost'); pathname = decodeURIComponent(url.pathname); } catch { return null; }
  if (['/sponsor','/sponsor/','/sponsor/index.html'].includes(pathname)) {
    const p = url.searchParams.getAll('placement');
    return XIO + (p.length === 1 && PLACEMENTS.has(p[0]) ? '?placement=' + p[0] : '');
  }
  if (['/sponsor/checkout','/sponsor/checkout/','/sponsor/checkout.html'].includes(pathname)) {
    const p = url.searchParams.getAll('payment');
    return XIO + 'checkout/' + (p.length === 1 && ['returned','cancelled'].includes(p[0]) ? '?payment=' + p[0] : '');
  }
  if (['/sponsor/privacy','/sponsor/privacy/','/sponsor/privacy.html'].includes(pathname)) return XIO + 'privacy.html';
  return null;
}
function retirePublicPage(req, res, next) {
  if (!['GET','HEAD'].includes(req.method)) return next();
  const destination = retirementDestination(req.url);
  if (!destination) return next();
  // Location has no fragment: browsers retain legacy client-only #token links.
  // Never copy arbitrary query data, invitation tokens or redirect targets.
  res.writeHead(308, {Location:destination,'Cache-Control':'no-store','Content-Length':'0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  res.end();
}
module.exports = {retirementDestination, retirePublicPage};
