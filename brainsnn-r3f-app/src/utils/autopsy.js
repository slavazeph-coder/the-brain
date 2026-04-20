/**
 * Layer 36 — Autopsy Mode
 *
 * Parse any multi-speaker transcript, run every message through the
 * Cognitive Firewall, and roll up per-speaker profiles: average
 * manipulation pressure, dominant affect cluster, peak-pressure quote.
 *
 * Reuses the Layer 22 speaker-prefixed parser. Output is a stable JSON
 * shape that feeds both the AutopsyPanel UI and the /a/<hash> share
 * card.
 *
 * "Which speaker installed which feelings in whom" in one glance.
 */

import { parseTranscript } from './conversation';
import { scoreContent } from './cognitiveFirewall';

const AFFECT_KEYWORDS = {
  fear: /\bdie\b|\bdeath\b|\bkill\b|\bdanger\b|\bthreat\b|\bvirus\b|\battack\b|\bwar\b|\bcrash\b|\bcollapse\b|\bunsafe\b/i,
  outrage: /\boutrage\b|\bfurious\b|\bscandal\b|\bterrible\b|\bdisgust/i,
  urgency: /\bnow\b|\bimmediately\b|\burgent\b|\blast chance\b|\bbreaking\b/i,
  certainty: /\b100%\b|\bproven\b|\bguaranteed\b|\beveryone knows\b|\bobviously\b/i,
  belonging: /\bwe\b|\bus\b|\bour\b|\btogether\b|\bfamily\b|\btribe\b/i,
  shame: /\bshould\b|\bfailure\b|\bselfish\b|\bembarrass/i,
  awe: /\bamaz\w+|\bwonder\w+|\bincredib|\bmagnificent\w*|\bgrand\w*/i,
};

function dominantAffect(text) {
  let best = { name: 'neutral', hits: 0 };
  for (const [name, re] of Object.entries(AFFECT_KEYWORDS)) {
    const m = text.match(re);
    if (m && (m.length || 1) > best.hits) {
      best = { name, hits: m.length || 1 };
    }
  }
  return best.name;
}

function pressureOf(score) {
  return (
    (score.emotionalActivation + score.cognitiveSuppression + score.manipulationPressure) / 3
  );
}

/**
 * Run the autopsy: parse → score per-turn → rollup per-speaker.
 *
 * @param {string} raw — pasted transcript
 * @returns {{
 *   turns: Array<{turn:number,speaker:string,text:string,score:object,pressure:number,affect:string}>,
 *   speakers: Array<{name:string,turns:number,avgPressure:number,peakPressure:number,peakQuote:string,dominantAffect:string,affectMix:Object<string,number>}>,
 *   meta: {turnCount:number,speakerCount:number,overallPressure:number}
 * }}
 */
export function runAutopsy(raw) {
  const turns = parseTranscript(raw || '').map((t) => {
    const score = scoreContent(t.text);
    const pressure = pressureOf(score);
    const affect = dominantAffect(t.text);
    return { ...t, score, pressure, affect };
  });

  const bySpeaker = new Map();
  for (const t of turns) {
    const key = t.speaker || 'unknown';
    if (!bySpeaker.has(key)) {
      bySpeaker.set(key, {
        name: key,
        turns: 0,
        pressureSum: 0,
        peakPressure: 0,
        peakQuote: '',
        affectMix: {},
      });
    }
    const s = bySpeaker.get(key);
    s.turns += 1;
    s.pressureSum += t.pressure;
    if (t.pressure > s.peakPressure) {
      s.peakPressure = t.pressure;
      s.peakQuote = t.text.slice(0, 160);
    }
    s.affectMix[t.affect] = (s.affectMix[t.affect] || 0) + 1;
  }

  const speakers = [...bySpeaker.values()]
    .map((s) => ({
      name: s.name,
      turns: s.turns,
      avgPressure: s.turns > 0 ? s.pressureSum / s.turns : 0,
      peakPressure: s.peakPressure,
      peakQuote: s.peakQuote,
      dominantAffect: Object.entries(s.affectMix).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral',
      affectMix: s.affectMix,
    }))
    .sort((a, b) => b.avgPressure - a.avgPressure);

  const overallPressure = turns.length > 0
    ? turns.reduce((acc, t) => acc + t.pressure, 0) / turns.length
    : 0;

  return {
    turns,
    speakers,
    meta: {
      turnCount: turns.length,
      speakerCount: speakers.length,
      overallPressure,
    },
  };
}

/**
 * Tight rollup used by the /a/<hash> share card. Max 6 speakers to keep
 * the URL small — if there are more, the top 6 by pressure win.
 */
export function summarizeAutopsy(autopsy, opts = {}) {
  const cap = opts.maxSpeakers ?? 6;
  const top = autopsy.speakers.slice(0, cap);
  return {
    turns: autopsy.meta.turnCount,
    pressure: autopsy.meta.overallPressure,
    speakers: top.map((s) => ({
      n: s.name.slice(0, 20),
      t: s.turns,
      p: s.avgPressure,
      pk: s.peakPressure,
      a: s.dominantAffect,
    })),
  };
}

/**
 * Synthetic example used by the panel's "Try it" button. A short
 * 3-speaker scene with one clearly manipulative role.
 */
export const AUTOPSY_EXAMPLE = `Alex: I'm honestly just worried about the project timeline, can we push the deadline?
Morgan: Absolutely not. This is unbelievable. Everyone knows the deadline is final — if you can't keep up, that's on you. Obviously the whole team is watching.
Sam: I mean — it's been a rough week on my end too. Maybe we can split the scope?
Morgan: No. You need to act now. We don't have time for excuses. This is a make-or-break moment — scandal-level bad if we miss.
Alex: Okay, I'll make it work. Just a lot of pressure coming from you.
Morgan: That's because it SHOULD be pressure. Shocking that you can't see what's at stake.`;
