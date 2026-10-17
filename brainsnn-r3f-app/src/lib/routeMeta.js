// Per-route titles, crawler-readable copy and social previews.
// The server rewrites these before serving the SPA because most social scrapers
// do not execute JavaScript.

import { buildHoldoutReport } from './holdoutReport.js';
import { DEFAULT_RUNTIME_ESTIMATE, formatUSD } from './arenaPricing.js';

const SITE_NAME = 'BrainSNN';
const EVIDENCE = buildHoldoutReport();

const REVIEW = {
  title: 'Review | BrainSNN',
  description: 'Review a passage, compare two drafts, split a claim or inspect video cues. Trace each finding to a span or timestamp, with known detector misses beside the score.',
  heading: 'Review the evidence behind a signal.',
  body: [
    'One workbench, four tabs: Passage, Two drafts, Claim split and Video cues. Inspect a source span or timestamp before deciding what to change.',
    'Known misses and false alarms from the held-out evaluation stay alongside the score. Those evaluation results describe the test corpus, not a verdict on your input.',
    'Text scores are heuristic review signals. Video cues mark visual changes and supplied notes; they do not recognize objects, people or actions. Neither measures a reader or predicts a market.',
  ],
};

const REVIEW_TABS = {
  passage: 'Passage',
  drafts: 'Two drafts',
  claims: 'Claim split',
  video: 'Video cues',
};

const LEGACY_ROUTES = {
  '/app': { path: '/office', tab: 'passage' },
  '/engine': { path: '/office', tab: 'drafts' },
  '/reconstruct': { path: '/office', tab: 'claims' },
  '/missions': { path: '/arena/' },
};

