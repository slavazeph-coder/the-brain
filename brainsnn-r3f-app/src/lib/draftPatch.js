// Draft patching — turning a diagnosis into an edited draft.
//
// The scan engine already knows which sentence is weak; until now that
// knowledge only ever reached the user as prose ("Move “…” before “…”"), so
// the person still had to do the edit by hand. This module performs the edit.
//
// Three rules shape the design:
//
//  1. A patch is addressed by SENTENCE TEXT, never by offset. Offsets go stale
//     the moment an earlier patch is applied; text lookup means patches can be
//     applied in any order, undone, and re-applied without a stale-index bug.
//     A patch whose anchor text is gone reports `applicable: false` instead of
//     editing the wrong sentence.
//
//  2. Paragraph structure survives. The scan pipeline flattens everything to
//     one line, which is fine for scoring and useless for a draft somebody is
//     about to send. Blocks are preserved and sentences only ever move within
//     their own block.
//
//  3. Every replacement must be grammatical in place — same part of speech,
//     works at a sentence start. A substitution that reads as machine-spliced
//     is worse than leaving the pressure language alone, so the table below is
//     deliberately short and skips tempting-but-unsafe swaps (`secret`,
//     `explode`, `guaranteed`) whose part of speech shifts with context.

const MAX_BLOCKS = 40;
const MAX_SENTENCES_PER_BLOCK = 60;
const MAX_PATCHES = 8;

// Mirrors analysisEngine's own detectors so a patch lines up with the
// recommendation the user is reading rather than describing a different edit.
const PROOF_PATTERN = /(\$\s?\d|\b\d+(?:\.\d+)?%|\b\d{2,}\b|customer|client|tested|measured|case study|benchmark|source|data|pilot|revenue|conversion|roas|ctr|cpc|cpa)/i;
const CTA_PATTERN = /\b(book|buy|reply|call|click|start|try|test|scan|compare|approve|apply|download|subscribe|sign up|schedule|send|share|publish|learn more|get started)\b/i;

