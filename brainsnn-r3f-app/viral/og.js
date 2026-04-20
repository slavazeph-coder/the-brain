/**
 * OG image generator — Node runtime. Produces 1200×630 PNG cards for
 * Reaction (/r/<hash>) and Immunity (/i/<hash>) shares.
 *
 * Pipeline: satori (HTML-like vnode → SVG) → @resvg/resvg-js (SVG → PNG).
 * @vercel/og does the same thing internally but is Edge-only, so we
 * wire the primitives directly.
 */

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Inter via @fontsource/inter — files ship with the package
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

function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(base, 'base64').toString('utf-8');
}

function decodeHash(hash) {
  try {
    return JSON.parse(b64urlDecode(hash));
  } catch {
    return null;
  }
}

function clampText(t, max = 200) {
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

const AFFECT = {
  fear: { label: 'Fear', color: '#dd6974' },
  outrage: { label: 'Outrage', color: '#e57b40' },
  urgency: { label: 'Urgency', color: '#fdab43' },
  certainty: { label: 'Certainty theater', color: '#a86fdf' },
  awe: { label: 'Awe', color: '#5591c7' },
  belonging: { label: 'Belonging', color: '#ec87b5' },
  curiosity: { label: 'Curiosity', color: '#5fb7c1' },
  neutral: { label: 'Low-signal', color: '#6daa45' },
};

function levelFor(score) {
  if (score >= 85) return { label: 'Fortified', color: '#5ee69a' };
  if (score >= 70) return { label: 'Resilient', color: '#77dbe4' };
  if (score >= 55) return { label: 'Steady', color: '#fdab43' };
  if (score >= 35) return { label: 'Exposed', color: '#e57b40' };
  return { label: 'At risk', color: '#dd6974' };
}

function quizLevelFor(score) {
  if (score >= 90) return { label: 'Firewall-grade', color: '#5ee69a' };
  if (score >= 75) return { label: 'Sharp', color: '#77dbe4' };
  if (score >= 60) return { label: 'Reasonable', color: '#fdab43' };
  if (score >= 40) return { label: 'Susceptible', color: '#e57b40' };
  return { label: 'Vulnerable', color: '#dd6974' };
}

function bar(label, value, color) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return {
    type: 'div',
    props: {
      style: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', fontSize: 18, color: '#cbd5e1', fontWeight: 500 },
            children: [
              { type: 'span', props: { children: label } },
              { type: 'span', props: { style: { color }, children: `${Math.round(pct * 100)}%` } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { width: '100%', height: 10, background: '#1a1f2e', borderRadius: 999, display: 'flex' },
            children: [
              { type: 'div', props: { style: { width: `${pct * 100}%`, height: '100%', background: color, borderRadius: 999 } } },
            ],
          },
        },
      ],
    },
  };
}

function reactionCardNode(payload) {
  const affect = payload.a || 'neutral';
  const ac = AFFECT[affect] || AFFECT.neutral;
  const overall = Math.round((((payload.e || 0) + (payload.c || 0) + (payload.m || 0)) / 3) * 100);

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #0b1224 0%, #121826 100%)',
        color: '#e6f1ff',
        padding: 56,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
            children: [
              { type: 'div', props: { style: { fontSize: 22, letterSpacing: 6, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 800 }, children: 'BrainSNN · Reaction' } },
              { type: 'div', props: { style: { padding: '8px 18px', borderRadius: 999, background: ac.color, color: '#0b1224', fontSize: 22, fontWeight: 800 }, children: ac.label } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flex: 1, gap: 48 },
            children: [
              {
                type: 'div',
                props: {
                  style: { flex: 1.3, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
                  children: [{
                    type: 'div',
                    props: {
                      style: { fontSize: 30, lineHeight: 1.35, color: '#f1ece5', borderLeft: `4px solid ${ac.color}`, paddingLeft: 24 },
                      children: `"${clampText(payload.t || '', 220)}"`,
                    },
                  }],
                },
              },
              {
                type: 'div',
                props: {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 20, justifyContent: 'center' },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginBottom: 8 },
                        children: [
                          { type: 'div', props: { style: { fontSize: 16, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase' }, children: 'Overall pressure' } },
                          { type: 'div', props: { style: { fontSize: 72, fontWeight: 800, color: ac.color, lineHeight: 1 }, children: `${overall}%` } },
                        ],
                      },
                    },
                    bar('Emotional activation', payload.e, '#dd6974'),
                    bar('Cognitive suppression', payload.c, '#fdab43'),
                    bar('Manipulation pressure', payload.m, '#a86fdf'),
                    bar('Trust erosion', payload.u, '#5591c7'),
                  ],
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, fontSize: 20, color: '#94a3b8' },
            children: [
              { type: 'span', props: { children: 'scan yours → brainsnn.com' } },
              { type: 'span', props: { children: '35 cognitive layers · browser-native' } },
            ],
          },
        },
      ],
    },
  };
}

