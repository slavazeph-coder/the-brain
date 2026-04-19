/**
 * /r/<hash> → server-rendered HTML with OG tags pointing at /api/og?h=<hash>.
 * Client then loads the SPA and rehydrates the reaction from the hash.
 *
 * Runs on the Vercel Node runtime (not Edge) so we can read the route segment
 * without a rewrite dance. vercel.json rewrites /r/(.*) → /api/r?h=$1.
 */

function b64urlDecode(str) {
  try {
    const pad = '='.repeat((4 - (str.length % 4)) % 4);
    const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return Buffer.from(base, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function decodeReaction(hash) {
  const json = b64urlDecode(hash);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const AFFECT_LABELS = {
  fear: 'Fear',
  outrage: 'Outrage',
  urgency: 'Urgency',
  certainty: 'Certainty theater',
  awe: 'Awe',
  belonging: 'Belonging',
  curiosity: 'Curiosity',
  neutral: 'Low-signal',
};

export default function handler(req, res) {
  const hash = (req.query && req.query.h) || '';
  const payload = decodeReaction(hash);

  const origin = `https://${req.headers.host || 'brainsnn.com'}`;
  const ogUrl = `${origin}/api/og?h=${encodeURIComponent(hash)}`;
  const pageUrl = `${origin}/r/${hash}`;

  let title = 'BrainSNN — Reaction';
  let description = 'A 3D brain reads this content for manipulation signatures in real time.';

  if (payload) {
    const affect = AFFECT_LABELS[payload.a] || 'Low-signal';
    const overall = Math.round((((payload.e || 0) + (payload.c || 0) + (payload.m || 0)) / 3) * 100);
    title = `${overall}% pressure · ${affect} — BrainSNN Reaction`;
    const snippet = (payload.t || '').slice(0, 140);
    description = snippet ? `"${snippet}${snippet.length >= 140 ? '…' : ''}" — scanned by BrainSNN.` : description;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="BrainSNN" />
<meta property="og:url" content="${escapeHtml(pageUrl)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(ogUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(ogUrl)}" />

<script>
  // Hand off to the SPA with the reaction hash so it can rehydrate + render.
  (function () {
    var hash = ${JSON.stringify(hash)};
    if (hash) {
      window.location.replace('/?r=' + encodeURIComponent(hash));
    } else {
      window.location.replace('/');
    }
  })();
</script>
<style>body{margin:0;background:#0b1224;color:#e6f1ff;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head>
<body>
<noscript><p>Open <a href="${escapeHtml(pageUrl)}" style="color:#5ad4ff">${escapeHtml(pageUrl)}</a> in a browser with JavaScript enabled.</p></noscript>
<p>Loading reaction…</p>
</body>
</html>`;

  res.status(200).send(html);
}
