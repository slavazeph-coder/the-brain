/**
 * /api/fetch-url?u=<url> → { text, title, source, url }
 *
 * Lightweight reader for the Cognitive Firewall. Fetches a URL, strips
 * scripts/styles/tags, collapses whitespace, and returns up to ~8k chars
 * of visible text. Deliberately dependency-free — the regex reader is
 * good enough for headlines / tweets / article snippets which is the
 * firewall's input shape anyway.
 *
 * Runs on Edge for low latency. No API keys. Not a crawler: single-page
 * fetch, 8s timeout, size-capped.
 */

export const config = { runtime: 'edge' };

const MAX_BYTES = 512 * 1024; // 512KB cap on fetched HTML
const MAX_TEXT = 8000;
const TIMEOUT_MS = 8000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}

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
  // Block obvious private targets
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

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('u') || '';
  const url = validateUrl(raw);
  if (!url) return json({ error: 'invalid or disallowed URL' }, 400);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; BrainsnnReader/1.0; +https://brainsnn.com)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } catch (err) {
    clearTimeout(t);
    return json({ error: `fetch failed: ${err.message || err}` }, 502);
  }
  clearTimeout(t);

  if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);

  const ct = res.headers.get('content-type') || '';
  if (!/text\/html|application\/xhtml|text\/plain/.test(ct)) {
    return json({ error: `unsupported content-type: ${ct}` }, 415);
  }

  const buf = await res.arrayBuffer();
  const bytes = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
  const html = new TextDecoder('utf-8').decode(bytes);

  const title = extractTitle(html);
  const ogDesc = extractOgDescription(html);
  const text = stripHtml(html).slice(0, MAX_TEXT);

  return json({
    url,
    title,
    description: ogDesc,
    text: [title, ogDesc, text].filter(Boolean).join('\n\n').slice(0, MAX_TEXT),
    source: 'html-strip',
  });
}
