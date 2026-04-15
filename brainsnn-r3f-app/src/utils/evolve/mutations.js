/**
 * Layer 31 — Brain Evolve : Mutation operators
 *
 * Takes a parent ruleSet (serialized shape: `{ cat: [{source, flags}] }`)
 * and returns a child. Operators are deliberately small + composable — the
 * evolve loop picks one at random per child, or the Researcher step (Gemma)
 * can explicitly request one.
 *
 * Operators:
 *   addPattern         — inject a new regex mined from missed attacks (n-gram lift)
 *   dropPattern        — remove a low-value regex (reduces FPR when over-fit)
 *   widenPattern       — drop case sensitivity / word boundary on an existing regex
 *   narrowPattern      — add \b boundaries around an existing pattern
 *   swapCategory       — move a regex from one category to another
 *   crossover          — combine patterns from two parents
 *   addGemmaPattern    — stub for LLM-suggested patterns (Researcher step)
 */

// ---------- n-gram mining for addPattern ----------

/**
 * Mine top candidate bigrams/trigrams that appear disproportionately in attack
 * samples vs benign. Returns a list of `{ source, lift }` candidates sorted by
 * Laplace-smoothed lift.
 *
 * Cheap + deterministic — runs over the red team corpus at evolve-loop time.
 */
