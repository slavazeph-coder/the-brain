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

const SITE_NAME = 'GaugeGap Foundry by BrainSNN';

/** Longest matching prefix wins, so `/lab` can differ from `/`. */
const ROUTES = [
  {
    path: '/lab',
    title: 'Neuro Powder Lab | Drop sand, then build a brain out of it',
    description:
      'A falling-sand sandbox where four of the materials are a spiking neuron model. '
      + 'Draw a circuit, watch it learn, and read its firing regime from the same metrics '
      + 'module the research page uses.',
  },
  {
    path: '/reconstruct',
    title: 'Reconstruct a Stronger Claim | GaugeGap Foundry',
    description:
      'Separate what the evidence supports from what the story merely implies, '
      + 'then rebuild the claim responsibly.',
  },
  {
    path: '/app',
    title: 'BrainSNN | Score any text for pressure, trust and manipulation',
    description:
      'Paste a headline, ad or email and see attention pressure, emotional charge, '
      + 'trust cost and named persuasion techniques — with the claim boundary visible.',
  },
  {
    path: '/',
    title: 'GaugeGap Foundry | Play with the impossible',
    description:
      'Playable science and custom interactive experiences by BrainSNN. Explore live '
      + 'simulations, share exact run states, or build a focused pilot for your audience.',
  },
];

/** A shared grid deserves to say so rather than inheriting the lab's generic card. */
const SHARED_GRID = {
  title: 'Someone built this in the Neuro Powder Lab',
  description:
    'A circuit drawn cell by cell in a falling-sand sandbox, carried entirely in this '
    + 'link — no server involved. Open it, then draw your own.',
};

export function resolveRouteMeta(pathname = '/', search = '') {
  const route = ROUTES.find((entry) => (
    entry.path === '/' ? pathname === '/' : pathname.startsWith(entry.path)
  )) || ROUTES[ROUTES.length - 1];

  if (route.path === '/lab' && /(^|[?&])grid=/.test(search)) {
    return { ...route, ...SHARED_GRID };
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
  return out;
}

export const ROUTE_PATHS = Object.freeze(ROUTES.map((entry) => entry.path));
export const SITE = Object.freeze({ name: SITE_NAME });