function immunityCardNode(payload) {
  const score = payload.s || 0;
  const lvl = levelFor(score);
  const handle = payload.n || 'anon';
  const streak = payload.st || 0;
  const dims = [
    { k: 'Awareness', v: payload.a || 0 },
    { k: 'Resilience', v: payload.r || 0 },
    { k: 'Depth', v: payload.d || 0 },
    { k: 'Consistency', v: payload.c || 0 },
  ];

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(135deg, #0b1224 0%, ${lvl.color}22 100%)`,
        color: '#e6f1ff',
        padding: 56,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
            children: [
              { type: 'div', props: { style: { fontSize: 22, letterSpacing: 6, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 800 }, children: 'BrainSNN · Immunity' } },
              { type: 'div', props: { style: { padding: '8px 18px', borderRadius: 999, background: lvl.color, color: '#0b1224', fontSize: 22, fontWeight: 800 }, children: lvl.label } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flex: 1, gap: 48 },
            children: [
              {
                type: 'div',
                props: {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' },
                  children: [
                    { type: 'div', props: { style: { fontSize: 28, color: '#cbd5e1' }, children: handle } },
                    { type: 'div', props: { style: { fontSize: 180, fontWeight: 800, color: lvl.color, lineHeight: 1 }, children: `${score}` } },
                    {
                      type: 'div',
                      props: {
                        style: { fontSize: 22, color: '#94a3b8', marginTop: -4 },
                        children: `/ 100 · ${streak}-day streak${payload.rk ? ` · rank ${payload.rk}${payload.tt ? ` of ${payload.tt}` : ''}` : ''}`,
                      },
                    },
                  ],
                },
              },
              {
                type: 'div',
                props: {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' },
                  children: dims.map((d) => bar(d.k, d.v / 100, lvl.color)),
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, fontSize: 20, color: '#94a3b8' },
            children: [
              { type: 'span', props: { children: 'scan yours → brainsnn.com' } },
              { type: 'span', props: { children: 'cognitive immunity · 35 layers' } },
            ],
          },
        },
      ],
    },
  };
}

function quizCardNode(payload) {
  const accuracy = payload.a || 0;
  const lvl = quizLevelFor(accuracy);
  const handle = payload.n || 'anon';
  const correct = payload.k || 0;
  const total = payload.t || 10;
  const seconds = payload.s || 0;

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(135deg, #0b1224 0%, ${lvl.color}22 100%)`,
        color: '#e6f1ff',
        padding: 56,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
            children: [
              { type: 'div', props: { style: { fontSize: 22, letterSpacing: 6, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 800 }, children: 'BrainSNN · Spot the Manipulation' } },
              { type: 'div', props: { style: { padding: '8px 18px', borderRadius: 999, background: lvl.color, color: '#0b1224', fontSize: 22, fontWeight: 800 }, children: lvl.label } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flex: 1, gap: 48 },
            children: [
              {
                type: 'div',
                props: {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' },
                  children: [
                    { type: 'div', props: { style: { fontSize: 28, color: '#cbd5e1' }, children: handle } },
                    { type: 'div', props: { style: { fontSize: 180, fontWeight: 800, color: lvl.color, lineHeight: 1 }, children: `${accuracy}%` } },
                    { type: 'div', props: { style: { fontSize: 22, color: '#94a3b8', marginTop: -4 }, children: 'spot accuracy' } },
                  ],
                },
              },
              {
                type: 'div',
                props: {
                  style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' },
                  children: [
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', justifyContent: 'space-between', fontSize: 24, color: '#cbd5e1' },
                        children: [
                          { type: 'span', props: { children: 'Correct' } },
                          { type: 'span', props: { style: { color: lvl.color, fontWeight: 700 }, children: `${correct} / ${total}` } },
                        ],
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: { display: 'flex', justifyContent: 'space-between', fontSize: 24, color: '#cbd5e1' },
                        children: [
                          { type: 'span', props: { children: 'Time' } },
                          { type: 'span', props: { style: { fontWeight: 700 }, children: `${seconds}s` } },
                        ],
                      },
                    },
                    {
                      type: 'div',
                      props: {
                        style: {
                          display: 'flex',
                          marginTop: 20,
                          padding: 16,
                          borderRadius: 10,
                          background: 'rgba(90,212,255,0.08)',
                          border: '1px solid rgba(90,212,255,0.2)',
                        },
                        children: { type: 'div', props: { style: { fontSize: 20, color: '#cbd5e1', lineHeight: 1.4 }, children: 'Can you beat me? Take the same 10-item quiz.' } },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, fontSize: 20, color: '#94a3b8' },
            children: [
              { type: 'span', props: { children: 'try the quiz → brainsnn.com' } },
              { type: 'span', props: { children: 'cognitive firewall · 35 layers' } },
            ],
          },
        },
      ],
    },
  };
}

function autopsyLevelFor(pressure) {
  if (pressure >= 0.65) return { label: 'Hostile', color: '#dd6974' };
  if (pressure >= 0.45) return { label: 'Heavy', color: '#e57b40' };
  if (pressure >= 0.28) return { label: 'Tilted', color: '#fdab43' };
  return { label: 'Steady', color: '#6daa45' };
}

