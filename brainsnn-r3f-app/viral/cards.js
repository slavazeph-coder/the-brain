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

export function handleTimelineCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Manipulation over Time';
  let description = 'Pressure trend across a message stream, scored by the Cognitive Firewall.';

  if (payload) {
    const t = payload.ttl || 'Manipulation over time';
    const n = payload.n || 0;
    const peak = Math.round((payload.pk || 0) * 100);
    const tr = payload.tr || 'Stable';
    title = `${t} · ${tr} · peak ${peak}% — BrainSNN Timeline`;
    description = `${n} points, trend ${tr}, peak ${peak}%${payload.pd ? ` on ${payload.pd}` : ''}.`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/t/${hash}`,
    imageUrl: `${origin}/api/og?type=timeline&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?t=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleInboxCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Inbox Triage';
  let description = 'Anonymized pressure-ranked summary of a message batch.';

  if (payload) {
    const t = payload.ttl || 'Inbox triage';
    const n = payload.n || 0;
    const hi = payload.hi || 0;
    title = `${t} · ${n} messages · ${hi} high-pressure — BrainSNN Inbox`;
    description = `${hi} of ${n} messages scored above 55% pressure.`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/n/${hash}`,
    imageUrl: `${origin}/api/og?type=inbox&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?n=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleDiffCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Diff';
  let description = 'Two texts compared for manipulation pressure.';

  if (payload) {
    const ap = Math.round((payload.ap || 0) * 100);
    const bp = Math.round((payload.bp || 0) * 100);
    const winner = payload.w || (ap < bp ? 'A' : bp < ap ? 'B' : '');
    const winLabel = winner ? (winner === 'A' ? payload.al : payload.bl) : 'tied';
    title = `${payload.al || 'A'} ${ap}% vs ${payload.bl || 'B'} ${bp}% — BrainSNN Diff`;
    description = `Cleaner: ${winLabel}. Δ${Math.abs(ap - bp)} pts between the two.`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/v/${hash}`,
    imageUrl: `${origin}/api/og?type=diff&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?v=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleRecapCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Weekly Recap';
  let description = 'A weekly roll-up of immunity + streak + scans, rendered from local state.';

  if (payload) {
    const handle = payload.n || 'anon';
    const s = payload.s || 0;
    const d = payload.d || 0;
    title = `${handle} · Immunity ${s} (${d >= 0 ? '+' : ''}${d}) — BrainSNN Weekly`;
    description = `${handle}'s week: immunity ${s}/100 (${d >= 0 ? '+' : ''}${d} pts), streak ${payload.st || 0}, ${payload.sc || 0} scans.`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/w/${hash}`,
    imageUrl: `${origin}/api/og?type=recap&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?w=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleCounterDraftCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Counter-Draft';
  let description = 'Same information, manipulation signatures stripped.';

  if (payload) {
    const bp = Math.round((payload.bp || 0) * 100);
    const ap = Math.round((payload.ap || 0) * 100);
    title = `Neutralized ${bp}% → ${ap}% — BrainSNN Counter-Draft`;
    const snippet = (payload.a || '').slice(0, 140);
    description = snippet
      ? `Pressure ${bp}% → ${ap}%. Rewrite: "${snippet}${snippet.length >= 140 ? '…' : ''}"`
      : description;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/x/${hash}`,
    imageUrl: `${origin}/api/og?type=counter&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?x=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleDailyCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Daily Firewall Challenge';
  let description = 'Three items every UTC day. Same three for everyone. Streak keeps going as long as you play.';

  if (payload) {
    const handle = payload.n || 'anon';
    const date = payload.d || '';
    const acc = payload.a || 0;
    const correct = payload.k || 0;
    const streak = payload.st || 0;
    title = `${handle} · Daily ${date} · ${correct}/3 (${acc}%)`;
    description = `${correct}/3 correct — ${acc}% accuracy. ${streak}-day streak. Same 3 items everyone else got today.`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/d/${hash}`,
    imageUrl: `${origin}/api/og?type=daily&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?d=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}

export function handleAutopsyCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Chat Autopsy';
  let description = 'Per-speaker cognitive profile of a transcript, scored by the Cognitive Firewall.';

  if (payload) {
    const t = payload.ttl || 'Chat autopsy';
    const pct = Math.round(((payload.p || 0) * 100));
    const turns = payload.t || 0;
    const top = (payload.s || [])[0];
    const lead = top ? `${top.n} leading at ${Math.round((top.p || 0) * 100)}% pressure` : 'steady overall';
    title = `${t} · ${pct}% overall — BrainSNN Autopsy`;
    description = `${turns} turns · ${(payload.s || []).length} speakers. ${lead}. Paste yours at brainsnn.com.`;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/a/${hash}`,
    imageUrl: `${origin}/api/og?type=autopsy&h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?a=${encodeURIComponent(hash)}` : '/',
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
