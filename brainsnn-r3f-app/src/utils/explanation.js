/**
 * Layer 70 — Explanation Mode
 *
 * Narrate in plain English why the Firewall scored the way it did on
 * a given text. Takes a scoreContent() result (+ merged templates +
 * archetypes) and produces a paragraph a non-technical reader can
 * verify.
 */

const DIMENSION_BLURBS = {
  emotionalActivation: (v) => [
    v >= 0.7 ? 'Emotional activation is very high — the piece presses fear or outrage buttons repeatedly.'
    : v >= 0.45 ? 'Emotional activation is elevated — there\'s meaningful fear or outrage priming.'
    : v >= 0.2 ? 'There\'s a bit of emotional priming, but it\'s not dominant.'
    : 'Emotional activation is low.',
  ],
  cognitiveSuppression: (v) => [
    v >= 0.7 ? 'Cognitive suppression is very high — urgency and certainty absolutes crowd out reasoning.'
    : v >= 0.45 ? 'Cognitive suppression is elevated — there\'s noticeable urgency or absolutist framing.'
    : v >= 0.2 ? 'A little urgency or certainty theater, but not overwhelming.'
    : 'Cognitive suppression is low.',
  ],
  manipulationPressure: (v) => [
    v >= 0.7 ? 'Overall manipulation pressure is very high. Pause before sharing or reacting.'
    : v >= 0.45 ? 'Manipulation pressure is moderate. Verify before acting.'
    : v >= 0.2 ? 'Some manipulation cues, not dominant.'
    : 'Little to no manipulation signature.',
  ],
  trustErosion: (v) => [
    v >= 0.5 ? 'Trust-eroding framing (hidden truths, coverups) is prominent.'
    : v >= 0.2 ? 'Some trust-eroding cues in the framing.'
    : 'Trust-eroding framing is not prominent.',
  ],
};

function pressureOf(s) {
  return (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
}

function summarizeEvidence(evidence = []) {
  const list = evidence.slice(0, 6);
  if (!list.length) return '';
  return `Signal words that fired: ${list.map((e) => `"${e}"`).join(', ')}.`;
}

function summarizeTemplates(templates = []) {
  if (!templates.length) return '';
  const by = templates.slice(0, 3).map((t) => {
    const sig = t.source === 'semantic'
      ? `${t.label} (semantic, ${Math.round((t.similarity || 0) * 100)}%)`
      : `${t.label} (${t.hits || 1}× literal matches)`;
    return sig;
  });
  return `Named propaganda templates: ${by.join(', ')}.`;
}

function summarizeArchetypes(archs = []) {
  if (!archs.length) return '';
  const best = archs[0];
  return `This reads like: ${best.label} — ${best.desc}`;
}

/**
 * Produce a small structured report + narrative string.
 */
export function explain(text, score, { templates = [], archetypes = [] } = {}) {
  if (!score) return { narrative: '', bullets: [] };

  const bullets = [];

  const p = pressureOf(score);
  const headline = p >= 0.65
    ? 'The Firewall flagged this as high-pressure content.'
    : p >= 0.35
      ? 'The Firewall flagged this as moderately manipulative.'
      : p >= 0.15
        ? 'The Firewall found some mild pressure cues.'
        : 'The Firewall found this largely clean.';

  bullets.push({ kind: 'headline', text: headline });

  for (const [key, fn] of Object.entries(DIMENSION_BLURBS)) {
    const v = score[key] || 0;
    const [line] = fn(v);
    bullets.push({ kind: 'dim', key, value: v, text: line });
  }

  const ev = summarizeEvidence(score.evidence);
  if (ev) bullets.push({ kind: 'evidence', text: ev });

  const tpl = summarizeTemplates(templates);
  if (tpl) bullets.push({ kind: 'templates', text: tpl });

  const arch = summarizeArchetypes(archetypes);
  if (arch) bullets.push({ kind: 'archetype', text: arch });

  if (score.language && score.language !== 'en') {
    bullets.push({
      kind: 'language',
      text: `Language pack applied: ${score.languageLabel || score.language}.`,
    });
  }

  const narrative = bullets.map((b) => b.text).join(' ');
  return { narrative, bullets, pressure: p };
}