// [phrase, replacement, category, why]. Replacements are same-part-of-speech
// and safe at a sentence start.
const PRESSURE_SWAPS = [
  [/\blast chance\b/i, 'final reminder', 'urgency', 'Scarcity framing without a stated deadline.'],
  [/\bact now\b/i, 'take a look', 'urgency', 'A command substitutes for a reason to act.'],
  [/\bact fast\b/i, 'take a look', 'urgency', 'A command substitutes for a reason to act.'],
  [/\bbefore it'?s too late\b/i, "while it's still open", 'urgency', 'Implied loss with no named deadline.'],
  [/\bdon'?t miss out\b/i, 'worth a look', 'urgency', 'Fear of missing out in place of a benefit.'],
  [/\byou must\b/i, 'you can', 'urgency', 'Obligation the reader has not agreed to.'],
  [/\bthey don'?t want you to know\b/i, 'that often gets overlooked', 'outrage', 'Conspiracy framing with no named actor.'],
  [/\beveryone is\b/i, 'many people are', 'certainty', 'Universal claim that cannot be checked.'],
  [/\bgame[- ]changer\b/i, 'meaningful improvement', 'vague', 'Broad praise with nothing measurable in it.'],
  [/\brevolutionary\b/i, 'notably different', 'vague', 'Broad praise with nothing measurable in it.'],
  [/\bworld[- ]class\b/i, 'well-tested', 'vague', 'Broad praise with nothing measurable in it.'],
  [/\bunprecedented\b/i, 'unusually strong', 'vague', 'Broad praise with nothing measurable in it.'],
  [/\bmassive\b/i, 'substantial', 'vague', 'Broad praise with nothing measurable in it.'],
  [/\binsane\b/i, 'unusually strong', 'vague', 'Broad praise with nothing measurable in it.'],
];

function collapseInline(value) {
  return String(value || '').replace(/[^\S\n]+/g, ' ').replace(/ *\n */g, ' ').trim();
}

/**
 * Canonical form of a pasted draft: inline whitespace collapsed, paragraph
 * breaks kept as a single blank line. This is the text every patch operates on
 * and the text the user copies back out, so it must stay readable.
 */
export function normalizeDraft(content) {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n+/)
    .map(collapseInline)
    .filter(Boolean)
    .slice(0, MAX_BLOCKS)
    .join('\n\n');
}

function splitSentences(block) {
  return (block.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [block])
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, MAX_SENTENCES_PER_BLOCK);
}

/**
 * Parse a draft into blocks of sentences. Unlike splitIntoSegments (which
 * returns bare strings for scoring) each sentence keeps the identity a patch
 * needs: which block it lives in and where it sits inside that block.
 */
export function locateSegments(content) {
  const draft = normalizeDraft(content);
  if (!draft) return [];
  const segments = [];
  draft.split('\n\n').forEach((block, blockIndex) => {
    splitSentences(block).forEach((text, indexInBlock) => {
      segments.push({
        id: `b${blockIndex}s${indexInBlock}`,
        text,
        blockIndex,
        indexInBlock,
        order: segments.length,
      });
    });
  });
  return segments;
}

function toBlocks(content) {
  const draft = normalizeDraft(content);
  if (!draft) return [];
  return draft.split('\n\n').map(splitSentences);
}

function joinBlocks(blocks) {
  return blocks
    .map((sentences) => sentences.join(' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function findSentence(blocks, text) {
  const wanted = collapseInline(text);
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const indexInBlock = blocks[blockIndex].findIndex((sentence) => sentence === wanted);
    if (indexInBlock !== -1) return { blockIndex, indexInBlock };
  }
  return null;
}

/**
 * Locate the sentence a phrase swap should edit.
 *
 * Exact-text lookup alone is too brittle here: two swaps can target the same
 * sentence ("a game-changer for massive teams"), and applying the first one
 * rewrites the anchor the second is holding. The phrase itself is the real
 * target, so fall back to it — first at the position the patch was built from,
 * then anywhere in the draft. A patch whose phrase is gone everywhere is
 * genuinely spent and reports not-applicable.
 */
function findPhraseSentence(blocks, patch, pattern) {
  const exact = findSentence(blocks, patch.source?.text);
  if (exact && pattern.test(blocks[exact.blockIndex][exact.indexInBlock])) return exact;

  const { blockIndex, indexInBlock } = patch.source || {};
  const atPosition = blocks[blockIndex]?.[indexInBlock];
  if (typeof atPosition === 'string' && pattern.test(atPosition)) return { blockIndex, indexInBlock };

  for (let block = 0; block < blocks.length; block += 1) {
    const index = blocks[block].findIndex((sentence) => pattern.test(sentence));
    if (index !== -1) return { blockIndex: block, indexInBlock: index };
  }
  return null;
}

function capitalize(text) {
  return text.replace(/^([a-z])/, (letter) => letter.toUpperCase());
}

/**
 * A sentence that ended the draft may have no terminal punctuation. Moving it
 * into the middle would run it into the next sentence, so give it a full stop
 * on the way. A sentence moving TO the end keeps whatever it had.
 */
function terminate(sentence) {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function tidyBlock(sentences) {
  return sentences.map((sentence, index) => {
    const settled = index === sentences.length - 1 ? sentence : terminate(sentence);
    return index === 0 ? capitalize(settled) : settled;
  });
}

function notApplicable(reason) {
  return { ok: false, applicable: false, reason, text: null };
}

function moveWithin(blocks, from, to) {
  const next = blocks.map((sentences) => [...sentences]);
  const block = next[from.blockIndex];
  const [moved] = block.splice(from.indexInBlock, 1);
  // Removing an earlier sentence shifts the destination left by one.
  const destination = from.indexInBlock < to ? to - 1 : to;
  block.splice(destination, 0, moved);
  next[from.blockIndex] = tidyBlock(block);
  return next;
}

/**
 * Apply one patch to a draft. Never throws: an anchor that no longer matches
 * (already applied, or the user edited that sentence) comes back as
 * `applicable: false` so the UI can grey the button instead of silently
 * corrupting the draft.
 */
export function applyPatch(content, patch) {
  const blocks = toBlocks(content);
  if (!blocks.length || !patch) return notApplicable('There is no draft to edit.');

  if (patch.kind === 'move-before') {
    const source = findSentence(blocks, patch.source?.text);
    const target = findSentence(blocks, patch.target?.text);
    if (!source || !target) return notApplicable('That sentence is no longer in the draft.');
    if (source.blockIndex !== target.blockIndex) {
      return notApplicable('Those sentences are now in different paragraphs.');
    }
    if (source.indexInBlock === target.indexInBlock - 1) {
      return notApplicable('The proof already sits directly before the ask.');
    }
    return { ok: true, applicable: true, reason: '', text: joinBlocks(moveWithin(blocks, source, target.indexInBlock)) };
  }

  if (patch.kind === 'move-to-open') {
    const source = findSentence(blocks, patch.source?.text);
    if (!source) return notApplicable('That sentence is no longer in the draft.');
    if (source.indexInBlock === 0) return notApplicable('That sentence already opens its paragraph.');
    return { ok: true, applicable: true, reason: '', text: joinBlocks(moveWithin(blocks, source, 0)) };
  }

  if (patch.kind === 'replace-phrase') {
    const pattern = new RegExp(patch.phrase, 'i');
    const found = findPhraseSentence(blocks, patch, pattern);
    if (!found) return notApplicable('That phrase is already gone.');
    const sentence = blocks[found.blockIndex][found.indexInBlock];
    const replaced = sentence.replace(pattern, (match, ...rest) => {
      const offset = rest[rest.length - 2];
      // Keep the sentence's opening capital when the swap lands at position 0.
      return offset === 0 ? capitalize(patch.replacement) : patch.replacement;
    });
    const next = blocks.map((sentences) => [...sentences]);
    next[found.blockIndex][found.indexInBlock] = replaced;
    return { ok: true, applicable: true, reason: '', text: joinBlocks(next) };
  }

  return notApplicable('Unknown patch type.');
}

/**
 * Apply patches in sequence, skipping any that stopped being applicable along
 * the way. Returns the final text plus a per-patch outcome so the UI can say
 * exactly what it changed rather than claiming a blanket success.
 */
export function applyPatches(content, patches = []) {
  let text = normalizeDraft(content);
  const outcomes = [];
  for (const patch of patches) {
    const result = applyPatch(text, patch);
    if (result.ok) text = result.text;
    outcomes.push({ id: patch.id, applied: result.ok, reason: result.reason });
  }
  return { text, outcomes, appliedCount: outcomes.filter((outcome) => outcome.applied).length };
}

function patch(id, kind, fields) {
  return { id, kind, ...fields };
}

/**
 * Derive every concrete edit available for a draft.
 *
 * This runs against the draft text alone, not against the recommendation list,
 * which matters: the hosted model path returns recommendations as plain
 * strings with no anchor, so a plan derived from recommendations would vanish
 * whenever the model was reachable. Deriving it from the text means the fixes
 * are always there, always deterministic, and identical offline.
 */
export function buildPatchPlan(content) {
  const draft = normalizeDraft(content);
  const segments = locateSegments(draft);
  if (!segments.length) return { draft, segments: [], patches: [] };

  const patches = [];

  const proof = segments.find((segment) => PROOF_PATTERN.test(segment.text));
  const cta = segments.find((segment) => CTA_PATTERN.test(segment.text) && segment.text !== proof?.text);

  if (proof && cta && proof.blockIndex === cta.blockIndex && proof.indexInBlock > cta.indexInBlock) {
    patches.push(patch('move-proof-to-ask', 'move-before', {
      label: 'Move the proof in front of the ask',
      detail: 'The reader currently meets the request before the reason to believe it.',
      category: 'structure',
      source: { text: proof.text },
      target: { text: cta.text },
    }));
  } else if (proof && proof.indexInBlock > 0 && !cta) {
    patches.push(patch('lead-with-proof', 'move-to-open', {
      label: 'Open with the strongest evidence',
      detail: 'The most concrete line in the draft is buried behind softer copy.',
      category: 'structure',
      source: { text: proof.text },
    }));
  }

  for (const segment of segments) {
    for (const [pattern, replacement, category, why] of PRESSURE_SWAPS) {
      const match = segment.text.match(pattern);
      if (!match) continue;
      patches.push(patch(`swap-${category}-${segment.id}-${collapseInline(match[0]).toLowerCase().replace(/\W+/g, '-')}`, 'replace-phrase', {
        label: `Replace “${match[0]}” with “${replacement}”`,
        detail: why,
        category,
        phrase: pattern.source,
        replacement,
        source: { text: segment.text, blockIndex: segment.blockIndex, indexInBlock: segment.indexInBlock },
      }));
      if (patches.length >= MAX_PATCHES) break;
    }
    if (patches.length >= MAX_PATCHES) break;
  }

  return { draft, segments, patches: patches.slice(0, MAX_PATCHES) };
}

/**
 * Which patches still apply to the draft in its current state. The UI calls
 * this after every edit so a button never offers an edit that would fail.
 */
export function usablePatches(content, patches = []) {
  return patches.filter((entry) => applyPatch(content, entry).ok);
}
