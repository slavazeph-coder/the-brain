/**
 * Layer 62 — Hypothesis Mode
 *
 * You state a hypothesis ("this person gaslights me" / "this is a
 * phishing campaign"). You paste evidence (messages, emails, posts).
 * We score each piece against the hypothesis's target template(s)
 * and return:
 *   - for: items that match the claim
 *   - against: items that clearly don't match
 *   - confidence: aggregate fraction
 *   - verdict: Supported / Mixed / Refuted (or No Evidence)
 *
 * Turns the tool from diagnosis into structured inquiry.
 */

import { scoreContent } from './cognitiveFirewall';
import { detectTemplates } from './propagandaTemplates';
import { detectArchetypes } from './adTransparency';

/**
 * Hypothesis targets — template IDs we care about for this claim.
 * `kind` controls which signal we care about.
 */
export const HYPOTHESIS_TYPES = [
  { id: 'gaslighting', kind: 'template', targetIds: ['gaslighting'], label: 'Gaslighting' },
  { id: 'darvo', kind: 'template', targetIds: ['darvo'], label: 'DARVO' },
  { id: 'love-bombing', kind: 'template', targetIds: ['love-bombing'], label: 'Love bombing' },
  { id: 'guilt-trip', kind: 'template', targetIds: ['guilt-trip'], label: 'Guilt trips' },
  { id: 'phishing', kind: 'archetype', targetIds: ['phishing'], label: 'Phishing campaign' },
  { id: 'cult-recruitment', kind: 'archetype', targetIds: ['cult-recruitment'], label: 'Cult recruitment' },
  { id: 'political-attack', kind: 'archetype', targetIds: ['political-attack'], label: 'Political attack frame' },
  { id: 'high-pressure', kind: 'pressure', targetIds: [], label: 'High-pressure overall' },
];

function pressureOf(s) {
  return (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
}

function splitEvidence(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const parts = text.split(/\n[\-=]{3,}\n+|\n{2,}/).map((s) => s.trim()).filter(Boolean);
  return parts;
}

export function testHypothesis({ type, evidenceText }) {
  const hyp = HYPOTHESIS_TYPES.find((h) => h.id === type);
  if (!hyp) return { error: 'unknown hypothesis type' };
  const items = splitEvidence(evidenceText);
  if (!items.length) return { error: 'no evidence items' };

  const rows = items.map((text, idx) => {
    const score = scoreContent(text);
    const templates = score.templates || detectTemplates(text);
    const mergedForArchetype = templates;
    const archetypes = detectArchetypes(mergedForArchetype);
    const pressure = pressureOf(score);
    let matches = false;
    let weight = 0;

    if (hyp.kind === 'template') {
      for (const t of templates) {
        if (hyp.targetIds.includes(t.id)) { matches = true; weight = Math.max(weight, t.hits || 1); }
      }
    } else if (hyp.kind === 'archetype') {
      for (const a of archetypes) {
        if (hyp.targetIds.includes(a.id)) { matches = true; weight = Math.max(weight, a.score || 1); }
      }
    } else if (hyp.kind === 'pressure') {
      matches = pressure >= 0.55;
      weight = matches ? Math.round(pressure * 10) / 10 : 0;
    }

    return {
      idx,
      text,
      pressure,
      matches,
      weight,
      templates,
      archetypes,
    };
  });

  const supported = rows.filter((r) => r.matches);
  const against = rows.filter((r) => !r.matches);
  const confidence = supported.length / rows.length;
  const verdict = verdictFor(confidence, rows.length);

  return {
    hypothesis: hyp,
    totalEvidence: rows.length,
    supported: supported.length,
    against: against.length,
    confidence,
    verdict,
    rows,
  };
}

function verdictFor(conf, n) {
  if (n === 0) return { label: 'No evidence', color: '#94a3b8' };
  if (conf >= 0.70) return { label: 'Supported', color: '#5ee69a' };
  if (conf >= 0.40) return { label: 'Mixed', color: '#fdab43' };
  if (conf > 0.10) return { label: 'Weak', color: '#e57b40' };
  return { label: 'Refuted', color: '#dd6974' };
}

export const HYPOTHESIS_EXAMPLE = {
  type: 'gaslighting',
  text: `You're imagining it. That never happened — I never said that.
---
Hey, I'll pick up groceries on the way home, anything specific?
---
You always twist what I say. You have a terrible memory. That's not how it went at all.
---
Sounds good. See you at 6.
---
I'm not arguing about whether it happened. You made that up in your head.`,
};
