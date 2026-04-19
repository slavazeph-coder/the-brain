/**
 * /i/<hash> → HTML shell with OG + Twitter meta for a personal Immunity
 * share card. Handoff to the SPA via ?i=<hash> after the crawler has
 * what it needs.
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

function decodeImmunity(hash) {
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

function levelLabel(score) {
  if (score >= 85) return 'Fortified';
  if (score >= 70) return 'Resilient';
  if (score >= 55) return 'Steady';
  if (score >= 35) return 'Exposed';
  return 'At risk';
}

export default function handler(req, res) {
  const hash = (req.query && req.query.h) || '';
  const payload = decodeImmunity(hash);

  const origin = `https://${req.headers.host || 'brainsnn.com'}`;
  const ogUrl = `${origin}/api/og?type=immunity&h=${encodeURIComponent(hash)}`;
  const pageUrl = `${origin}/i/${hash}`;

  let title = 'BrainSNN — Cognitive Immunity Score';
  let description = 'My resilience against manipulation, tracked by BrainSNN.';

  if (payload) {
    const handle = payload.n || 'anon';
    const score = payload.s || 0;
    const streak = payload.st || 0;
    const lvl = levelLabel(score);
    title = `${handle} · Immunity ${score} · ${lvl}${payload.rk ? ` · rank ${payload.rk}` : ''}`;
    description = `Cognitive Immunity ${score}/100 — ${lvl}. ${streak}-day streak. Scan yours at brainsnn.com.`;
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
  (function () {
    var hash = ${JSON.stringify(hash)};
    if (hash) {
      window.location.replace('/?i=' + encodeURIComponent(hash));
    } else {
      window.location.replace('/');
    }
  })();
</script>
<style>body{margin:0;background:#0b1224;color:#e6f1ff;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head>
<body>
<noscript><p>Open <a href="${escapeHtml(pageUrl)}" style="color:#5ad4ff">${escapeHtml(pageUrl)}</a> in a browser with JavaScript enabled.</p></noscript>
<p>Loading immunity card…</p>
</body>
</html>`;

  res.status(200).send(html);
}
