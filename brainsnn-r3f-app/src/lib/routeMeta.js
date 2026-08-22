// Per-route titles, crawler-readable copy and social previews.
// The server rewrites these before serving the SPA because most social scrapers
// do not execute JavaScript.

import { buildHoldoutReport } from './holdoutReport.js';

const SITE_NAME = 'BrainSNN';
const EVIDENCE = buildHoldoutReport();

/** Longest matching prefix wins, so dedicated routes stay distinct from `/`. */
const ROUTES = [
  {
    path: '/lab',
    title: 'Neuro Powder Lab | BrainSNN Arcade',
    description:
      'A falling-sand sandbox where four materials are a spiking neuron model. '
      + 'Draw a circuit, watch it learn, and inspect its firing regime.',
    heading: 'Neuro Powder Lab',
    body: [
      'A falling-sand sandbox that turns into a neural circuit. Sand, water and oil behave the way a powder game leads you to expect; neurons, synapses and wiring run a spiking model rather than a decorative animation.',
      'Draw a circuit cell by cell, drive it, and watch the synapses change weight. The lab uses the same measured firing-regime metrics exposed in BrainSNN research.',
      'Any grid can be shared as a link. The circuit travels inside the URL, so there is no server copy of the grid.',
    ],
  },
  {
    path: '/arcade',
    title: 'GaugeGap Arcade | Playable BrainSNN experiments',
    description:
      'Explore BrainSNN’s interactive research playground: neural circuits, fractals, cognitive experiments and shareable simulations.',
    heading: 'GaugeGap Arcade',
    body: [
      'The Arcade is BrainSNN’s experimental playground: interactive models, neural simulations and small research experiences you can operate rather than only read about.',
      'It sits behind the main BrainSNN analyzer so visitors can use the product first, then explore the science and experiments underneath it.',
    ],
  },
  {
    path: '/reconstruct',
    title: 'Reconstruct a Stronger Claim | BrainSNN',
    description:
      'Separate what the evidence supports from what the story merely implies, then rebuild the claim responsibly.',
    heading: 'Reconstruct a stronger claim',
    body: [
      'Most weak claims are not lies. They are a supported finding and an unsupported implication welded together in one sentence.',
      'Reconstruct pulls the two apart: what the evidence actually carries, what the framing adds on top, and what a version that keeps only the supported part would sound like.',
    ],
  },
  {
    path: '/evidence',
    title: 'What BrainSNN scores on text it has never seen | BrainSNN',
    description:
      'The held-out evaluation, computed live: rank agreement falls from '
      + `${EVIDENCE.inSample.rho} on the passages the cue patterns were written against to `
      + `${EVIDENCE.outOfSample.rho} on ${EVIDENCE.corpusSize} it had never seen. `
      + `Every miss and all ${EVIDENCE.falseAlarmCount} false alarms are shown.`,
    heading: 'What the detector scores on text it has never seen',
    body: [
      `Rank agreement on the passages the cue patterns were written against is ${EVIDENCE.inSample.rho}. On ${EVIDENCE.corpusSize} passages the detector had never seen, it is ${EVIDENCE.outOfSample.rho}.`,
      `Every miss and all ${EVIDENCE.falseAlarmCount} false alarms are listed with the phrases that triggered them, so disagreements can be inspected case by case.`,
      'The figures are computed as this page is served from the corpus in the repository rather than copied from a static report.',
    ],
  },
  {
    path: '/app',
    title: 'BrainSNN | Turn text, pages and video into decision intelligence',
    description:
      'Paste content or upload a screen recording. BrainSNN surfaces attention, trust, evidence gaps, visual transitions, workflow steps and specific next actions.',
    heading: 'Analyze what you are about to publish — or show BrainSNN what happened',
    body: [
      'BrainSNN accepts text, page copy, local video or screen recordings, and decoded neural-model transcripts. It turns those inputs into structured attention, trust, risk, evidence and workflow signals.',
      'Video mode adaptively samples low-resolution visual changes in the browser and fuses those timestamps with optional transcript or operator notes. The raw video is not uploaded by this V0.1 path.',
      'Recommendations point back to the actual claim, proof line, workflow step or timestamp that caused them. Visual transitions are review cues, not object, person or action recognition.',
    ],
  },
  {
    path: '/',
    title: 'BrainSNN | Turn text, pages and video into decision intelligence',
    description:
      'Paste content or upload a screen recording. BrainSNN surfaces attention, trust, evidence gaps, visual transitions, workflow steps and specific next actions.',
    heading: 'Know what lands — and what happened',
    body: [
      'BrainSNN is the product on the homepage. Paste a draft, page, ad, email or script, or upload a local screen recording and run the analysis without first entering a separate app.',
      'The current stack combines deterministic content signals with contextual recommendations. Video mode adds browser-local visual-change sampling and transcript-to-workflow extraction; neural mode accepts decoded text from an authorized decoder rather than raw brain signals.',
      'Results are directional AI-estimated signals, not literal neurological measurement. GaugeGap Arcade and the research pages remain available underneath the main analyzer for people who want to inspect the experiments and evidence.',
    ],
  },
];

