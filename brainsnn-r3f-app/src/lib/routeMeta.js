// Per-route titles and social previews.
//
// This is a single-page app, so every route was served the same index.html and
// therefore the same <title> and the same Open Graph card. A link to the powder
// lab, a shared grid, a challenge link and the homepage all previewed
// identically — which matters here more than for most sites, because sharing is
// the product's growth loop. The share button says "Link copied. It carries the
// whole grid, no server involved", and the preview then said nothing about the
// grid.
//
// Social scrapers do not run JavaScript, so setting document.title on the
// client cannot fix this. The server has to put the right tags in the HTML it
// sends, which is what applyRouteMeta does.
//
// The same argument, taken one step further, is why each route also carries a
// `heading` and `body` here. The document this server sends is
// `<div id="root"></div>` and a module script: a crawler that does not execute
// JavaScript sees a blank page on every URL. Google renders eventually; the
// assistant crawlers that increasingly decide what gets recommended mostly do
// not. So each route's real content — the claim it makes, in its own words —
// is injected into #root, where React 19's createRoot replaces it on mount.
// Visitors get the app; crawlers get a page that says something.

import { buildHoldoutReport } from './holdoutReport.js';

const SITE_NAME = 'GaugeGap Foundry by BrainSNN';

// The evidence card quotes two figures, so it computes them rather than
// repeating them. A social card is the one place a stale number does the most
// damage: it is what gets screenshotted and pasted into a pitch, long after the
// page it came from has moved on. ~20 ms once at server boot, and this module is
// imported only by server.ts.
const EVIDENCE = buildHoldoutReport();

/** Longest matching prefix wins, so `/lab` can differ from `/`. */
const ROUTES = [
  {
    path: '/lab',
    title: 'Neuro Powder Lab | Drop sand, then build a brain out of it',
    description:
      'A falling-sand sandbox where four of the materials are a spiking neuron model. '
      + 'Draw a circuit, watch it learn, and read its firing regime from the same metrics '
      + 'module the research page uses.',
    heading: 'Neuro Powder Lab',
    body: [
      'A falling-sand sandbox that turns into a neural circuit. Sand, water and oil '
      + 'behave the way a powder game leads you to expect. Four of the materials do '
      + 'not: they are neurons, synapses and the wiring between them, running a '
      + 'spiking model rather than an animation of one.',
      'Draw a circuit cell by cell, drive it, and watch the synapses change weight. '
      + 'The firing regime is measured by the same metrics module the research page '
      + 'uses, so what the lab reports and what the research claims cannot disagree.',
      'Any grid can be shared as a link. The whole circuit travels inside the URL — '
      + 'there is no server copy, and nothing about it is stored here.',
    ],
  },
  {
    path: '/reconstruct',
    title: 'Reconstruct a Stronger Claim | GaugeGap Foundry',
    description:
      'Separate what the evidence supports from what the story merely implies, '
      + 'then rebuild the claim responsibly.',
    heading: 'Reconstruct a stronger claim',
    body: [
      'Most weak claims are not lies. They are a supported finding and an '
      + 'unsupported implication, welded together in one sentence so that '
      + 'disagreeing with the second looks like denying the first.',
      'Reconstruct pulls the two apart: what the evidence actually carries, what '
      + 'the framing adds on top, and what a version that keeps only the first '
      + 'would sound like.',
    ],
  },
  {
    // The card is the pitch here: a vendor leading with its own worst number is
    // the thing worth clicking, so the description says the number rather than
    // promising accuracy.
    path: '/evidence',
    title: 'What our detector scores on text it has never seen | GaugeGap Foundry',
    description:
      'The held-out evaluation, computed live: rank agreement falls from '
      + `${EVIDENCE.inSample.rho} on the passages the cue patterns were written against to `
      + `${EVIDENCE.outOfSample.rho} on ${EVIDENCE.corpusSize} it had never seen. `
      + `Every miss and all ${EVIDENCE.falseAlarmCount} false alarms are shown, with the `
      + 'phrases behind each detection.',
    heading: 'What the detector scores on text it has never seen',
    body: [
      `Rank agreement on the passages the cue patterns were written against is `
      + `${EVIDENCE.inSample.rho}. On ${EVIDENCE.corpusSize} passages the detector had `
      + `never seen, it is ${EVIDENCE.outOfSample.rho}. The gap between those two numbers `
      + 'is the part of the score that came from having seen the answer.',
      `Every miss and all ${EVIDENCE.falseAlarmCount} false alarms are listed, each with `
      + 'the phrases that triggered it, so a disagreement can be about a specific '
      + 'passage rather than about the average.',
      'The figures are computed as this page is served, from the corpus in the '
      + 'repository. They are not transcribed from a report, which is why they can '
      + 'go down.',
    ],
  },
  {
    path: '/app',
    title: 'BrainSNN | Score any text for pressure, trust and manipulation',
    description:
      'Paste a headline, ad or email and see attention pressure, emotional charge, '
      + 'trust cost and named persuasion techniques — with the claim boundary visible.',
    heading: 'Score any text for pressure, trust and manipulation',
    body: [
      'Paste a headline, an ad, a cold email or a message that felt wrong, and get '
      + 'a reading: how hard it pushes for attention, what it costs in trust, which '
      + 'emotions it reaches for, and which named persuasion techniques it uses.',
      'The techniques are named the way the research literature names them — Loaded '
      + 'Language, Appeal to Fear, Doubt, Bandwagon and the rest of the SemEval '
      + 'persuasion taxonomy — so a score can be checked against work done outside '
      + 'this project, and each one is shown with the phrase that triggered it.',
      'Scoring is deterministic and runs on the server without a model key: the same '
      + 'text always produces the same result, and every scan carries a receipt hash '
      + 'that can be recomputed.',
    ],
  },
  {
    path: '/',
    title: 'GaugeGap Foundry | Play with the impossible',
    description:
      'Playable science and custom interactive experiences by BrainSNN. Explore live '
      + 'simulations, share exact run states, or build a focused pilot for your audience.',
    heading: 'Play with the impossible',
    body: [
      'GaugeGap Foundry builds science you operate rather than read about. Each lab '
      + 'is a real model with its assumptions visible: draw a spiking circuit in a '
      + 'falling-sand grid, push a content analyzer until it breaks, or run a '
      + 'simulation and share the exact state it ended in.',
      'Underneath sits BrainSNN, a deterministic engine that scores text for '
      + 'attention pressure, trust, emotional charge and named persuasion techniques '
      + '— and that publishes what it scores on text it has never seen, including '
      + 'where it fails.',
      'Everything public here is an educational numerical model, not proof of a '
      + 'physical claim. Where a number would be easy to overstate, the page states '
      + 'the boundary instead.',
    ],
  },
];

