/**
 * Layer 103 share cards — Social Post Autopsy.
 *
 * Dedicated card shell + PNG renderer for /s/<hash> and /api/social-og.
 * Kept separate from viral/og.js so the Social Post layer can iterate without
 * destabilizing the older reaction/immunity/quiz card renderer.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const INTER_REGULAR = readFileSync(
  join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-400-normal.woff')
);
const INTER_SEMI = readFileSync(
  join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-600-normal.woff')
);
const INTER_BOLD = readFileSync(
  join(__dirname, '..', 'node_modules', '@fontsource', 'inter', 'files', 'inter-latin-800-normal.woff')
);

const FONTS = [
  { name: 'Inter', data: INTER_REGULAR, weight: 400, style: 'normal' },
  { name: 'Inter', data: INTER_SEMI, weight: 600, style: 'normal' },
  { name: 'Inter', data: INTER_BOLD, weight: 800, style: 'normal' },
];

function b64urlDecode(str = '') {
  try {
    const pad = '='.repeat((4 - (str.length % 4)) % 4);
    const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
    return Buffer.from(base, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

function decodeHash(hash = '') {
  try {
    const json = b64urlDecode(hash);
    return json ? JSON.parse(json) : null;
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

function clamp(v, min = 0, max = 1) { return Math.max(min, Math.min(max, v)); }
function pct(v) { return Math.round(clamp(v) * 100); }
function safeText(s, max = 160) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function toneFor(p) {
  if (p >= 0.72) return { label: 'High-pressure viral frame', short: 'High pressure', color: '#dd6974' };
  if (p >= 0.45) return { label: 'Attention-engineered', short: 'Engineered', color: '#fdab43' };
  if (p >= 0.22) return { label: 'Mild influence pattern', short: 'Mild influence', color: '#d7c54f' };
  return { label: 'Low-pressure post', short: 'Low pressure', color: '#6daa45' };
}

function originFrom(req) {
  const host = req.headers.host || 'brainsnn.com';
  const isLocal = host.includes('localhost') || host.startsWith('127.') || host.includes(':8099') || host.includes(':8080') || host.includes(':4173') || host.includes(':5173');
  const proto = req.headers['x-forwarded-proto'] || (isLocal ? 'http' : 'https');
  return `${proto}://${host}`;
}

function bar(label, value, color) {
  const p = clamp(value);
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', gap: 5, width: '100%' },
      children: [
        { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', fontSize: 18, color: '#cbd5e1', fontWeight: 600 }, children: [
          { type: 'span', props: { children: label } },
          { type: 'span', props: { style: { color }, children: `${pct(p)}%` } },
        ] } },
        { type: 'div', props: { style: { display: 'flex', width: '100%', height: 10, background: '#1a1f2e', borderRadius: 999 }, children: [
          { type: 'div', props: { style: { width: `${pct(p)}%`, height: '100%', background: color, borderRadius: 999 } } },
        ] } },
      ],
    },
  };
}

function chip(label, color = '#5ad4ff') {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        padding: '7px 12px',
        borderRadius: 999,
        background: `${color}18`,
        border: `1px solid ${color}55`,
        color,
        fontSize: 18,
        fontWeight: 700,
      },
      children: label,
    },
  };
}

function socialNode(payload = {}) {
  const pressure = clamp(payload.p || 0);
  const tone = toneFor(pressure);
  const platform = payload.pl || 'Social post';
  const handle = payload.hd || '';
  const install = safeText(payload.vi || 'This post was scanned for affect, viral mechanics, and pressure.', 170);
  const affect = payload.af || 'Attention';
  const mechanics = Array.isArray(payload.vm) ? payload.vm.slice(0, 4) : [];
  const slides = Array.isArray(payload.sl) ? payload.sl.slice(0, 5) : [];
  const caption = safeText(payload.tx || '', 190);

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(135deg, #0b1224 0%, ${tone.color}22 100%)`,
        color: '#e6f1ff',
        padding: 52,
        fontFamily: 'Inter',
      },
      children: [
        { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }, children: [
          { type: 'div', props: { style: { fontSize: 22, letterSpacing: 6, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 800 }, children: 'BrainSNN · Social Post Autopsy' } },
          { type: 'div', props: { style: { padding: '8px 18px', borderRadius: 999, background: tone.color, color: '#0b1224', fontSize: 22, fontWeight: 800 }, children: tone.short } },
        ] } },

        { type: 'div', props: { style: { display: 'flex', flex: 1, gap: 38 }, children: [
          { type: 'div', props: { style: { display: 'flex', flex: 1.1, flexDirection: 'column', justifyContent: 'center', gap: 20 }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [
              { type: 'div', props: { style: { fontSize: 24, color: '#94a3b8', fontWeight: 700 }, children: `${platform}${handle ? ` · ${handle}` : ''}` } },
              { type: 'div', props: { style: { fontSize: 48, fontWeight: 800, color: '#f1ece5', lineHeight: 1.05 }, children: tone.label } },
            ] } },
            { type: 'div', props: { style: { display: 'flex', borderLeft: `4px solid ${tone.color}`, paddingLeft: 20, fontSize: 25, lineHeight: 1.35, color: '#f1ece5' }, children: install } },
            caption ? { type: 'div', props: { style: { display: 'flex', padding: 16, borderRadius: 10, background: 'rgba(255,255,255,0.035)', color: '#cbd5e1', fontSize: 20, lineHeight: 1.35 }, children: `“${caption}”` } } : { type: 'div', props: { children: ' ' } },
            { type: 'div', props: { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [chip(affect, tone.color), ...mechanics.map((m) => chip(String(m).slice(0, 26), '#5ad4ff'))] } },
          ] } },

          { type: 'div', props: { style: { display: 'flex', flex: 0.9, flexDirection: 'column', justifyContent: 'center', gap: 18 }, children: [
            { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: 0 }, children: [
              { type: 'div', props: { style: { fontSize: 16, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase', fontWeight: 700 }, children: 'Post pressure' } },
              { type: 'div', props: { style: { fontSize: 96, lineHeight: 0.95, fontWeight: 800, color: tone.color }, children: `${pct(pressure)}%` } },
            ] } },
            bar('Emotional activation', payload.e || pressure, '#dd6974'),
            bar('Cognitive suppression', payload.c || pressure, '#fdab43'),
            bar('Manipulation pressure', payload.m || pressure, '#a86fdf'),
            slides.length ? { type: 'div', props: { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }, children: slides.map((s, idx) => {
              const sp = clamp(s.p || 0);
              const sc = toneFor(sp).color;
              return { type: 'div', props: { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [
                { type: 'div', props: { style: { display: 'flex', width: 62, fontSize: 14, color: '#94a3b8', fontWeight: 700 }, children: `S${s.i || idx + 1}` } },
                { type: 'div', props: { style: { display: 'flex', flex: 1, height: 8, borderRadius: 999, background: '#1a1f2e' }, children: [
                  { type: 'div', props: { style: { width: `${pct(sp)}%`, height: '100%', borderRadius: 999, background: sc } } },
                ] } },
                { type: 'div', props: { style: { display: 'flex', width: 52, justifyContent: 'flex-end', color: sc, fontSize: 15, fontWeight: 800 }, children: `${pct(sp)}%` } },
              ] } };
            }) } } : { type: 'div', props: { children: ' ' } },
          ] } },
        ] } },

        { type: 'div', props: { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, fontSize: 20, color: '#94a3b8' }, children: [
          { type: 'span', props: { children: 'scan posts → brainsnn.com' } },
          { type: 'span', props: { children: 'Layer 103 · social post autopsy' } },
        ] } },
      ],
    },
  };
}

function verticalWrap(innerNode) {
  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 80,
        background: '#0b1224',
        fontFamily: 'Inter',
      },
      children: [
        { type: 'div', props: { style: { display: 'flex', fontSize: 36, letterSpacing: 10, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 800, marginBottom: 28 }, children: 'BRAINSNN' } },
        { type: 'div', props: { style: { display: 'flex', width: 920, height: 482, borderRadius: 24, overflow: 'hidden', boxShadow: '0 40px 80px rgba(0,0,0,0.5)' }, children: innerNode } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 32, color: '#cbd5e1', marginTop: 36, fontWeight: 600 }, children: 'brainsnn.com' } },
        { type: 'div', props: { style: { display: 'flex', fontSize: 22, color: '#94a3b8', marginTop: 10 }, children: 'Autopsy the post. See what feeling it installs.' } },
      ],
    },
  };
}

export async function renderSocialOg(query = {}) {
  const payload = decodeHash(query.h || '') || {};
  const size = query.size === 'vertical' ? 'vertical' : 'horizontal';
  const [w, h] = size === 'vertical' ? [1080, 1920] : [1200, 630];
  const node = socialNode(payload);
  const finalNode = size === 'vertical' ? verticalWrap(node) : node;
  const svg = await satori(finalNode, { width: w, height: h, fonts: FONTS });
  return new Resvg(svg).render().asPng();
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
<script>(function(){ window.location.replace(${JSON.stringify(redirectTo)}); })();</script>
<style>body{margin:0;background:#0b1224;color:#e6f1ff;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}</style>
</head>
<body><noscript><p>Open <a href="${esc(ogUrl)}" style="color:#5ad4ff">${esc(ogUrl)}</a> in a browser with JavaScript enabled.</p></noscript><p>Loading…</p></body>
</html>`;
}

export function handleSocialPostCard(req, res) {
  const hash = req.params.hash || '';
  const origin = originFrom(req);
  const payload = decodeHash(hash);

  let title = 'BrainSNN — Social Post Autopsy';
  let description = 'A social post scanned for affect, viral mechanics, and manipulation pressure.';
  if (payload) {
    const p = pct(payload.p || 0);
    const platform = payload.pl || 'Social post';
    const affect = payload.af || 'attention';
    title = `${p}% · ${platform} post installs ${affect} — BrainSNN`;
    description = payload.vi || description;
  }

  const html = htmlShell({
    title,
    description,
    ogUrl: `${origin}/s/${hash}`,
    imageUrl: `${origin}/api/social-og?h=${encodeURIComponent(hash)}`,
    redirectTo: hash ? `/?s=${encodeURIComponent(hash)}` : '/',
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(html);
}
