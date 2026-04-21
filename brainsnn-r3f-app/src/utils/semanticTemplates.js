/**
 * Layer 45 — Semantic Template Matching
 *
 * Layer 39 matches propaganda templates via regex. That catches the
 * literal phrasing and nothing else. Layer 45 uses MiniLM embeddings
 * (Layer 24's transformers.js pipeline) to match templates by meaning:
 * "you're making it up" lands in the same semantic neighborhood as
 * "that never happened" even if the regex misses.
 *
 * For each template we seed 2–3 canonical phrases. At scan time we
 * embed the input text, embed the seeds once (cached), and report the
 * highest cosine-similarity match per template.
 *
 * Fast path: skips entirely if embeddings aren't ready. The regex
 * layer (Layer 39) is always active; this layer only adds coverage.
 */

import { embed, isReady, cosineSimilarity } from './embeddings';
import { TEMPLATES } from './propagandaTemplates';

// Canonical semantic seeds per template — paraphrased versions a regex
// would miss. Seed 2-3 per technique. Short strings so embedding is fast.
const SEMANTIC_SEEDS = {
  gaslighting: [
    'you are making this up in your head',
    'that is not how it happened at all',
    'you have a bad memory',
  ],
  darvo: [
    'I am the one being hurt here',
    'you are really the abuser in this',
    'I cannot believe you would accuse me',
  ],
  'love-bombing': [
    'you are unlike anyone I have ever known',
    'we share something that cannot be described',
    'this is the deepest connection of my life',
  ],
  scarcity: [
    'the window to act is closing',
    'availability is running out quickly',
    'after this it will not come back',
  ],
  'social-proof': [
    'everyone you know is already on board',
    'the overwhelming majority is choosing this',
    'a huge number of people have moved to this',
  ],
  authority: [
    'the top researchers agree on this',
    'the consensus of experts supports this',
    'credentialed professionals back this up',
  ],
  'loaded-question': [
    'when exactly did you stop caring',
    'how long have you been hiding this',
    'why are you still denying the obvious',
  ],
  'straw-man': [
    'your position seems to be that we should do nothing',
    'so your idea is to abandon everything',
    'you want total chaos apparently',
  ],
  whataboutism: [
    'and what about the times the other side did worse',
    'this is small compared to that other situation',
    'focus on their failures before mine',
  ],
  'false-dichotomy': [
    'we must pick between these two paths only',
    'anything else is impossible',
    'there is no third choice here',
  ],
  'fear-appeal': [
    'disaster will follow if you delay',
    'the worst outcome is right around the corner',
    'you will regret waiting on this',
  ],
  'hidden-truth': [
    'the story you have been told is a lie',
    'the real facts are being suppressed',
    'you should not be seeing what they let you see',
  ],
  'moral-outrage': [
    'if you are calm you do not care',
    'apathy here is indistinguishable from wrongdoing',
    'staying quiet is choosing the wrong side',
  ],
  'purity-test': [
    'a genuine supporter would never question this',
    'only a fake would ask these kinds of questions',
    'real believers accept this without hesitation',
  ],
  'guilt-trip': [
    'after everything I have sacrificed for you',
    'I suppose I deserve to be forgotten again',
    'I will just bear this alone as always',
  ],
};

// Lazy-loaded embedding cache. Keys are template IDs → Float32Array of
// averaged seed embeddings. Computed once per session on first use.
let _seedEmbeddings = null;
let _seedPromise = null;

function meanEmbedding(vectors) {
  if (!vectors.length) return [];
  const len = vectors[0].length;
  const out = new Float32Array(len);
  for (const v of vectors) for (let i = 0; i < len; i++) out[i] += v[i];
  for (let i = 0; i < len; i++) out[i] /= vectors.length;
  // Re-normalize
  let norm = 0;
  for (let i = 0; i < len; i++) norm += out[i] * out[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < len; i++) out[i] /= norm;
  return Array.from(out);
}

async function ensureSeedEmbeddings() {
  if (_seedEmbeddings) return _seedEmbeddings;
  if (_seedPromise) return _seedPromise;
  _seedPromise = (async () => {
    const out = {};
    for (const [id, seeds] of Object.entries(SEMANTIC_SEEDS)) {
      const vecs = [];
      for (const s of seeds) {
        try { vecs.push(await embed(s)); } catch { /* skip */ }
      }
      if (vecs.length) out[id] = meanEmbedding(vecs);
    }
    _seedEmbeddings = out;
    return out;
  })();
  return _seedPromise;
}

const TEMPLATE_BY_ID = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

/**
 * Returns [{id,label,desc,similarity}] for templates whose semantic
 * similarity exceeds the threshold. Sorted by similarity desc.
 *
 * Threshold tuned so incidental overlap (a fear headline vs the
 * gaslighting seed) stays out. 0.42 is the sweet spot for MiniLM
 * on short English phrases in practice.
 */
export async function matchSemanticTemplates(text, threshold = 0.42) {
  if (!text || text.trim().length < 12) return [];
  if (!isReady()) return [];
  let textVec;
  try {
    textVec = await embed(text.slice(0, 600));
  } catch {
    return [];
  }
  const seeds = await ensureSeedEmbeddings();
  const out = [];
  for (const [id, seedVec] of Object.entries(seeds)) {
    const sim = cosineSimilarity(textVec, seedVec);
    if (sim >= threshold) {
      const meta = TEMPLATE_BY_ID[id];
      out.push({
        id,
        label: meta?.label || id,
        desc: meta?.desc || '',
        similarity: +sim.toFixed(3),
      });
    }
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out.slice(0, 5);
}

/**
 * Merge regex hits (from scoreContent().templates) with semantic hits.
 * Regex hits keep their numeric `hits` field; semantic hits keep their
 * `similarity` field. Deduped by id with regex preferred when both fire.
 */
export function mergeTemplateResults(regexHits = [], semanticHits = []) {
  const byId = new Map();
  for (const h of regexHits) byId.set(h.id, { ...h, source: 'regex' });
  for (const h of semanticHits) {
    if (!byId.has(h.id)) byId.set(h.id, { ...h, source: 'semantic' });
  }
  return [...byId.values()];
}