/** Longest matching prefix wins, so dedicated routes stay distinct from `/`. */
const ROUTES = [
  { path: '/coherence', title: 'Video research preview | BrainSNN', heading: 'Inspect the correction pass.', description: 'Inspect a synthetic video correction fixture, published baselines and failed native-resolution quality gates.', body: ['Fixed post-process engine v0.4, with no trained weights. The low-resolution synthetic example does not establish HD or general video quality.', 'Native motion gates failed. Multi-minute coherence remains unestablished.'] },
  {
    path: '/toys/fool-the-detector',
    title: 'Fool the Detector | BrainSNN',
    image: '/og/toy-fool.png',
    description:
      'Can you fool our AI detector? Five rounds: slip a manipulation trick past the same detector the BrainSNN analyzer runs, whose blind spots are published.',
    heading: 'Can you fool our AI detector?',
    body: [
      'Write a line that uses a persuasion trick — a deadline, a crowd, a threat — without the detector naming it. Five rounds, escalating from one trick to three at once, scored out of 100 with a rank at the end.',
      'The detector is the real one, running in your browser. Its published evaluation reports that it missed all four techniques written in paraphrase on held-out text. Model scores describe their tested conditions; they do not establish universal capability.',
    ],
  },
  {
    path: '/toys/draft-duel',
    title: 'Draft Duel | BrainSNN',
    image: '/og/toy-duel.png',
    description:
      'Make two drafts fight. Paste two versions and watch them trade blows on trust, calm, clean play, warmth and spark — scored locally by BrainSNN’s deterministic engine.',
    heading: 'Make two drafts fight.',
    body: [
      'Paste two versions of an email, post or pitch. Five rounds — trust, calm, clean play, warmth and spark — scored by the same deterministic engine as the BrainSNN comparison workbench, entirely in the browser.',
      'A win is a game result from heuristic signals, not a verdict on quality, truth or what readers will do.',
    ],
  },
  {
    path: '/toys/defend-the-brain',
    title: 'Defend the Brain | BrainSNN',
    image: '/og/toy-defend.png',
    description:
      'Persuasion packets from real text attack a live seven-region brain model. Cut pathways, silence the threat loop and keep judgment online.',
    heading: 'Can you keep the brain from getting hijacked?',
    body: [
      'Defend the Brain turns the persuasion techniques found in real text into attacks on a seven-region spiking model. Intervene on a budget to keep the hijack index down, or paste your own writing to make it the level.',
      'Scores are 0–100 indices, not probabilities. Results describe tested conditions, not universal capability. The model is a simulation, not a measurement of any human brain.',
    ],
  },
  {
    path: '/arena/tasks',
    title: 'Arena tasks | BrainSNN',
    description:
      'Inspect bounded Arena tasks with explicit acceptance criteria, recorded attempts and a judge.',
    heading: 'A task needs a judge.',
    body: [
      'Each task defines an objective, an environment, permitted actions and a judge. Recorded attempts preserve evidence against the conditions that were actually tested.',
      'Synthetic task results describe local practice. They do not establish performance by a named model, a verified payment or an accepted customer delivery. Tasks without an implementation remain unavailable.',
    ],
  },
  {
    path: '/arena/',
    image: '/og/robot-testing.png',
    title: 'Robot arcade | BrainSNN',
    description: 'Pick a robot and a model, choose a challenge and play with the world. Try local practice or connect a matched model worker, then replay your run.',
    heading: 'Pick a robot. Choose its brain.',
    body: [
      'Choose your robot and model before you run. Explore challenges, move the camera, change the world and replay what happened.',
      'Local practice — not a model score. The scripted arm does not score a named policy. A model result requires a named model that actually ran and inspectable execution evidence.',
    ],
  },
  {
    path: '/lab/powder',
    title: 'Neuro Powder Lab | BrainSNN',
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
    path: '/lab',
    title: 'Lab | BrainSNN',
    description: 'Explore BrainSNN experiments: the jelly brain, Neuro Powder Lab, Arcade and three playable detector toys.',
    heading: 'Experiments live here.',
    body: [
      'The Lab gathers the jelly brain at /play, the Neuro Powder Lab, Arcade and three toys: Fool the Detector, Draft Duel and Defend the Brain.',
      'These are simulations and local experiments. Use Arena for a task with a judge, Review for your own material and Evidence to inspect the detector’s known misses.',
    ],
    links: [
      { path: '/play', label: 'Sapient Playground' },
      { path: '/lab/powder', label: 'Neuro Powder Lab' },
      { path: '/arcade', label: 'Arcade' },
      { path: '/toys/fool-the-detector', label: 'Fool the Detector' },
      { path: '/toys/draft-duel', label: 'Draft Duel' },
      { path: '/toys/defend-the-brain', label: 'Defend the Brain' },
    ],
  },
  {
    path: '/arcade',
    title: 'Arcade | BrainSNN',
    description:
      'Explore BrainSNN’s interactive research playground: neural circuits, fractals, cognitive experiments and shareable simulations.',
    heading: 'Arcade experiments',
    body: [
      'The Arcade is BrainSNN’s experimental playground: interactive models, neural simulations and small research experiences you can operate rather than only read about.',
      'The Arcade is part of Lab. Simulation results describe their tested conditions; they do not establish customer demand or commercial success.',
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
    path: '/office',
    ...REVIEW,
  },
  {
    path: '/play',
    title: 'BrainSNN | Sapient Playground',
    image: '/og/toy-poke.png',
    description:
      'Poke the brain and watch the signal travel. A jelly brain wrapped around a seven-region spiking model — then build a mind, give it a world, give it a mission.',
    heading: 'Poke the brain and watch the signal travel.',
    body: [
      'Poke, drag or shake a jelly brain. Every poke drives the seven-region spiking model BrainSNN’s analyzer runs on, and the signal travels its pathways. It is a simulation, not a recording of anyone’s brain.',
      'Explore more toys in Lab, open Review to inspect a passage or compare two drafts, or enter Arena for a task with a judge.',
      'Inspect the detector’s published evaluation, including missed cues and false alarms. Model scores and simulation results describe their tested conditions; they do not establish universal capability.',
    ],
  },
  {
    path: '/',
    image: '/og/robot-testing.png',
    title: 'BrainSNN | Robot policy testing',
    description: `Explore robot-policy test packs from 10 to 100,000 episodes. The illustrative runtime price for 100,000 episodes is ${formatUSD(DEFAULT_RUNTIME_ESTIMATE.runtimePriceUSD)}. Assumptions shown; hosted policy testing is pending qualification.`,
    heading: 'Test your robot. See where it fails.',
    body: [
      'Choose a robot and model in the arcade, try a challenge and replay what happened. Local practice uses a scripted arm and does not score a named policy.',
      `Plan 10 to 100,000 total task attempts, with visible runtime pricing. The default illustration is ${formatUSD(DEFAULT_RUNTIME_ESTIMATE.runtimePriceUSD)} for 100,000 episodes, based on 500 episodes per worker-hour, US$0.60 per worker-hour and a 30% gross margin. These are assumed inputs, not measured policy throughput or a quote.`,
      'The first execution kit covers ten Panda + π₀.₅ / LIBERO Spatial episodes. Larger counts are budget forecasts. Startup, storage, transfers, retries, external inference, operator support and taxes are excluded from the runtime price example.',
      'Hosted policy tests are not yet available. The first real-policy GPU run still needs verification. Larger packs follow measured runtime and cost.',
    ],
  },
];

const CRAWL_LINKS = Object.freeze([
  { path: '/arena/', label: 'Robot arcade' },
  { path: '/arena/#campaigns', label: 'Pricing' },
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
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const legacy = LEGACY_ROUTES[pathname.replace(/\/$/, '')];
  const targetPath = pathname.startsWith('/missions/') ? pathname.replace('/missions/', '/arena/tasks/') : legacy?.path || pathname;
  const normalizedPath = targetPath.replace(/\/$/, '') || '/';
  const route = ROUTES.find((entry) => (
    entry.path === '/' ? normalizedPath === '/' : (
      normalizedPath === entry.path.replace(/\/$/, '')
      || normalizedPath.startsWith(`${entry.path.replace(/\/$/, '')}/`)
    )
  )) || ROUTES[ROUTES.length - 1];

  if ((route.path === '/lab/powder' || normalizedPath === '/lab') && params.has('grid')) {
    const grid = params.get('grid') || '';
    return {
      ...ROUTES.find((entry) => entry.path === '/lab/powder'),
      ...SHARED_GRID,
      path: '/lab/powder',
      canonicalPath: '/lab/powder',
      image: `/api/og/lab?grid=${encodeURIComponent(grid)}`,
    };
  }
  if (route.path === '/office') {
    const tab = legacy?.tab || params.get('tab');
    return {
      ...route,
      canonicalPath: '/office',
      title: Object.hasOwn(REVIEW_TABS, tab) ? `Review: ${REVIEW_TABS[tab]} | BrainSNN` : route.title,
      image: '/og-image.png',
    };
  }
  // The homepage has its own product screenshot; existing tools retain their
  // original card, and shared circuit links keep the dynamic preview above.
  return {
    ...route,
    canonicalPath: targetPath === '/arena' ? '/arena/' : targetPath,
    image: route.image || '/og-image.png',
  };
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

  const renderLinks = (items) => items
    .filter((link) => link.path !== currentPath)
    .map((link) => `<li style="margin:0 0 .5rem"><a href="${escapeAttribute(link.path)}" style="color:#7dd3fc">${escapeAttribute(link.label)}</a></li>`)
    .join('');
  const links = renderLinks(CRAWL_LINKS);
  const experiments = meta.links
    ? `<section aria-label="Lab experiments"><ul>${renderLinks(meta.links)}</ul></section>`
    : '';
  const overflow = '<details><summary>More</summary><ul>' + renderLinks([
    { path: '/office', label: 'Review' },
    { path: '/evidence', label: 'Evidence' },
    { path: '/lab', label: 'Lab' },
  ]) + '</ul></details>';

  return '<main data-prerendered="1" style="max-width:44rem;margin:0 auto;padding:3rem 1.5rem;'
    + 'font-family:Inter,system-ui,sans-serif;color:#e2e8f0;background:#030308;line-height:1.6">'
    + `<h1 style="font-size:1.9rem;line-height:1.25;margin:0 0 1.25rem">${escapeAttribute(meta.heading)}</h1>`
    + paragraphs
    + experiments
    + `<nav aria-label="Sections"><ul style="list-style:none;padding:0;margin:2rem 0 0">${links}</ul>${overflow}</nav>`
    + '</main>';
}

export function applyRouteMeta(html, pathname, search = '', origin = '') {
  const meta = resolveRouteMeta(pathname, search);
  const title = escapeAttribute(meta.title);
  const description = escapeAttribute(meta.description);
  const url = origin ? escapeAttribute(`${origin.replace(/\/$/, '')}${meta.canonicalPath}`) : null;

  let out = html
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`)
    .replace(/(<meta\s+name="description"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${description}${close}`)
    .replace(/(<meta\s+property="og:title"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${title}${close}`)
    .replace(/(<meta\s+property="og:description"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${description}${close}`)
    .replace(/(<meta\s+name="twitter:title"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${title}${close}`)
    .replace(/(<meta\s+name="twitter:description"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${description}${close}`);

  if (url) {
    out = out
      .replace(/(<meta\s+property="og:url"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${url}${close}`)
      .replace(/(<link\s+rel="canonical"\s+href=")[\s\S]*?(")/, (_match, open, close) => `${open}${url}${close}`);
  }

  if (meta.image && origin) {
    const image = escapeAttribute(`${origin.replace(/\/$/, '')}${meta.image}`);
    out = out
      .replace(/(<meta\s+property="og:image"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${image}${close}`)
      .replace(/(<meta\s+name="twitter:image"\s+content=")[\s\S]*?(")/, (_match, open, close) => `${open}${image}${close}`);
  }

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'BusinessApplication',
    description: meta.description,
    url: origin ? `${origin.replace(/\/$/, '')}${meta.canonicalPath}` : undefined,
    operatingSystem: 'Web',
    isAccessibleForFree: true,
  }).replace(/</g, '\\u003c');
  out = out.replace(
    /(<script id="site-schema" type="application\/ld\+json">)[\s\S]*?(<\/script>)/,
    (_match, open, close) => `${open}${structuredData}${close}`,
  );

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
