/**
 * /r/:hash and /i/:hash HTML shells. Server-rendered so social crawlers
 * see the OG + Twitter meta tags before the SPA loads, then the browser
 * is redirected into the app with the hash as a query param.
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

function decodeHash(hash) {
  const json = b64urlDecode(hash);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const AFFECT = {
  fear: 'Fear', outrage: 'Outrage', urgency: 'Urgency',
  certainty: 'Certainty theater', awe: 'Awe', belonging: 'Belonging',
  curiosity: 'Curiosity', neutral: 'Low-signal',
};

function levelLabel(score) {
  if (score >= 85) return 'Fortified';
  if (score >= 70) return 'Resilient';
  if (score >= 55) return 'Steady';
  if (score >= 35) return 'Exposed';
  return 'At risk';
}

function htmlShell({ title, description, ogUrl, imageUrl, redirectTo }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="BrainSNN" />
<meta property="og:url" content="${esc(ogUrl)}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(imageUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(imageUrl)}" />

<script>
  (function () { window.location.replace(${JSON.stringify(redirectTo)}); })();
</script>
<style>body{margin:0;background:#0b1224;color:#e6f1ff;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head>
<body>
<noscript><p>Open <a href="${esc(ogUrl)}" style="color:#5ad4ff">${esc(ogUrl)}</a> in a browser with JavaScript enabled.</p></noscript>
<p>Loading…</p>
</body>
</html>`;
}

function originFrom(req) {
  const host = req.headers.host || 'brainsnn.com';
  const proto = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export function handleReactionCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Reaction';
  let description = 'A 3D brain reads this content for manipulation signatures in real time.';

  if (payload) {
    const affect = AFFECT[payload.a] || 'Low-signal';
    const overall = Math.round((((payload.e || 0) + (payload.c || 0) + (payload.m || 0)) / 3) * 100);
    title = `${overall}% pressure · ${affect} — BrainSNN Reaction`;
    const snippet = (payload.t || '').slice(0, 140);
    description = snippet ? `"${snippet}${snippet.length >= 140 ? '…' : ''}" — scanned by BrainSNN.` : description;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/r/${hash}`,
    imageUrl: `${origin}/api/og?h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?r=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleQuizCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Spot the Manipulation';
  let description = 'A 10-item quiz that grades how well you spot manipulation without a scanner.';

  if (payload) {
    const handle = payload.n || 'anon';
    const accuracy = payload.a || 0;
    const correct = payload.k || 0;
    const total = payload.t || 10;
    title = `${handle} spotted ${correct}/${total} · ${accuracy}% — BrainSNN Quiz`;
    description = `I got ${accuracy}% on Spot the Manipulation (${correct}/${total} within 20 points of the Firewall). Can you beat it?`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/q/${hash}`,
    imageUrl: `${origin}/api/og?type=quiz&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?q=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleImmunityCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

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

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/i/${hash}`,
    imageUrl: `${origin}/api/og?type=immunity&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?i=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
