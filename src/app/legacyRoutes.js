const LEGACY_Redirects = Object.freeze({
  '/app': '/office?tab=passage',
  '/engine': '/office?tab=drafts',
  '/reconstruct': '/office?tab=claims',
  '/missions': '/arena/',
  '/arena': '/arena/',
  '/pricing': '/arena/#campaigns',
});

export function legacyRedirect(pathname = '/', search = '') {
  const raw = String(pathname || '/');
  if (raw === '/arena') {
    return `/arena/${search || ''}`;
  }
  const clean = raw.replace(/\/+$/, '') || '/';
  if (clean.startsWith('/missions/')) {
    const slug = clean.slice('/missions/'.length);
    return `/arena/tasks/${slug}${search || ''}`;
  }
  const target = LEGACY_Redirects[clean];
  if (!target) return null;
  if (target.includes('?')) {
    const [base, defaultQuery] = target.split('?');
    const existing = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    const defaults = new URLSearchParams(defaultQuery);
    for (const [k, v] of defaults.entries()) {
      if (!existing.has(k)) existing.set(k, v);
    }
    const qs = existing.toString();
    return qs ? `${base}?${qs}` : base;
  }
  return `${target}${search || ''}`;
}