/**
 * Links every route, on every route.
 *
 * A crawler that does not execute JavaScript sees no navigation at all — the
 * menus are React. Without this, each page is an island and only whichever URL
 * happened to get linked from outside is discoverable.
 */
const CRAWL_LINKS = Object.freeze([
  { path: '/', label: 'GaugeGap Foundry' },
  { path: '/lab', label: 'Neuro Powder Lab' },
  { path: '/app', label: 'BrainSNN content analysis' },
  { path: '/evidence', label: 'Held-out evaluation' },
  { path: '/reconstruct', label: 'Reconstruct a claim' },
]);

/** A shared grid deserves to say so rather than inheriting the lab's generic card. */
const SHARED_GRID = {
  title: 'Someone built this in the Neuro Powder Lab',
  description:
    'A circuit drawn cell by cell in a falling-sand sandbox, carried entirely in this '
    + 'link — no server involved. Open it, then draw your own.',
  heading: 'Someone built this in the Neuro Powder Lab',
  body: [
    'This link carries a circuit somebody drew cell by cell in a falling-sand '
    + 'sandbox where four of the materials are a spiking neuron model. The whole '
    + 'grid travels inside the URL — there is no server copy to look up.',
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
      // The card becomes a picture of the circuit in the link. Every other
      // preview on the site can only show the site; this one can show the thing
      // that was actually shared, which is the reason anyone opens it.
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

/**
 * The content a crawler sees, rendered into #root.
 *
 * Styled to match the app's own background rather than left unstyled, because
 * for a moment on a slow connection a real visitor sees this too — it should
 * read as the page arriving, not as a different page flashing past. It is also
 * what someone browsing with JavaScript off gets, which was previously nothing.
 */
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

/**
 * Rewrites the title and the description/OG/Twitter tags in a built index.html.
 *
 * Deliberately a string rewrite over the existing tags rather than an injection
 * of extra ones: duplicate og:title tags are resolved differently by different
 * scrapers, so there must only ever be one of each.
 */
export function applyRouteMeta(html, pathname, search = '', origin = '') {
  const meta = resolveRouteMeta(pathname, search);
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const url = origin ? escapeAttribute(`${origin}${pathname}`) : null;

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(
      /(<meta\s+name="description"\s+content=")[\s\S]*?(")/,
      `$1${description}$2`,
    )
    .replace(
      /(<meta\s+property="og:title"\s+content=")[\s\S]*?(")/,
      `$1${title}$2`,
    )
    .replace(
      /(<meta\s+property="og:description"\s+content=")[\s\S]*?(")/,
      `$1${description}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:title"\s+content=")[\s\S]*?(")/,
      `$1${title}$2`,
    )
    .replace(
      /(<meta\s+name="twitter:description"\s+content=")[\s\S]*?(")/,
      `$1${description}$2`,
    );

  if (url) {
    out = out
      .replace(/(<meta\s+property="og:url"\s+content=")[\s\S]*?(")/, `$1${url}$2`)
      .replace(/(<link\s+rel="canonical"\s+href=")[\s\S]*?(")/, `$1${url}$2`);
  }

  // A route may name its own preview image; everything else keeps the site card.
  // The shared-grid case uses this to preview as the circuit it carries, which
  // is the only preview here that can say something the site card cannot.
  if (meta.image && origin) {
    const image = escapeAttribute(`${origin.replace(/\/$/, '')}${meta.image}`);
    out = out
      .replace(/(<meta\s+property="og:image"\s+content=")[\s\S]*?(")/, `$1${image}$2`)
      .replace(/(<meta\s+name="twitter:image"\s+content=")[\s\S]*?(")/, `$1${image}$2`);
  }

  // Injected rather than appended: React's createRoot replaces the children of
  // #root on mount, so this has to be inside it to be replaced rather than left
  // behind under the running app.
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
