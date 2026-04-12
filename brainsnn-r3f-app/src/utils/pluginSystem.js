/**
 * Analysis Plugin System
 *
 * Extensible pipeline for content analysis modules. Each plugin
 * provides a name, analyze() function, and optional metadata.
 * Plugins run in parallel and results merge into the firewall pipeline.
 *
 * Built-in plugins: sentiment, readability, source credibility.
 */

const registry = new Map();

// ---------- Plugin API ----------

export function registerPlugin(plugin) {
  if (!plugin.name || typeof plugin.analyze !== 'function') {
    throw new Error('Plugin must have a name and analyze() function');
  }
  registry.set(plugin.name, {
    name: plugin.name,
    description: plugin.description || '',
    version: plugin.version || '1.0.0',
    analyze: plugin.analyze,
    enabled: plugin.enabled !== false
  });
}

export function unregisterPlugin(name) {
  registry.delete(name);
}

export function listPlugins() {
  return [...registry.values()].map(({ name, description, version, enabled }) => ({
    name, description, version, enabled
  }));
}

export function togglePlugin(name, enabled) {
  const p = registry.get(name);
  if (p) p.enabled = enabled;
}

/**
 * Run all enabled plugins on content. Returns merged results.
 */
export async function runPlugins(text) {
  const active = [...registry.values()].filter((p) => p.enabled);
  if (!active.length) return { plugins: [], combined: {} };

  const results = await Promise.allSettled(
    active.map(async (p) => {
      const result = await p.analyze(text);
      return { plugin: p.name, ...result };
    })
  );

  const plugins = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  // Merge numeric scores by averaging
  const combined = {};
  const counts = {};
  for (const result of plugins) {
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === 'number' && key !== 'plugin') {
        combined[key] = (combined[key] || 0) + val;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
  }
  for (const key of Object.keys(combined)) {
    combined[key] = parseFloat((combined[key] / counts[key]).toFixed(4));
  }

  return { plugins, combined };
}

// ---------- Built-in Plugins ----------

// Sentiment Analysis (lexicon-based)
const POSITIVE_WORDS = new Set(['good', 'great', 'excellent', 'wonderful', 'amazing', 'love', 'happy', 'joy', 'hope', 'peace', 'calm', 'trust', 'safe', 'healthy', 'beautiful', 'kind', 'gentle', 'success', 'win', 'bright']);
const NEGATIVE_WORDS = new Set(['bad', 'terrible', 'horrible', 'awful', 'hate', 'angry', 'fear', 'death', 'kill', 'war', 'danger', 'threat', 'crisis', 'panic', 'evil', 'corrupt', 'destroy', 'fail', 'dark', 'pain']);

registerPlugin({
  name: 'sentiment',
  description: 'Lexicon-based sentiment polarity analysis',
  version: '1.0.0',
  analyze(text) {
    const words = text.toLowerCase().split(/\W+/);
    let pos = 0, neg = 0;
    for (const w of words) {
      if (POSITIVE_WORDS.has(w)) pos++;
      if (NEGATIVE_WORDS.has(w)) neg++;
    }
    const total = Math.max(pos + neg, 1);
    return {
      positivity: parseFloat((pos / total).toFixed(3)),
      negativity: parseFloat((neg / total).toFixed(3)),
      polarity: parseFloat(((pos - neg) / total).toFixed(3)),
      label: pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral'
    };
  }
});

// Readability (Flesch-Kincaid approximation)
registerPlugin({
  name: 'readability',
  description: 'Flesch-Kincaid readability grade level estimation',
  version: '1.0.0',
  analyze(text) {
    const sentences = text.split(/[.!?]+/).filter(Boolean).length || 1;
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length || 1;
    const syllables = words.reduce((sum, w) => {
      const s = w.toLowerCase().replace(/[^a-z]/g, '');
      const count = s.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').match(/[aeiouy]{1,2}/g)?.length || 1;
      return sum + count;
    }, 0);

    const grade = 0.39 * (wordCount / sentences) + 11.8 * (syllables / wordCount) - 15.59;
    const clampedGrade = Math.max(0, Math.min(20, grade));
    const ease = 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount);
    const clampedEase = Math.max(0, Math.min(100, ease));

    return {
      gradeLevel: parseFloat(clampedGrade.toFixed(1)),
      readingEase: parseFloat(clampedEase.toFixed(1)),
      complexity: parseFloat((clampedGrade / 20).toFixed(3)),
      label: clampedGrade < 6 ? 'easy' : clampedGrade < 12 ? 'moderate' : 'complex'
    };
  }
});

// Source Credibility Signals
registerPlugin({
  name: 'credibility',
  description: 'Heuristic credibility signal detection',
  version: '1.0.0',
  analyze(text) {
    const lower = text.toLowerCase();
    let score = 0.5; // neutral baseline
    const signals = [];

    // Positive credibility signals
    if (/\b(according to|study|research|data shows|peer.?reviewed)\b/i.test(text)) {
      score += 0.1; signals.push('cites research');
    }
    if (/\b(university|institute|journal|published)\b/i.test(text)) {
      score += 0.08; signals.push('academic reference');
    }
    if (/\bhowever\b|\bon the other hand\b|\balternatively\b/i.test(text)) {
      score += 0.06; signals.push('balanced framing');
    }

    // Negative credibility signals
    if (/\b(they don't want you|secret|hidden truth|wake up)\b/i.test(text)) {
      score -= 0.15; signals.push('conspiracy framing');
    }
    if (/\b(100%|guaranteed|miracle|cure.?all)\b/i.test(text)) {
      score -= 0.12; signals.push('false certainty');
    }
    if (/\b(share before|forward this|everyone must see)\b/i.test(text)) {
      score -= 0.1; signals.push('viral pressure');
    }
    if ((text.match(/!/g) || []).length > 5) {
      score -= 0.05; signals.push('excessive exclamation');
    }

    return {
      credibility: parseFloat(Math.max(0, Math.min(1, score)).toFixed(3)),
      signals,
      label: score > 0.6 ? 'credible' : score > 0.4 ? 'mixed' : 'low credibility'
    };
  }
});
