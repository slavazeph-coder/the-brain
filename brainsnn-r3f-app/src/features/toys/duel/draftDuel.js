// Draft Duel — two texts, five rounds, one scorer.
//
// Both drafts go through the same deterministic local engine the /engine
// comparison uses (analysis + firewall) plus the persuasion-technique
// detector, entirely in the browser. Nothing is sent anywhere. A round is a
// draw unless the gap clears a small margin, so noise does not crown a winner.
// The verdict is a game result, not a quality judgment — the boundary line on
// the card says so.
import { analyzeContentLocally } from '../../../lib/analysisEngine.js';
import { computeFirewall } from '../../../lib/firewallLayer.js';
import { detectTechniques } from '../../../lib/persuasionTechniques.js';

export const DUEL_MAX_CHARS = 4000;
export const DUEL_DRAW_MARGIN = 3;

export const DUEL_ROUNDS = Object.freeze([
  { id: 'trust', label: 'Trust', better: 'higher', blurb: 'Specifics, sources and stated limits — not trust words.' },
  { id: 'calm', label: 'Calm', better: 'lower', blurb: 'Less manipulation pressure on the reader.' },
  { id: 'clean', label: 'Clean play', better: 'lower', blurb: 'Fewer persuasion techniques detected.' },
  { id: 'warmth', label: 'Warmth', better: 'higher', blurb: 'More empathy in the wording.' },
  { id: 'spark', label: 'Spark', better: 'higher', blurb: 'More energy and excitement.' },
]);

export const DUEL_BOUNDARY = 'Heuristic signals from BrainSNN’s deterministic scorer. A win is a game result, not a verdict on quality, truth or what readers will do.';

export const DUEL_SAMPLES = Object.freeze({
  a: 'Act now! This guaranteed solution will change everything. Everyone knows it is the only choice — doors close tonight.',
  b: 'This is a proposed solution. It worked for three of the five teams that tried it last quarter. Review the notes, compare the alternatives and decide when you are ready.',
});

/** Why a pair cannot be fought yet, or '' if it can. */
export function validateDrafts(a, b) {
  if (!String(a || '').trim() || !String(b || '').trim()) return 'Paste something into both drafts.';
  if (String(a).length > DUEL_MAX_CHARS || String(b).length > DUEL_MAX_CHARS) return `Keep each draft under ${DUEL_MAX_CHARS} characters.`;
  return '';
}

/** Raw signals for one draft. */
export function scoreDraft(text) {
  const content = String(text || '');
  const analysis = analyzeContentLocally({ content, contentType: 'text', forceFallback: true });
  const firewall = computeFirewall({ content, metrics: analysis.metrics, isFallback: true });
  const techniques = detectTechniques(content);
  return {
    trust: analysis.metrics.trust,
    calm: Math.round(firewall.manipulationPressure * 100),
    clean: techniques.length,
    warmth: analysis.metrics.empathy,
    spark: analysis.metrics.excitement,
    techniques: techniques.map((technique) => technique.label),
  };
}

/** 0–100 bar height for a raw value, oriented so a longer bar is always better. */
export function barValue(roundId, raw) {
  if (roundId === 'calm') return Math.max(0, Math.min(100, 100 - raw));
  if (roundId === 'clean') return Math.max(0, 100 - raw * 20);
  return Math.max(0, Math.min(100, raw));
}

function judge(round, rawA, rawB) {
  const margin = round.id === 'clean' ? 1 : DUEL_DRAW_MARGIN;
  const delta = round.better === 'higher' ? rawA - rawB : rawB - rawA;
  if (Math.abs(delta) < margin) return 'draw';
  return delta > 0 ? 'A' : 'B';
}

export function duel(a, b) {
  const problem = validateDrafts(a, b);
  if (problem) return { valid: false, reason: problem };
  const scoreA = scoreDraft(a);
  const scoreB = scoreDraft(b);
  const rounds = DUEL_ROUNDS.map((round) => {
    const rawA = scoreA[round.id];
    const rawB = scoreB[round.id];
    return {
      id: round.id,
      label: round.label,
      blurb: round.blurb,
      rawA,
      rawB,
      barA: barValue(round.id, rawA),
      barB: barValue(round.id, rawB),
      winner: judge(round, rawA, rawB),
    };
  });
  const winsA = rounds.filter((round) => round.winner === 'A').length;
  const winsB = rounds.filter((round) => round.winner === 'B').length;
  const draws = rounds.length - winsA - winsB;
  let winner = 'draw';
  if (winsA > winsB) winner = 'A';
  else if (winsB > winsA) winner = 'B';
  const won = rounds.filter((round) => round.winner === winner).map((round) => round.label.toLowerCase());
  const tally = `${Math.max(winsA, winsB)}–${Math.min(winsA, winsB)}`;
  const headline = winner === 'draw'
    ? `Dead heat, ${winsA}–${winsB}`
    : `Draft ${winner} wins ${tally}`;
  return {
    valid: true,
    rounds,
    winsA,
    winsB,
    draws,
    winner,
    headline,
    wonOn: won,
    techniquesA: scoreA.techniques,
    techniquesB: scoreB.techniques,
  };
}
