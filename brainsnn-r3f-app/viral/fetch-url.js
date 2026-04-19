/**
 * /api/fetch-url?u=<url> → { text, title, source, url }
 * Lightweight reader for the Cognitive Firewall. HTML strip, 8KB cap.
 */

const MAX_BYTES = 512 * 1024;
const MAX_TEXT = 8000;
const TIMEOUT_MS = 8000;

function stripHtml(html) {
  const noScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const tagless = noScripts.replace(/<[^>]+>/g, ' ');
  const decoded = tagless
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  return decoded.replace(/\s+/g, ' ').trim();
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? stripHtml(m[1]).slice(0, 200) : '';
}

function extractOgDescription(html) {
  const m = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].slice(0, 500) : '';
}

function validateUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^0\./.test(host) ||
    host === '::1'
  ) {
    return null;
  }
  return u.toString();
}

export async function handleFetchUrl(req, res) {
  const raw = (req.query && req.query.u) || '';
  const url = validateUrl(raw);
  if (!url) {
    res.status(400).json({ error: 'invalid or disallowed URL' });
    return;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BrainsnnReader/1.0; +https://brainsnn.com)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } catch (err) {
    clearTimeout(t);
    res.status(502).json({ error: `fetch failed: ${err.message || err}` });
    return;
  }
  clearTimeout(t);

  if (!upstream.ok) {
    res.status(502).json({ error: `upstream ${upstream.status}` });
    return;
  }

  const ct = upstream.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) {
    res.status(415).json({ error: `unsupported content-type: ${ct}` });
    return;
  }

  const buf = await upstream.arrayBuffer();
  const bytes = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const html = new TextDecoder('utf-8').decode(bytes);

  const title = extractTitle(html);
  const ogDesc = extractOgDescription(html);
  const text = stripHtml(html).slice(0, MAX_TEXT);

  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
  res.json({
    url,
    title,
    description: ogDesc,
    text: [title, ogDesc, text].filter(Boolean).join('\n\n').slice(0, MAX_TEXT),
    source: 'html-strip',
  });
}
