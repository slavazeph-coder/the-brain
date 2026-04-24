/**
 * Layer 88 — Persona Simulator
 *
 * Same text read through four reader-lenses. Each persona reweights
 * Firewall dimensions differently and emits a short interpretation
 * paragraph. The user sees side-by-side how this message would land
 * on a skeptic, an ally, the target, and an outside observer.
 *
 * Not psychology — it's a thinking prop. Forcing the reader to
 * rotate lenses makes manipulation visible that a single-perspective
 * read misses.
 */

import { scoreContent } from './cognitiveFirewall';

export const PERSONAS = [
  {
    id: 'skeptic',
    label: 'Skeptic',
    color: '#77dbe4',
    // Weights tilt toward cognitive-suppression detection
    weights: { emo: 0.7, cog: 1.3, man: 1.2, trust: 1.0 },
    interpret: (score, p) => {
      const b = [];
      if (score.cognitiveSuppression > 0.4) b.push('sees urgency/certainty wrapping weak evidence');
      if ((score.templates || []).some((t) => t.id === 'authority')) b.push('notes vague authority name-drops');
      if (p > 0.5) b.push('asks "what do they want me to do without thinking?"');
      else b.push('not enough hooks to raise an alarm, but stays watchful');
      return b.join(' · ');
    },
  },
  {
    id: 'ally',
    label: 'Ally',
    color: '#5ee69a',
    // Weights emphasize concrete specifics; attenuate generic urgency
    weights: { emo: 0.9, cog: 0.8, man: 0.85, trust: 1.0 },
    interpret: (score, p) => {
      const b = [];
      if (score.emotionalActivation > 0.3) b.push('feels the distress, wants to validate before investigating');
      if (p > 0.55) b.push('worried this is affecting the sender, asks follow-up questions');
      else b.push('reads it as earnest — low alarm but attentive');
      return b.join(' · ');
    },
  },
  {
    id: 'target',
    label: 'Target',
    color: '#dd6974',
    // Weights amplify what a manipulator would expect the target to feel
    weights: { emo: 1.3, cog: 1.2, man: 1.1, trust: 0.9 },
    interpret: (score, p) => {
      const b = [];
      if (score.emotionalActivation > 0.4) b.push('fear/outrage hits before reasoning can arrive');
      if (score.cognitiveSuppression > 0.4) b.push('feels pressure to respond immediately');
      if ((score.templates || []).some((t) => t.id === 'guilt-trip' || t.id === 'gaslighting')) {
        b.push('may question their own memory or obligation');
      }
      if (p > 0.6) b.push('this is exactly the state the sender seems to want');
      else if (p > 0.3) b.push('mild pull toward the sender\'s framing');
      else b.push('lands quietly — no pull');
      return b.join(' · ');
    },
  },
  {
    id: 'observer',
    label: 'Observer',
    color: '#fdab43',
    // Weights are flat — outside read
    weights: { emo: 1.0, cog: 1.0, man: 1.0, trust: 1.0 },
    interpret: (score, p) => {
      const b = [];
      const tpls = (score.templates || []).map((t) => t.label).slice(0, 2).join(' + ');
      if (tpls) b.push(`template signature: ${tpls}`);
      if (p > 0.5) b.push('reads as pressure-shaped content from the outside');
      else b.push('no obvious rhetorical moves — neutral on first read');
      return b.join(' · ');
    },
  },
];

function pressureFor(score, weights) {
  const emo = (score.emotionalActivation || 0) * weights.emo;
  const cog = (score.cognitiveSuppression || 0) * weights.cog;
  const man = (score.manipulationPressure || 0) * weights.man;
  return Math.max(0, Math.min(1, (emo + cog + man) / 3));
}

export function simulatePersonas(text = '') {
  const t = String(text || '').trim();
  if (t.length < 10) return { empty: true, rows: [] };
  const score = scoreContent(t);
  const rows = PERSONAS.map((p) => {
    const pressure = pressureFor(score, p.weights);
    return {
      id: p.id,
      label: p.label,
      color: p.color,
      pressure,
      interpretation: p.interpret(score, pressure),
    };
  });
  return { empty: false, score, rows };
}
