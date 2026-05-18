/**
 * Layer 103 — Social Post Autopsy
 *
 * Instagram / TikTok / X / LinkedIn style post analysis built on top of
 * existing BrainSNN primitives:
 *   - Layer 4/39 Cognitive Firewall + propaganda templates
 *   - Layer 29 Affective Trigger Decoder
 *   - Layer 58 OCR handoff, via the panel
 *   - Layer 84 Scan Archive, via the panel
 *   - Layer 87 Genre Classifier
 *
 * The goal is not just "is this manipulative?" It answers:
 *   "What feeling is this post trying to install, which viral mechanics are
 *   carrying it, and where in the carousel does the pressure spike?"
 */

import { scoreContent } from './cognitiveFirewall';
import { decodeAffects } from './affectiveDecoder';
import { classifyGenre } from './genreClassifier';

export const SAMPLE_SOCIAL_POST = {
  url: 'https://www.instagram.com/p/example/',
  caption:
    'Nobody is talking about this because the system benefits when you stay distracted. Save this before it disappears. Part 2 tomorrow.',
  slidesText:
    'Slide 1: The pattern hiding in plain sight\n\n---\n\nSlide 2: First they call it a coincidence. Then they call it normal. Then they make you pay for opting out.\n\n---\n\nSlide 3: If you understand this, you are already ahead of 99% of people.\n\n---\n\nSlide 4: Comment EYES and I will send you the full breakdown.'
};