function autopsyCardNode(payload) {
  const pressure = payload.p || 0;
  const lvl = autopsyLevelFor(pressure);
  const title = (payload.ttl || 'Chat autopsy').slice(0, 48);
  const turns = payload.t || 0;
  const speakers = (payload.s || []).slice(0, 5);

  return {
    type: 'div',
    props: {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: `linear-gradient(135deg, #0b1224 0%, ${lvl.color}22 100%)`,
        color: '#e6f1ff',
        padding: 52,
        fontFamily: 'Inter',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
            children: [
              { type: 'div', props: { style: { fontSize: 22, letterSpacing: 6, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 800 }, children: 'BrainSNN · Autopsy' } },
              { type: 'div', props: { style: { padding: '8px 18px', borderRadius: 999, background: lvl.color, color: '#0b1224', fontSize: 22, fontWeight: 800 }, children: lvl.label } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', marginBottom: 14 },
            children: [
              { type: 'div', props: { style: { fontSize: 36, fontWeight: 800, color: '#f1ece5', lineHeight: 1.1 }, children: title } },
              { type: 'div', props: { style: { display: 'flex', gap: 18, marginTop: 6, fontSize: 18, color: '#94a3b8' }, children: [
                { type: 'span', props: { children: `${turns} turns` } },
                { type: 'span', props: { children: `${speakers.length} speakers` } },
                { type: 'span', props: { style: { color: lvl.color, fontWeight: 700 }, children: `overall ${Math.round(pressure * 100)}%` } },
              ] } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', flexDirection: 'column', flex: 1, gap: 8 },
            children: speakers.map((s) => {
              const slvl = autopsyLevelFor(s.p || 0);
              const barPct = Math.max(0, Math.min(1, s.p || 0));
              return {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '10px 14px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)',
                    borderLeft: `3px solid ${slvl.color}`,
                  },
                  children: [
                    { type: 'div', props: { style: { display: 'flex', width: 180, fontSize: 22, fontWeight: 700, color: '#f1ece5' }, children: String(s.n || '?').slice(0, 18) } },
                    { type: 'div', props: { style: { display: 'flex', flex: 1, height: 12, background: '#1a1f2e', borderRadius: 999 }, children: [
                      { type: 'div', props: { style: { width: `${barPct * 100}%`, height: '100%', background: slvl.color, borderRadius: 999 } } },
                    ] } },
                    { type: 'div', props: { style: { display: 'flex', width: 120, justifyContent: 'flex-end', fontSize: 20, fontWeight: 700, color: slvl.color }, children: `${Math.round(barPct * 100)}%` } },
                    { type: 'div', props: { style: { display: 'flex', width: 140, justifyContent: 'flex-end', fontSize: 16, color: '#94a3b8', textTransform: 'capitalize' }, children: `${s.a || 'neutral'} · ${s.t || 0}t` } },
                  ],
                },
              };
            }),
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, fontSize: 18, color: '#94a3b8' },
            children: [
              { type: 'span', props: { children: 'paste your chat → brainsnn.com' } },
              { type: 'span', props: { children: 'autopsy · 36 cognitive layers' } },
            ],
          },
        },
      ],
    },
  };
}

function fallbackNode(title, subtitle) {
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
        background: 'linear-gradient(135deg, #0b1224 0%, #1a1f2e 100%)',
        color: '#e6f1ff',
        padding: 80,
        fontFamily: 'Inter',
      },
      children: [
        { type: 'div', props: { style: { fontSize: 28, letterSpacing: 8, color: '#5ad4ff', textTransform: 'uppercase', marginBottom: 20, fontWeight: 800 }, children: 'BrainSNN' } },
        { type: 'div', props: { style: { fontSize: 64, fontWeight: 800, textAlign: 'center', lineHeight: 1.1 }, children: subtitle || title } },
        { type: 'div', props: { style: { fontSize: 24, color: '#94a3b8', marginTop: 32 }, children: '35 cognitive layers · browser-native · zero install' } },
      ],
    },
  };
}

async function renderNode(node) {
  const svg = await satori(node, { width: 1200, height: 630, fonts: FONTS });
  const png = new Resvg(svg).render().asPng();
  return png;
}

export async function renderOg(query) {
  const type = query.type || 'reaction';
  const hash = query.h || '';
  const fallbackTitle = query.title || 'BrainSNN';
  const fallbackSub = query.subtitle || 'Paste any tweet. See which feeling it installs.';

  if (type === 'immunity' && hash) {
    const payload = decodeHash(hash);
    if (payload) return renderNode(immunityCardNode(payload));
  }

  if (type === 'quiz' && hash) {
    const payload = decodeHash(hash);
    if (payload) return renderNode(quizCardNode(payload));
  }

  if (type === 'autopsy' && hash) {
    const payload = decodeHash(hash);
    if (payload) return renderNode(autopsyCardNode(payload));
  }

  if (hash) {
    const payload = decodeHash(hash);
    if (payload) return renderNode(reactionCardNode(payload));
  }

  return renderNode(fallbackNode(fallbackTitle, fallbackSub));
}