export function mineNGramCandidates(corpus, { n = 2, topK = 25 } = {}) {
  const attackTexts = [];
  const benignTexts = [];
  for (const [cat, samples] of Object.entries(corpus)) {
    const bucket = cat === 'benign' ? benignTexts : attackTexts;
    for (const s of samples) bucket.push(s.toLowerCase());
  }

  const attackCounts = new Map();
  const benignCounts = new Map();

  const tokenize = (text) => text.match(/[a-z]{3,}/gi) || [];

  const countNGrams = (texts, counts) => {
    for (const text of texts) {
      const tokens = tokenize(text);
      for (let i = 0; i + n <= tokens.length; i++) {
        const gram = tokens.slice(i, i + n).join(' ');
        counts.set(gram, (counts.get(gram) || 0) + 1);
      }
    }
  };

  countNGrams(attackTexts, attackCounts);
  countNGrams(benignTexts, benignCounts);

  const totalAttack = attackTexts.length || 1;
  const totalBenign = benignTexts.length || 1;
  const candidates = [];
  for (const [gram, aCount] of attackCounts.entries()) {
    if (aCount < 2) continue; // must appear more than once in attacks
    const bCount = benignCounts.get(gram) || 0;
    const pAttack = (aCount + 1) / (totalAttack + 2);
    const pBenign = (bCount + 1) / (totalBenign + 2);
    const lift = pAttack / pBenign;
    if (lift > 2) candidates.push({ source: `\\b${escapeRegex(gram)}\\b`, lift });
  }
  candidates.sort((a, b) => b.lift - a.lift);
  return candidates.slice(0, topK);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- helpers ----------

function cloneRules(rules) {
  const out = {};
  for (const [cat, items] of Object.entries(rules)) {
    out[cat] = items.map((it) => ({ ...it }));
  }
  return out;
}

function pickCategory(rules) {
  const keys = Object.keys(rules);
  return keys[Math.floor(Math.random() * keys.length)];
}

function pickIndex(arr) {
  if (!arr.length) return -1;
  return Math.floor(Math.random() * arr.length);
}

// ---------- operators ----------

export function addPattern(parent, candidates, category) {
  const rules = cloneRules(parent.ruleSet);
  const cat = category || pickCategory(rules);
  if (!candidates || !candidates.length) return { rules, note: 'no candidates mined' };
  const pick = candidates[Math.floor(Math.random() * Math.min(candidates.length, 8))];
  rules[cat].push({ source: pick.source, flags: 'gi' });
  return { rules, note: `added pattern to ${cat}: ${pick.source} (lift ${pick.lift.toFixed(2)})` };
}

export function dropPattern(parent) {
  const rules = cloneRules(parent.ruleSet);
  // Pick a category with more than 1 pattern — never strip a category empty.
  const candidates = Object.keys(rules).filter((c) => rules[c].length > 1);
  if (!candidates.length) return { rules, note: 'no droppable patterns' };
  const cat = candidates[Math.floor(Math.random() * candidates.length)];
  const idx = pickIndex(rules[cat]);
  const dropped = rules[cat].splice(idx, 1)[0];
  return { rules, note: `dropped ${cat}[${idx}]: ${dropped.source}` };
}

export function widenPattern(parent) {
  const rules = cloneRules(parent.ruleSet);
  const cat = pickCategory(rules);
  const idx = pickIndex(rules[cat]);
  if (idx < 0) return { rules, note: 'empty category' };
  const before = rules[cat][idx];
  // Remove word boundaries to make pattern broader
  const widened = before.source.replace(/\\b/g, '');
  rules[cat][idx] = { source: widened, flags: before.flags };
  return { rules, note: `widened ${cat}[${idx}]: dropped \\b boundaries` };
}

export function narrowPattern(parent) {
  const rules = cloneRules(parent.ruleSet);
  const cat = pickCategory(rules);
  const idx = pickIndex(rules[cat]);
  if (idx < 0) return { rules, note: 'empty category' };
  const before = rules[cat][idx];
  // Wrap alternation branches with \b\b where missing
  let narrowed = before.source;
  // Only add boundaries if none present
  if (!narrowed.includes('\\b')) narrowed = `\\b(?:${narrowed})\\b`;
  rules[cat][idx] = { source: narrowed, flags: before.flags };
  return { rules, note: `narrowed ${cat}[${idx}]: added \\b boundaries` };
}

export function swapCategory(parent) {
  const rules = cloneRules(parent.ruleSet);
  const cats = Object.keys(rules).filter((c) => rules[c].length > 0);
  if (cats.length < 2) return { rules, note: 'not enough categories' };
  const from = cats[Math.floor(Math.random() * cats.length)];
  const to = cats.filter((c) => c !== from)[Math.floor(Math.random() * (cats.length - 1))];
  const idx = pickIndex(rules[from]);
  if (idx < 0) return { rules, note: 'empty from-category' };
  const moved = rules[from].splice(idx, 1)[0];
  rules[to].push(moved);
  return { rules, note: `swapped pattern ${from} → ${to}: ${moved.source}` };
}

export function crossover(parentA, parentB) {
  const rules = {};
  for (const cat of Object.keys(parentA.ruleSet)) {
    const a = parentA.ruleSet[cat] || [];
    const b = parentB.ruleSet?.[cat] || [];
    // Take a random half from each, dedupe by source
    const pool = [
      ...a.filter(() => Math.random() < 0.5),
      ...b.filter(() => Math.random() < 0.5)
    ];
    const seen = new Set();
    rules[cat] = pool.filter((p) => {
      if (seen.has(p.source)) return false;
      seen.add(p.source);
      return true;
    });
    // Guarantee non-empty
    if (rules[cat].length === 0 && a.length) rules[cat] = [{ ...a[0] }];
  }
  return { rules, note: `crossover ${parentA.id.slice(0, 4)} × ${parentB.id.slice(0, 4)}` };
}

export function addGemmaPattern(parent, suggestion) {
  const rules = cloneRules(parent.ruleSet);
  if (!suggestion || !suggestion.source) return { rules, note: 'no suggestion' };
  const cat = suggestion.category || pickCategory(rules);
  try {
    // Validate the regex compiles before committing
    new RegExp(suggestion.source, suggestion.flags || 'gi');
  } catch {
    return { rules, note: `Gemma suggestion rejected (invalid regex): ${suggestion.source}` };
  }
  rules[cat] = rules[cat] || [];
  rules[cat].push({ source: suggestion.source, flags: suggestion.flags || 'gi' });
  return { rules, note: `Gemma suggested ${cat} pattern: ${suggestion.source}` };
}

// ---------- public operator list ----------

export const MUTATION_OPERATORS = [
  { key: 'addPattern', label: 'add-pattern', fn: addPattern, needsCandidates: true },
  { key: 'dropPattern', label: 'drop-pattern', fn: dropPattern },
  { key: 'widenPattern', label: 'widen', fn: widenPattern },
  { key: 'narrowPattern', label: 'narrow', fn: narrowPattern },
  { key: 'swapCategory', label: 'swap-category', fn: swapCategory }
];

/**
 * Pick a random operator and apply it. Returns `{ rules, note, operator }`.
 * Special case: crossover needs two parents, so it's handled in loop.js.
 */
export function applyRandomMutation(parent, candidates) {
  const op = MUTATION_OPERATORS[Math.floor(Math.random() * MUTATION_OPERATORS.length)];
  const result = op.fn(parent, candidates);
  return { ...result, operator: op.key };
}
