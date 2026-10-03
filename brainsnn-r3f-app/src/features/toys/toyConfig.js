// The toy registry: one place that knows every toy's route, hook, share
// source tag and sponsor slot.
//
// Pure and DOM-free so the bare-Node runner covers it. Everything a toy says
// about itself in a caption, a card or a crawler preview comes from here, so a
// hook cannot drift between the homepage row, the share caption and the OG
// card.

export const SITE_ORIGIN = 'https://www.brainsnn.com';
export const WATERMARK = 'brainsnn.com';

/**
 * Share-source tags ride on every shared link as `?src=`. attribution.js reads
 * `src` as an alias of its own short `s` param, so a visit that arrives through
 * a shared clip is attributed to the toy that produced it.
 */
export const SHARE_SOURCE_PARAM = 'src';

export const TOYS = Object.freeze([
  {
    id: 'poke',
    number: '01',
    title: 'Poke the Brain',
    hook: 'poke the brain and watch the signal travel',
    blurb: 'A jelly brain wrapped around a seven-region spiking model. Poke it, drag it, shake it.',
    path: '/',
    shareSource: 'toy1-share',
    cta: 'Poke it',
  },
  {
    id: 'fool',
    number: '02',
    title: 'Fool the Detector',
    hook: 'can you fool our AI detector?',
    blurb: 'Five rounds. Slip a manipulation trick past a detector whose blind spots are published.',
    path: '/toys/fool-the-detector',
    shareSource: 'toy2-share',
    cta: 'Try to fool it',
  },
  {
    id: 'duel',
    number: '03',
    title: 'Draft Duel',
    hook: 'make two drafts fight',
    blurb: 'Paste two versions. Watch them trade blows on trust, calm, warmth and more.',
    path: '/toys/draft-duel',
    shareSource: 'toy3-share',
    cta: 'Start a fight',
  },
  {
    id: 'defend',
    number: '04',
    title: 'Defend the Brain',
    hook: 'can you keep the brain from getting hijacked?',
    blurb: 'Persuasion packets from real text attack a live brain model. Cut, silence, boost — hold the line.',
    path: '/toys/defend-the-brain',
    shareSource: 'toy4-share',
    cta: 'Hold the line',
  },
  {
    id: 'fly',
    number: '05',
    title: 'Feed the Fly Brain',
    hook: 'will the fly eat it?',
    blurb: 'A 2,621-neuron slice of a real fruit fly’s wiring, simulated. Give it sugar or bitter and watch it decide.',
    path: '/toys/fly-brain',
    shareSource: 'toy5-share',
    cta: 'Feed it',
  },
]);

const BY_ID = new Map(TOYS.map((toy) => [toy.id, toy]));

export function getToy(id) {
  return BY_ID.get(id) || null;
}

/** The toys shown in the "More toys" row — every toy except the one you are on. */
export function otherToys(currentId) {
  return TOYS.filter((toy) => toy.id !== currentId);
}

/**
 * Canonical share link for a toy, tagged with its share source.
 * Extra params (a challenge state, say) are preserved; `src` always wins.
 */
export function toyShareUrl(id, { origin = SITE_ORIGIN, params = {} } = {}) {
  const toy = getToy(id);
  if (!toy) throw new TypeError(`Unknown toy: ${id}`);
  const url = new URL(toy.path, origin);
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set(SHARE_SOURCE_PARAM, toy.shareSource);
  return url.toString();
}

/**
 * The caption a share button copies. Hook first, the result (if any) second,
 * the link last — so a caption truncated by a platform still carries the hook.
 */
export function toyCaption(id, { result = '', origin = SITE_ORIGIN, params } = {}) {
  const toy = getToy(id);
  if (!toy) throw new TypeError(`Unknown toy: ${id}`);
  const hook = toy.hook.charAt(0).toUpperCase() + toy.hook.slice(1);
  const lines = [hook];
  const trimmed = String(result || '').trim();
  if (trimmed) lines.push(trimmed);
  lines.push(toyShareUrl(id, { origin, params }));
  return lines.join('\n');
}

/** A filesystem-safe download name, stable per toy and kind. */
export function toyFileName(id, kind, extension) {
  const safeKind = String(kind || 'share').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'share';
  const safeExt = String(extension || 'png').replace(/^\./, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return `brainsnn-${id}-${safeKind}.${safeExt}`;
}

// --- Sponsor inventory -------------------------------------------------------
//
// Every toy carries a "brought to you by" slot and every recorded clip an outro
// frame. They are wired and deliberately empty: a slot renders nothing until a
// sponsor is added here, so an empty slot never shows a placeholder to visitors.
// To sell a slot, add an entry keyed by toy id (or `all`) with a name and, if
// the sponsor wants one, a URL. Nothing else needs to change.
export const SPONSORS = Object.freeze({
  // all: { name: 'Example Co.', url: 'https://example.com' },
});

export function sponsorFor(id, sponsors = SPONSORS) {
  const entry = sponsors?.[id] || sponsors?.all || null;
  if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) return null;
  let url = null;
  if (typeof entry.url === 'string') {
    try {
      const parsed = new URL(entry.url);
      if (parsed.protocol === 'https:') url = parsed.toString();
    } catch {
      url = null;
    }
  }
  return { name: entry.name.trim().slice(0, 60), url };
}
