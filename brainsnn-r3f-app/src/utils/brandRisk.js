/**
 * Layer 106 — Brand Risk Scorecard
 *
 * Per-brand aggregator over the Cognitive Firewall (L4),
 * Propaganda Templates (L39), and Ad Transparency archetypes (L48).
 *
 * Input: a list of pasted items (mentions, ad copy, reviews, replies)
 * about or around a brand.
 *
 * Output: a single 0–100 Brand Risk score with a clear tier, the worst
 * items, the dominant archetypes, the most-fired templates, and a
 * Markdown brief that can be pasted into a doc or a Slack channel.
 */
import { scoreContent } from './cognitiveFirewall.js';
import { detectArchetypes } from './adTransparency.js';

const HIGH_RISK_ARCHETYPES = new Set([
  'abusive-domestic',
  'phishing',
  'conspiracy-hook',
  'political-attack',
  'cult-recruitment',
]);

export function splitItems(blob = '') {
  const text = String(blob || '').trim();
  if (!text) return [];
  // --- or === or === === lines first; blank lines as fallback.
  const delimited = text
    .split(/\n\s*(?:---+|===+)\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);
  if (delimited.length > 1) return delimited;
  return text
    .split(/\n{2,}/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function scoreItem(text) {
  const score = scoreContent(text);
  const templates = score.templates || [];
  const archetypes = detectArchetypes(templates);
  const highRisk = archetypes.filter((a) => HIGH_RISK_ARCHETYPES.has(a.id));
  return {
    text,
    excerpt: text.length > 220 ? `${text.slice(0, 218).trim()}…` : text,
    pressure: score.manipulationPressure ?? 0,
    dimensions: {
      emotionalActivation: score.emotionalActivation ?? 0,
      cognitiveSuppression: score.cognitiveSuppression ?? 0,
      manipulationPressure: score.manipulationPressure ?? 0,
      trustErosion: score.trustErosion ?? 0,
    },
    templates,
    archetypes,
    highRisk,
    language: score.language || 'en',
    evidence: score.evidence || [],
  };
}

function tierFor(score) {
  if (score >= 75) return { id: 'critical', label: 'Critical', color: '#d86e78' };
  if (score >= 50) return { id: 'risk', label: 'At risk', color: '#e57b40' };
  if (score >= 25) return { id: 'watch', label: 'Watch', color: '#fdab43' };
  return { id: 'clean', label: 'Clean', color: '#5ee69a' };
}

/**
 * Compute a 0–100 Brand Risk score from a list of scored items.
 *
 *   60% mean manipulation pressure (0..1 → 0..60)
 *   25% peak manipulation pressure (0..1 → 0..25)
 *   15% high-risk archetype share (0..1 → 0..15)
 *
 * Items < 5 words are dropped (the firewall returns zeros for them
 * which would unfairly drag the mean down).
 */
export function computeBrandRisk(items = []) {
  const scored = items
    .map(scoreItem)
    .filter((it) => it.text.trim().split(/\s+/).length >= 5);

  if (!scored.length) {
    return {
      score: 0,
      tier: tierFor(0),
      itemCount: 0,
      meanPressure: 0,
      peakPressure: 0,
      highRiskCount: 0,
      highRiskShare: 0,
      worstItems: [],
      topArchetypes: [],
      topTemplates: [],
      items: [],
    };
  }

  const meanPressure =
    scored.reduce((sum, it) => sum + it.pressure, 0) / scored.length;
  const peakPressure = Math.max(...scored.map((it) => it.pressure));
  const highRiskItems = scored.filter((it) => it.highRisk.length > 0);
  const highRiskShare = highRiskItems.length / scored.length;

  const score = Math.round(
    Math.min(
      100,
      meanPressure * 60 + peakPressure * 25 + highRiskShare * 15
    )
  );

  const archetypeCounts = new Map();
  for (const it of scored) {
    for (const a of it.archetypes) {
      const prev = archetypeCounts.get(a.id) || { id: a.id, label: a.label, count: 0, highRisk: HIGH_RISK_ARCHETYPES.has(a.id) };
      prev.count += 1;
      archetypeCounts.set(a.id, prev);
    }
  }
  const topArchetypes = [...archetypeCounts.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const templateCounts = new Map();
  for (const it of scored) {
    for (const t of it.templates) {
      const prev = templateCounts.get(t.id) || { id: t.id, label: t.label, count: 0 };
      prev.count += 1;
      templateCounts.set(t.id, prev);
    }
  }
  const topTemplates = [...templateCounts.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const worstItems = [...scored].sort((a, b) => b.pressure - a.pressure).slice(0, 5);

  return {
    score,
    tier: tierFor(score),
    itemCount: scored.length,
    meanPressure: parseFloat(meanPressure.toFixed(3)),
    peakPressure: parseFloat(peakPressure.toFixed(3)),
    highRiskCount: highRiskItems.length,
    highRiskShare: parseFloat(highRiskShare.toFixed(3)),
    worstItems,
    topArchetypes,
    topTemplates,
    items: scored,
  };
}

export function brandBriefMarkdown(brand, report) {
  const safeBrand = brand?.trim() || 'Untitled brand';
  const lines = [];
  lines.push(`# Brand Risk Scorecard — ${safeBrand}`);
  lines.push('');
  lines.push(`**Score:** ${report.score} / 100  ·  **Tier:** ${report.tier.label}`);
  lines.push(`**Items scored:** ${report.itemCount}  ·  **Mean pressure:** ${(report.meanPressure * 100).toFixed(0)}%  ·  **Peak pressure:** ${(report.peakPressure * 100).toFixed(0)}%`);
  lines.push(`**High-risk items:** ${report.highRiskCount} (${Math.round(report.highRiskShare * 100)}%)`);
  lines.push('');
  if (report.topArchetypes.length) {
    lines.push('## Dominant archetypes');
    for (const a of report.topArchetypes) {
      lines.push(`- **${a.label}** — fired in ${a.count} item${a.count === 1 ? '' : 's'}${a.highRisk ? ' · high-risk' : ''}`);
    }
    lines.push('');
  }
  if (report.topTemplates.length) {
    lines.push('## Most-fired manipulation templates');
    for (const t of report.topTemplates) {
      lines.push(`- ${t.label} (${t.count})`);
    }
    lines.push('');
  }
  if (report.worstItems.length) {
    lines.push('## Worst items');
    report.worstItems.forEach((it, i) => {
      const pct = Math.round(it.pressure * 100);
      lines.push(`### ${i + 1}. Pressure ${pct}%`);
      const archetypeLabels = it.archetypes.map((a) => a.label).join(', ');
      if (archetypeLabels) lines.push(`*Archetypes:* ${archetypeLabels}`);
      lines.push('');
      lines.push(`> ${it.excerpt.replace(/\n+/g, ' ')}`);
      lines.push('');
    });
  }
  return lines.join('\n');
}
