/**
 * Layer 39 — Propaganda Templates
 *
 * Named manipulation techniques with regex signatures. Extends the
 * Cognitive Firewall from "how much pressure" to "which named technique
 * is doing the pressing."
 *
 * Each template is small (2–4 patterns) so false positives are low and
 * names come from the classical rhetoric / persuasion / social-psych
 * canon — the kind of label a smart reader can verify.
 */

export const TEMPLATES = [
  {
    id: 'gaslighting',
    label: 'Gaslighting',
    desc: "Denies the target's reality to erode self-trust.",
    patterns: [
      /\byou\'?re (?:imagining|overreacting|being (?:crazy|paranoid|too sensitive)|making (?:it|this|that) up)\b/i,
      /\bthat (?:never )?happened\b|\bi never said that\b/i,
      /\byou always (?:twist|exaggerate)\b/i,
    ],
  },
  {
    id: 'darvo',
    label: 'DARVO',
    desc: 'Deny, Attack, Reverse Victim & Offender.',
    patterns: [
      /\b(?:actually|really) (?:you|they) are the (?:one|victim|abuser|problem)\b/i,
      /\bi\'?m the (?:real )?victim here\b/i,
      /\bhow dare you accuse (?:me|us)\b/i,
    ],
  },
  {
    id: 'love-bombing',
    label: 'Love bombing',
    desc: 'Overwhelming flattery early to install loyalty.',
    patterns: [
      /\byou\'?re the (?:most|best|only) (?:amazing|incredible|brilliant|perfect)\b/i,
      /\bi\'?ve never (?:felt|met|had) (?:anything|anyone) like (?:you|this)\b/i,
      /\bwe\'?re soul ?mates\b|\bmade for each other\b/i,
    ],
  },
  {
    id: 'scarcity',
    label: 'Scarcity',
    desc: 'Invents artificial rarity to force a decision.',
    patterns: [
      /\bonly (?:\d+ )?(?:spots?|seats?|slots?|left|remaining)\b/i,
      /\blast chance\b|\bbefore it\'?s too late\b|\boffer ends (?:in|soon)\b/i,
      /\blimited (?:time|edition|supply|quantity|offer)\b/i,
    ],
  },
  {
    id: 'social-proof',
    label: 'Social proof',
    desc: 'Points to a crowd to bypass the reader\'s own judgment.',
    patterns: [
      /\beveryone (?:is|\'?s) (?:switching|using|buying|doing)\b/i,
      /\b(?:thousands|millions) of (?:people|users|customers) (?:already|now)\b/i,
      /\b(?:9 out of 10|most) (?:people|experts|doctors) agree\b/i,
    ],
  },
  {
    id: 'authority',
    label: 'Authority name-drop',
    desc: 'Invokes a credentialed figure with no citation.',
    patterns: [
      /\b(?:experts?|scientists?|doctors?|studies?) (?:agree|confirm|say|warn)\b/i,
      /\baccording to (?:top|leading) (?:experts?|researchers?)\b/i,
      /\bscientifically proven\b/i,
    ],
  },
  {
    id: 'loaded-question',
    label: 'Loaded question',
    desc: 'A question that smuggles a guilty premise.',
    patterns: [
      /\bwhy do you (?:keep|always|still) (?:lie|hide|deny|ignore)\b/i,
      /\bwhen did you (?:stop|start) (?:lying|cheating|hurting|hating)\b/i,
      /\bhave you finally admitted\b/i,
    ],
  },
  {
    id: 'straw-man',
    label: 'Straw man',
    desc: 'Distorts the counter-position so it\'s easier to attack.',
    patterns: [
      /\bso (?:you\'?re saying|what you mean is|your argument is) that we should (?:all|just)\b/i,
      /\boh so (?:now )?(?:nobody|everyone|we all)\b/i,
    ],
  },
  {
    id: 'whataboutism',
    label: 'Whataboutism',
    desc: 'Deflects a critique by pivoting to an unrelated grievance.',
    patterns: [
      /\bwhat about (?:when|the time|all the times)\b/i,
      /\bbut (?:what|how) about (?:the )?(?:other side|them|you)\b/i,
    ],
  },
  {
    id: 'false-dichotomy',
    label: 'False dichotomy',
    desc: 'Collapses the option space to two extremes.',
    patterns: [
      /\beither (?:you\'?re|we\'?re) (?:with us|against us|one of us|on our side)\b/i,
      /\b(?:only|just) (?:two|2) (?:choices|options|sides)\b/i,
      /\bthere is no (?:middle|other) (?:ground|option)\b/i,
    ],
  },
  {
    id: 'fear-appeal',
    label: 'Fear appeal',
    desc: 'Dramatizes catastrophic consequences to force compliance.',
    patterns: [
      /\bif you don\'?t (?:act|buy|sign|decide) now\b/i,
      /\b(?:catastrophic|devastating|disastrous) (?:consequences|outcome|result)\b/i,
      /\byour (?:family|children|future|safety) (?:is|are) at (?:risk|stake)\b/i,
    ],
  },
  {
    id: 'hidden-truth',
    label: 'Hidden-truth conspiracy',
    desc: 'Flatters the reader for being "awake" to a suppressed fact.',
    patterns: [
      /\bthey don\'?t want you to know\b/i,
      /\b(?:what|the truth) (?:they|the media|the government) (?:is hiding|doesn\'?t want|covered up)\b/i,
      /\bwake up\b|\bopen your eyes\b/i,
    ],
  },
  {
    id: 'moral-outrage',
    label: 'Moral outrage bait',
    desc: 'Frames the message as unmissable moral duty.',
    patterns: [
      /\bif you\'?re not (?:furious|outraged|angry|disgusted)(?: you\'?re)?\b/i,
      /\bsilence is (?:violence|complicity)\b/i,
      /\byou should be (?:ashamed|disgusted|horrified)\b/i,
    ],
  },
  {
    id: 'purity-test',
    label: 'Purity test',
    desc: 'Demands perfect ideological alignment as a condition of trust.',
    patterns: [
      /\breal (?:allies|patriots|leftists|conservatives) (?:would|don\'?t|always)\b/i,
      /\bif you truly (?:cared|believed|stood with)\b/i,
      /\byou\'?re (?:no|not a) (?:real|true) (?:ally|friend|supporter)\b/i,
    ],
  },
  {
    id: 'guilt-trip',
    label: 'Guilt trip',
    desc: 'Loads shame to steer behavior.',
    patterns: [
      /\bafter (?:all|everything) (?:i|we|they)\'?ve done for you\b/i,
      /\byou\'?re (?:selfish|ungrateful|a bad)\b/i,
      /\bi (?:guess|suppose) i\'?ll just\b/i,
    ],
  },
];

/**
 * Run text against every template; return an array of matches with
 * which patterns fired.
 */
export function detectTemplates(text = '') {
  const lower = (text || '').toLowerCase();
  if (lower.length < 12) return [];
  const out = [];
  for (const tpl of TEMPLATES) {
    let hits = 0;
    for (const re of tpl.patterns) {
      const m = text.match(re);
      if (m) hits += m.length || 1;
    }
    if (hits > 0) {
      out.push({ id: tpl.id, label: tpl.label, desc: tpl.desc, hits });
    }
  }
  return out.sort((a, b) => b.hits - a.hits);
}
