// Shared by the server and SPA so old bookmarks have one destination.
export function legacyRedirect(pathname, search = '') {
  const path = pathname.replace(/\/+$/, '') || '/';
  const query = new URLSearchParams(search);
  let target;
  if (path === '/app' || path.startsWith('/app/')) {
    query.set('tab', 'passage'); target = '/office';
  } else if (path === '/engine' || path.startsWith('/engine/')) {
    query.set('tab', 'drafts'); target = '/office';
  } else if (path === '/reconstruct' || path.startsWith('/reconstruct/')) {
    query.set('tab', 'claims'); target = '/office';
  } else if (path === '/missions') {
    target = '/arena/';
  } else if (path.startsWith('/missions/')) {
    target = `/arena/tasks/${path.slice('/missions/'.length)}`;
  } else if (path.startsWith('/m/')) {
    target = `/arena/tasks/published/${path.slice(3)}`;
  } else if (path === '/lab' && [...query.keys()].some((key) => ['grid'].includes(key))) {
    target = '/lab/powder';
  }
  if (!target) return null;
  return `${target}${query.size ? `?${query}` : ''}`;
}
