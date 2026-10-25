export function attribution(search = typeof window !== 'undefined' ? window.location.search : '') {
  try {
    const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    return params.get('s') || params.get('utm_source') || 'direct';
  } catch {
    return 'direct';
  }
}