const CRAWL_LINKS = Object.freeze([
  { path: '/', label: 'BrainSNN analyzer' },
  { path: '/arcade', label: 'GaugeGap Arcade' },
  { path: '/lab', label: 'Neuro Powder Lab' },
  { path: '/app', label: 'BrainSNN legacy app route' },
  { path: '/evidence', label: 'Held-out evaluation' },
  { path: '/reconstruct', label: 'Reconstruct a claim' },
]);

const SHARED_GRID = {
  title: 'Someone built this in the Neuro Powder Lab',
  description:
    'A circuit drawn cell by cell in a falling-sand sandbox, carried entirely in this link — no server copy required.',
  heading: 'Someone built this in the Neuro Powder Lab',
  body: [
    'This link carries a circuit somebody drew cell by cell in a falling-sand sandbox where four materials are a spiking neuron model.',
    'Open it to watch it run, then clear the grid and draw your own.',
  ],
};

export function resolveRouteMeta(pathname = '/', search = '') {
  const route = ROUTES.find((entry) => (
    entry.path === '/' ? pathname === '/' : pathname.startsWith(entry.path)
  )) || ROUTES[ROUTES.length - 1];

  if (route.path === '/lab' && /(^|[?&])grid=/.test(search)) {
    const grid = new URLSearchParams(search.replace(/^\?/, '')).get('grid') || '';
    return {
      ...route,
      ...SHARED_GRID,
      image: `/api/og/lab?grid=${encodeURIComponent(grid)}`,
    };
  }
  return route;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderContentBlock(meta, currentPath = '/') {
  if (!meta?.heading) return '';

  const paragraphs = (meta.body || [])
    .map((text) => `<p style="margin:0 0 1rem">${escapeAttribute(text)}</p>`)
    .join('');

  const links = CRAWL_LINKS
    .filter((link) => link.path !== currentPath)
    .map((link) => `<li style="margin:0 0 .5rem"><a href="${escapeAttribute(link.path)}" style="color:#7dd3fc">${escapeAttribute(link.label)}</a></li>`)
    .join('');

  return '<main data-prerendered="1" style="max-width:44rem;margin:0 auto;padding:3rem 1.5rem;'
    + 'font-family:Inter,system-ui,sans-serif;color:#e2e8f0;background:#030308;line-height:1.6">'
    + `<h1 style="font-size:1.9rem;line-height:1.25;margin:0 0 1.25rem">${escapeAttribute(meta.heading)}</h1>`
    + paragraphs
    + `<nav aria-label="Sections"><ul style="list-style:none;padding:0;margin:2rem 0 0">${links}</ul></nav>`
    + '</main>';
}

export function applyRouteMeta(html, pathname, search = '', origin = '') {
  const meta = resolveRouteMeta(pathname, search);
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const url = origin ? escapeAttribute(`${origin}${pathname}`) : null;

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[\s\S]*?(")/, `$1${description}$2`)
    .replace(/(<meta\s+property="og:title"\s+content=")[\s\S]*?(")/, `$1${title}$2`)
    .replace(/(<meta\s+property="og:description"\s+content=")[\s\S]*?(")/, `$1${description}$2`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[\s\S]*?(")/, `$1${title}$2`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[\s\S]*?(")/, `$1${description}$2`);

  if (url) {
    out = out
      .replace(/(<meta\s+property="og:url"\s+content=")[\s\S]*?(")/, `$1${url}$2`)
      .replace(/(<link\s+rel="canonical"\s+href=")[\s\S]*?(")/, `$1${url}$2`);
  }

  if (meta.image && origin) {
    const image = escapeAttribute(`${origin.replace(/\/$/, '')}${meta.image}`);
    out = out
      .replace(/(<meta\s+property="og:image"\s+content=")[\s\S]*?(")/, `$1${image}$2`)
      .replace(/(<meta\s+name="twitter:image"\s+content=")[\s\S]*?(")/, `$1${image}$2`);
  }

  const block = renderContentBlock(meta, pathname);
  if (block) {
    out = out.replace(
      /(<div id="root">)(<\/div>)/,
      (_match, open, close) => `${open}${block}${close}`,
    );
  }
  return out;
}

export const ROUTE_PATHS = Object.freeze(ROUTES.map((entry) => entry.path));
export const SITE = Object.freeze({ name: SITE_NAME });
