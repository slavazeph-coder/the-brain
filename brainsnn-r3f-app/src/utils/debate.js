/**
 * Layer 64 — Debate Mode
 *
 * Specialization of Autopsy restricted to two named speakers. Produces
 * a momentum timeline (per-turn pressure diff), a running cumulative
 * score, and declares a "manipulation race winner" = speaker with the
 * LOWER average pressure (cleaner rhetoric wins).
 */

import { parseTranscript } from './conversation';
import { scoreContent } from './cognitiveFirewall';

function pressureOf(s) {
  return (s.emotionalActivation + s.cognitiveSuppression + s.manipulationPressure) / 3;
}

export function analyzeDebate(raw = '', { topSpeakers = 2 } = {}) {
  const turns = parseTranscript(raw || '');
  if (!turns.length) return null;
  const tallies = new Map();
  for (const t of turns) {
    tallies.set(t.speaker, (tallies.get(t.speaker) || 0) + 1);
  }
  const ranked = [...tallies.entries()].sort((a, b) => b[1] - a[1]).slice(0, topSpeakers);
  if (ranked.length < 2) return null;
  const [aName, bName] = [ranked[0][0], ranked[1][0]];

  const rows = turns
    .filter((t) => t.speaker === aName || t.speaker === bName)
    .map((t, idx) => {
      const score = scoreContent(t.text);
      const pressure = pressureOf(score);
      return {
        idx,
        speaker: t.speaker,
        text: t.text,
        pressure,
        templates: score.templates || [],
      };
    });

  let sumA = 0, sumB = 0, countA = 0, countB = 0;
  const cumulative = [];
  for (const r of rows) {
    if (r.speaker === aName) { sumA += r.pressure; countA += 1; }
    else { sumB += r.pressure; countB += 1; }
    cumulative.push({
      idx: r.idx,
      avgA: countA ? sumA / countA : 0,
      avgB: countB ? sumB / countB : 0,
    });
  }

  const meanA = countA ? sumA / countA : 0;
  const meanB = countB ? sumB / countB : 0;
  const winner = meanA < meanB ? aName : meanB < meanA ? bName : null;

  const peak = rows.reduce((best, r) => (r.pressure > best.pressure ? r : best), rows[0]);

  return {
    aName, bName,
    meanA, meanB,
    countA, countB,
    winner,
    delta: Math.abs(meanA - meanB),
    rows,
    cumulative,
    peak,
  };
}

export const DEBATE_EXAMPLE = `Alex: The project is behind. I'd like to understand what's blocking us.
Morgan: Absolutely unbelievable. Scandalous. If you're not FURIOUS, you're not paying attention.
Alex: I'm frustrated too, but I think we can get back on track if we swap scope this sprint.
Morgan: Everyone knows this is your fault. Obviously. 100% on you.
Alex: That's not accurate. Here are the dates and decisions — let's walk through them together.
Morgan: Act NOW or I'll have to escalate. Last chance before the board hears.
Alex: I'll bring the numbers to the next standup. I'm not going to argue under deadline pressure.
Morgan: Shocking disrespect. You always twist things.`;
