// Per-route titles, crawler-readable copy and social previews.
// The server rewrites these before serving the SPA because most social scrapers
// do not execute JavaScript.

import { buildHoldoutReport } from './holdoutReport.js';

const SITE_NAME = 'BrainSNN';
const EVIDENCE = buildHoldoutReport();

/** Longest matching prefix wins, so dedicated routes stay distinct from `/`. */
const ROUTES = [
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
    path: '/toys/fly-brain',
    title: 'Feed the Fly Brain | BrainSNN',
    image: '/og/toy-fly.png',
    description:
      'Will the fly eat it? Feed sugar or bitter to a 2,621-neuron slice of the published FlyWire fruit-fly connectome and watch a simulated signal decide whether the feeding neuron fires.',
    heading: 'Will the fly eat it?',
    body: [
      'Feed the Fly Brain runs the Shiu et al. (Nature 2024) spiking model on a 2,621-neuron slice of the FlyWire fruit-fly connectome, in your browser. Give it sugar or bitter and watch whether MN9, the motor neuron that extends the proboscis to eat, starts firing.',
      'The wiring is real: neurons, positions and connections from FlyWire v783 (Dorkenwald et al. and Schlegel et al., Nature 2024). The activity is simulated — no fly was recorded — and the slice leaves out the rest of the brain.',
    ],
  },
  {
    path: '/missions',
    title: 'Proof Missions | BrainSNN',
    description:
      'Explore bounded objectives, explicit acceptance criteria and recorded attempts in the BrainSNN proof mission registry.',
    heading: 'Give useful work a measurable test.',
    body: [
      'Proof Missions define an objective, an environment, permitted actions and a judge. Attempts preserve evidence so a result can be reviewed against the conditions that were actually tested.',
      'The mission registry remains available as a tool within the BrainSNN working agent lab. A simulated or benchmark result is not a verified payment or accepted customer delivery.',
    ],
  },
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
      'It remains available as a research department within the BrainSNN agent lab. Simulation results describe their tested conditions; they do not establish customer demand or commercial success.',
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
    path: '/engine',
    title: 'Compare two drafts | BrainSNN Engine',
    description:
      'Compare original and candidate text with source hashes, exact evidence quotes and heuristic signal changes. Review the result or use the BrainSNN API and MCP tools.',
    heading: 'Compare a change. Keep its evidence.',
    body: [
      'Compare two drafts with BrainSNN’s local content detector. The engine returns source hashes, exact quote offsets and heuristic signal changes so each finding can be inspected against its input.',
      'Every comparison remains REVIEW_REQUIRED. A model-score change does not verify facts, predict market outcomes or establish an independently tested improvement.',
      'Agent builders can use POST /api/engine/compare and the brain_compare MCP tool for the same bounded comparison. This interface produces review evidence; it does not execute general agent work.',
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
    path: '/office',
    title: 'Agent office | BrainSNN',
    description:
      'Explore the BrainSNN agent-office concept, engine roadmap and recorded evidence from XIO’s separate operational experiment.',
    heading: 'An evidence engine for agent work.',
    body: [
      'BrainSNN brings content analysis, reviewed draft improvements, browser-local scan history and proof missions into one product. Start with a passage, page or screen recording, inspect the evidence, and make a change you can test.',
      'The public detector evaluation reports results on unseen passages, including missed cues and false alarms. Model scores are review signals, not measurements of a reader’s brain or predictions of market outcomes.',
      'The engine roadmap connects versioned, reusable context with independent tests and evidence-based resource allocation. This is planned integration, not a claim of autonomous learning already running.',
      'The office preserves a recorded window into XIO’s separate operational experiment. Its approved counts and events are not BrainSNN-wide engine metrics. Unknown results remain unavailable. Reconstruct, the Arcade and neural circuit simulations remain available as tools and research.',
    ],
  },
  {
    path: '/',
    title: 'BrainSNN | Sapient Playground',
    image: '/og/toy-poke.png',
    description:
      'Poke the brain and watch the signal travel. A jelly brain wrapped around a seven-region spiking model — then build a mind, give it a world, give it a mission.',
    heading: 'Poke the brain and watch the signal travel.',
    body: [
      'Poke, drag or shake a jelly brain. Every poke drives the seven-region spiking model BrainSNN’s analyzer runs on, and the signal travels its pathways. It is a simulation, not a recording of anyone’s brain.',
      'Then build a mind, give it a world, give it a mission: analyze content, compare two drafts with the deterministic comparison engine, or explore a proof mission.',
      'Inspect the detector’s published evaluation, including missed cues and false alarms. Model scores and simulation results describe their tested conditions; they do not establish universal capability.',
    ],
  },
];

const CRAWL_LINKS = Object.freeze([
  { path: '/', label: 'BrainSNN Sapient Playground' },
  { path: '/toys/fool-the-detector', label: 'Fool the Detector' },
  { path: '/toys/draft-duel', label: 'Draft Duel' },
  { path: '/toys/defend-the-brain', label: 'Defend the Brain' },
  { path: '/toys/fly-brain', label: 'Feed the Fly Brain' },
  { path: '/arcade', label: 'GaugeGap Arcade' },
  { path: '/lab', label: 'Neuro Powder Lab' },
  { path: '/app', label: 'Content analyzer' },
  { path: '/engine', label: 'Compare two drafts and use the engine API' },
  { path: '/missions', label: 'Proof missions' },
  { path: '/evidence', label: 'Held-out evaluation' },
  { path: '/reconstruct', label: 'Reconstruct a claim' },
  { path: '/office', label: 'Agent office' },
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
  // The homepage has its own product screenshot; existing tools retain their
  // original card, and shared circuit links keep the dynamic preview above.
  return { ...route, image: route.image || '/og-image.png' };
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