export const PLATFORM_HINTS = [
  { id: 'instagram', label: 'Instagram', hosts: ['instagram.com', 'instagr.am'] },
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com'] },
  { id: 'x', label: 'X / Twitter', hosts: ['x.com', 'twitter.com'] },
  { id: 'linkedin', label: 'LinkedIn', hosts: ['linkedin.com'] },
  { id: 'youtube', label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
  { id: 'facebook', label: 'Facebook', hosts: ['facebook.com', 'fb.watch'] },
  { id: 'unknown', label: 'Social post', hosts: [] }
];

export const VIRAL_MECHANICS = [
  {
    id: 'curiosity-gap',
    label: 'Curiosity gap',
    desc: 'Withholds the answer so the viewer keeps swiping or clicking.',
    patterns: [/\bwhat (?:they|nobody|no one) (?:don'?t|won'?t) tell you\b/i, /\bthe truth about\b/i, /\bhidden in plain sight\b/i, /\byou won'?t believe\b/i]
  },
  {
    id: 'hidden-truth',
    label: 'Hidden-truth frame',
    desc: 'Flatters the reader as one of the few people awake to a suppressed pattern.',
    patterns: [/\bthey don'?t want you to know\b/i, /\bthe system\b/i, /\bwake up\b/i, /\bopen your eyes\b/i, /\bwhat is really going on\b/i]
  },
  {
    id: 'identity-sorting',
    label: 'Identity sorting',
    desc: 'Divides viewers into the awake/smart group versus the fooled group.',
    patterns: [/\b99% of people\b/i, /\bmost people (?:don'?t|will never)\b/i, /\bif you understand this\b/i, /\bonly (?:the )?(?:smart|awake|chosen|aware)\b/i]
  },
  {
    id: 'urgency-save',
    label: 'Save-before-it-vanishes',
    desc: 'Uses possible disappearance or censorship to force saving/sharing.',
    patterns: [/\bsave this\b/i, /\bbefore (?:it|this) disappears\b/i, /\bthis will be deleted\b/i, /\bthey'?ll take this down\b/i, /\bscreenshot this\b/i]
  },
  {
    id: 'outrage-hook',
    label: 'Outrage hook',
    desc: 'Creates a moral spike before evidence has been established.',
    patterns: [/\bscandal\b/i, /\bbetray(?:ed|al)?\b/i, /\bdisgusting\b/i, /\byou should be furious\b/i, /\bthis is insane\b/i]
  },
  {
    id: 'fear-hook',
    label: 'Fear hook',
    desc: 'Raises threat before giving the viewer a grounded next step.',
    patterns: [/\byour (?:family|kids|future|safety)\b/i, /\bat risk\b/i, /\bdanger\b/i, /\bcollapse\b/i, /\btoo late\b/i]
  },
  {
    id: 'authority-without-citation',
    label: 'Authority without receipt',
    desc: 'Leans on experts, studies, or insiders without giving a checkable source.',
    patterns: [/\bexperts? (?:say|warn|agree|confirm)\b/i, /\bstudies? show\b/i, /\binsiders? reveal\b/i, /\baccording to (?:top|leading)\b/i]
  },
  {
    id: 'comment-bait',
    label: 'Comment bait',
    desc: 'Turns the comment section into the conversion step.',
    patterns: [/\bcomment\b/i, /\bdrop (?:a|the)\b/i, /\btype (?:yes|info|me|done|eyes)\b/i, /\bi'?ll send you\b/i, /\bdm me\b/i]
  },
  {
    id: 'serial-cliffhanger',
    label: 'Serial cliffhanger',
    desc: 'Breaks the claim into future parts to harvest return attention.',
    patterns: [/\bpart\s*\d+\b/i, /\bpart two\b/i, /\btomorrow\b/i, /\bfollow for (?:more|part)\b/i, /\bnext post\b/i]
  },
  {
    id: 'before-after',
    label: 'Before / after promise',
    desc: 'Promises identity change, hidden advantage, or transformation.',
    patterns: [/\bbefore and after\b/i, /\bthis changed everything\b/i, /\bonce you see it\b/i, /\byou can'?t unsee\b/i, /\bnever look at .* the same\b/i]
  }
];

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function countPatternHits(text, patterns) {
  let hits = 0;
  const examples = new Set();
  for (const re of patterns) {
    const matches = text.match(re);
    if (matches) {
      hits += matches.length || 1;
      for (const m of matches.slice(0, 2)) examples.add(String(m).slice(0, 80));
    }
  }
  return { hits, examples: [...examples].slice(0, 3) };
}

export function detectPlatform(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return PLATFORM_HINTS.at(-1);
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return PLATFORM_HINTS.find((p) => p.hosts.some((h) => host.endsWith(h))) || PLATFORM_HINTS.at(-1);
  } catch {
    return PLATFORM_HINTS.at(-1);
  }
}

export function extractHandle({ url = '', caption = '' } = {}) {
  const captionHandle = String(caption).match(/(^|\s)@([a-z0-9_.-]{2,32})/i)?.[2];
  if (captionHandle) return `@${captionHandle}`;
  try {
    const parsed = new URL(String(url).startsWith('http') ? url : `https://${url}`);
    const first = parsed.pathname.split('/').filter(Boolean)[0];
    if (first && !['p', 'reel', 'reels', 'posts', 'status', 'video', 'watch'].includes(first.toLowerCase())) {
      return first.startsWith('@') ? first : `@${first}`;
    }
  } catch {
    // noop
  }
  return '';
}

export function splitSlides(slidesText = '') {
  const raw = String(slidesText || '').trim();
  if (!raw) return [];
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');

  const labeled = [...normalized.matchAll(/(?:^|\n)\s*(?:slide|page|panel)\s*(\d+)\s*[:.)-]\s*([\s\S]*?)(?=(?:\n\s*(?:slide|page|panel)\s*\d+\s*[:.)-])|$)/gi)];
  const chunks = labeled.length >= 2
    ? labeled.map((m) => m[2])
    : normalized.split(/\n\s*(?:---+|===+|\*\*\*+)\s*\n/g);

  return chunks
    .map((text, idx) => ({
      index: idx + 1,
      text: String(text || '').trim(),
      title: firstUsefulLine(text),
      wordCount: String(text || '').trim().split(/\s+/).filter(Boolean).length
    }))
    .filter((s) => s.text.length > 0);
}

function firstUsefulLine(text = '') {
  const line = String(text).split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
  return line.replace(/^slide\s*\d+\s*[:.)-]\s*/i, '').slice(0, 90) || 'Untitled slide';
}

export function detectViralMechanics(text = '') {
  const normalized = String(text || '');
  return VIRAL_MECHANICS
    .map((m) => {
      const hit = countPatternHits(normalized, m.patterns);
      return {
        id: m.id,
        label: m.label,
        desc: m.desc,
        hits: hit.hits,
        examples: hit.examples,
        strength: clamp(hit.hits / 3)
      };
    })
    .filter((m) => m.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.label.localeCompare(b.label));
}

function pressureOf(score) {
  return clamp(((score?.emotionalActivation || 0) + (score?.cognitiveSuppression || 0) + (score?.manipulationPressure || 0)) / 3);
}

function pressureTier(pressure, mechanicsCount) {
  const adjusted = clamp(pressure + Math.min(0.18, mechanicsCount * 0.025));
  if (adjusted >= 0.72) return { id: 'red', label: 'High-pressure viral frame', color: '#dd6974' };
  if (adjusted >= 0.45) return { id: 'amber', label: 'Persuasive / attention-engineered', color: '#fdab43' };
  if (adjusted >= 0.22) return { id: 'yellow', label: 'Mild influence pattern', color: '#d7c54f' };
  return { id: 'green', label: 'Low-pressure post', color: '#6daa45' };
}

function inferIntent({ firewall, affect, mechanics, genre }) {
  const dominant = affect?.dominant?.[0];
  const topMechanic = mechanics?.[0];
  const primaryGenre = genre?.primary?.label;
  const feeling = dominant?.label?.toLowerCase() || 'attention';
  const carrier = topMechanic?.label?.toLowerCase() || 'plain framing';
  return `Installs ${feeling} through ${carrier}${primaryGenre ? ` inside a ${primaryGenre.toLowerCase()} shell` : ''}. Pressure is ${Math.round(pressureOf(firewall) * 100)}%.`;
}

function buildRecommendations(report) {
  const recs = [];
  const pressure = pressureOf(report.firewall);
  if (pressure >= 0.5) recs.push('Pause before sharing; separate the claim from the emotional trigger.');
  if (report.mechanics.some((m) => m.id === 'authority-without-citation')) recs.push('Ask for the primary source, not “experts say” framing.');
  if (report.mechanics.some((m) => m.id === 'hidden-truth')) recs.push('Check whether “hidden truth” language is replacing evidence with identity flattery.');
  if (report.mechanics.some((m) => m.id === 'comment-bait')) recs.push('Treat the comment/DM step as a conversion funnel, not neutral discussion.');
  if (report.slides.some((s) => s.pressure >= 0.6)) recs.push(`Slide ${report.slides.sort((a, b) => b.pressure - a.pressure)[0].index} carries the biggest pressure spike.`);
  if (recs.length === 0) recs.push('Pressure is low; still verify any factual claim before reposting.');
  return recs.slice(0, 5);
}

export function analyzeSocialPost({ url = '', caption = '', slidesText = '' } = {}) {
  const slides = splitSlides(slidesText);
  const platform = detectPlatform(url);
  const handle = extractHandle({ url, caption });
  const combinedText = [caption, ...slides.map((s) => s.text)].filter(Boolean).join('\n\n');
  const fallbackText = combinedText || url || '';
  const firewall = scoreContent(fallbackText);
  const affect = decodeAffects(fallbackText);
  const genre = classifyGenre(fallbackText);
  const mechanics = detectViralMechanics(fallbackText);
  const tier = pressureTier(pressureOf(firewall), mechanics.length);

  const slideReports = slides.map((slide) => {
    const slideScore = scoreContent(slide.text);
    const slideAffect = decodeAffects(slide.text);
    const slideMechanics = detectViralMechanics(slide.text);
    return {
      ...slide,
      pressure: +pressureOf(slideScore).toFixed(3),
      dominantAffect: slideAffect?.dominant?.[0]?.label || 'Neutral',
      mechanics: slideMechanics.slice(0, 3).map((m) => m.label),
      evidence: slideScore.evidence || []
    };
  });

  const report = {
    platform,
    handle,
    url: String(url || '').trim(),
    caption: String(caption || '').trim(),
    combinedText: fallbackText,
    firewall,
    affect,
    genre,
    mechanics,
    slides: slideReports,
    pressure: +pressureOf(firewall).toFixed(3),
    tier,
    viewerInstall: '',
    recommendations: [],
    generatedAt: new Date().toISOString()
  };
  report.viewerInstall = inferIntent(report);
  report.recommendations = buildRecommendations(report);
  return report;
}

export function buildSocialPostReport(report) {
  if (!report) return '';
  const dominant = report.affect?.dominant?.map((a) => `${a.label} ${Math.round(a.score * 100)}%`).join(', ') || 'Neutral';
  const mechanics = report.mechanics.map((m) => `${m.label} (${m.hits})`).join(', ') || 'None detected';
  const templates = (report.firewall?.templates || []).map((t) => t.label || t.id).join(', ') || 'None detected';
  const slideLines = report.slides.length
    ? report.slides.map((s) => `- Slide ${s.index}: ${Math.round(s.pressure * 100)}% · ${s.dominantAffect}${s.mechanics.length ? ` · ${s.mechanics.join(', ')}` : ''}`).join('\n')
    : '- No slide text supplied.';
  return [
    `BrainSNN Social Post Autopsy`,
    `Platform: ${report.platform.label}${report.handle ? ` · ${report.handle}` : ''}`,
    `Verdict: ${report.tier.label}`,
    `Pressure: ${Math.round(report.pressure * 100)}%`,
    `Viewer install: ${report.viewerInstall}`,
    `Dominant affect: ${dominant}`,
    `Viral mechanics: ${mechanics}`,
    `Propaganda templates: ${templates}`,
    '',
    'Carousel pressure map:',
    slideLines,
    '',
    'Recommended checks:',
    ...report.recommendations.map((r) => `- ${r}`)
  ].join('\n');
}
