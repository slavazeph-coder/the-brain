import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const AFFECT_COLORS = {
  fear: '#dd6974',
  outrage: '#e57b40',
  urgency: '#fdab43',
  certainty: '#a86fdf',
  awe: '#5591c7',
  belonging: '#ec87b5',
  curiosity: '#5fb7c1',
  neutral: '#6daa45',
};

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

function b64urlDecode(str) {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const base = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return atob(base);
}

function decodeReaction(hash) {
  try {
    const json = b64urlDecode(hash);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clampText(text, max = 180) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function Bar({ label, value, color }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: '100%',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 18,
              color: '#cbd5e1',
              fontWeight: 500,
            },
            children: [
              { type: 'span', props: { children: label } },
              { type: 'span', props: { style: { color }, children: `${Math.round(pct * 100)}%` } },
            ],
          },
        },
        {
          type: 'div',
          props: {
            style: {
              width: '100%',
              height: 10,
              background: '#1a1f2e',
              borderRadius: 999,
              display: 'flex',
            },
            children: [
              {
                type: 'div',
                props: {
                  style: {
                    width: `${pct * 100}%`,
                    height: '100%',
                    background: color,
                    borderRadius: 999,
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function levelFor(score) {
  if (score >= 85) return { label: 'Fortified', color: '#5ee69a' };
  if (score >= 70) return { label: 'Resilient', color: '#77dbe4' };
  if (score >= 55) return { label: 'Steady', color: '#fdab43' };
  if (score >= 35) return { label: 'Exposed', color: '#e57b40' };
  return { label: 'At risk', color: '#dd6974' };
}

function renderImmunityCard(hash) {
  const raw = (() => {
    try {
      const pad = '='.repeat((4 - (hash.length % 4)) % 4);
      const base = hash.replace(/-/g, '+').replace(/_/g, '/') + pad;
      return JSON.parse(atob(base));
    } catch {
      return null;
    }
  })();

  if (!raw) return null;
  const score = raw.s || 0;
  const lvl = levelFor(score);
  const handle = raw.n || 'anon';
  const streak = raw.st || 0;
  const dims = [
    { k: 'Awareness', v: raw.a || 0 },
    { k: 'Resilience', v: raw.r || 0 },
    { k: 'Depth', v: raw.d || 0 },
    { k: 'Consistency', v: raw.c || 0 },
  ];

  return new ImageResponse(
    {
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
          fontFamily: 'sans-serif',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
              children: [
                { type: 'div', props: { style: { fontSize: 22, letterSpacing: 6, color: '#5ad4ff', textTransform: 'uppercase', fontWeight: 700 }, children: 'BrainSNN · Immunity' } },
                { type: 'div', props: { style: { padding: '8px 18px', borderRadius: 999, background: lvl.color, color: '#0b1224', fontSize: 22, fontWeight: 700 }, children: lvl.label } },
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
                      { type: 'div', props: { style: { fontSize: 22, color: '#94a3b8', marginTop: -4 }, children: `/ 100 · ${streak}-day streak${raw.rk ? ` · rank ${raw.rk}${raw.tt ? ` of ${raw.tt}` : ''}` : ''}` } },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 14, justifyContent: 'center' },
                    children: dims.map((d) => ({
                      type: 'div',
                      props: {
                        style: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%' },
                        children: [
                          {
                            type: 'div',
                            props: {
                              style: { display: 'flex', justifyContent: 'space-between', fontSize: 20, color: '#cbd5e1', fontWeight: 500 },
                              children: [
                                { type: 'span', props: { children: d.k } },
                                { type: 'span', props: { style: { color: lvl.color }, children: `${d.v}` } },
                              ],
                            },
                          },
                          {
                            type: 'div',
                            props: {
                              style: { width: '100%', height: 10, background: '#1a1f2e', borderRadius: 999, display: 'flex' },
                              children: [{ type: 'div', props: { style: { width: `${Math.max(0, Math.min(100, d.v))}%`, height: '100%', background: lvl.color, borderRadius: 999 } } }],
                            },
                          },
                        ],
                      },
                    })),
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
    },
    { width: 1200, height: 630 }
  );
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'reaction';
  const hash = searchParams.get('h');
  const fallbackTitle = searchParams.get('title') || 'BrainSNN';
  const fallbackSub = searchParams.get('subtitle') || 'Paste any tweet. See which feeling it installs.';

  if (type === 'immunity' && hash) {
    const card = renderImmunityCard(hash);
    if (card) return card;
  }

  let payload = hash ? decodeReaction(hash) : null;

  // Synthetic fallback so the homepage OG still renders
  if (!payload) {
    return new ImageResponse(
      {
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
          },
          children: [
            {
              type: 'div',
              props: {
                style: {
                  fontSize: 28,
                  letterSpacing: 8,
                  color: '#5ad4ff',
                  textTransform: 'uppercase',
                  marginBottom: 20,
                },
                children: 'BrainSNN',
              },
            },
            {
              type: 'div',
              props: {
                style: { fontSize: 64, fontWeight: 800, textAlign: 'center', lineHeight: 1.1 },
                children: fallbackTitle === 'BrainSNN' ? fallbackSub : fallbackTitle,
              },
            },
            {
              type: 'div',
              props: {
                style: { fontSize: 24, color: '#94a3b8', marginTop: 32 },
                children: '35 cognitive layers · browser-native · zero install',
              },
            },
          ],
        },
      },
      { width: 1200, height: 630 }
    );
  }

  const affect = payload.a || 'neutral';
  const affectColor = AFFECT_COLORS[affect] || AFFECT_COLORS.neutral;
  const affectLabel = AFFECT_LABELS[affect] || AFFECT_LABELS.neutral;
  const overall = ((payload.e || 0) + (payload.c || 0) + (payload.m || 0)) / 3;
  const overallPct = Math.round(overall * 100);

  return new ImageResponse(
    {
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
          fontFamily: 'sans-serif',
        },
        children: [
          // header
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 28,
              },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: 22,
                      letterSpacing: 6,
                      color: '#5ad4ff',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                    },
                    children: 'BrainSNN · Reaction',
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      padding: '8px 18px',
                      borderRadius: 999,
                      background: affectColor,
                      color: '#0b1224',
                      fontSize: 22,
                      fontWeight: 700,
                    },
                    children: affectLabel,
                  },
                },
              ],
            },
          },
          // body: quote + bars
          {
            type: 'div',
            props: {
              style: { display: 'flex', flex: 1, gap: 48 },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      flex: 1.3,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: 30,
                            lineHeight: 1.35,
                            color: '#f1ece5',
                            borderLeft: `4px solid ${affectColor}`,
                            paddingLeft: 24,
                          },
                          children: `"${clampText(payload.t || '', 220)}"`,
                        },
                      },
                    ],
                  },
                },
                {
                  type: 'div',
                  props: {
                    style: {
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 20,
                      justifyContent: 'center',
                    },
                    children: [
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                            marginBottom: 8,
                          },
                          children: [
                            {
                              type: 'div',
                              props: {
                                style: { fontSize: 16, color: '#94a3b8', letterSpacing: 2, textTransform: 'uppercase' },
                                children: 'Overall pressure',
                              },
                            },
                            {
                              type: 'div',
                              props: {
                                style: { fontSize: 72, fontWeight: 800, color: affectColor, lineHeight: 1 },
                                children: `${overallPct}%`,
                              },
                            },
                          ],
                        },
                      },
                      Bar({ label: 'Emotional activation', value: payload.e, color: '#dd6974' }),
                      Bar({ label: 'Cognitive suppression', value: payload.c, color: '#fdab43' }),
                      Bar({ label: 'Manipulation pressure', value: payload.m, color: '#a86fdf' }),
                      Bar({ label: 'Trust erosion', value: payload.u, color: '#5591c7' }),
                    ],
                  },
                },
              ],
            },
          },
          // footer
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 24,
                fontSize: 20,
                color: '#94a3b8',
              },
              children: [
                { type: 'span', props: { children: 'scan yours → brainsnn.com' } },
                { type: 'span', props: { children: '35 cognitive layers · browser-native' } },
              ],
            },
          },
        ],
      },
    },
    { width: 1200, height: 630 }
  );
}
