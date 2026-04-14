/**
 * Layer 22 — Conversation Brain
 *
 * Parse multi-turn transcripts and score each turn through the Cognitive
 * Firewall. Produces a timeline of cognitive drift: how the brain would
 * respond to each message in sequence, and where the manipulation
 * pressure spikes.
 */

import { scoreContent, mapTRIBEToRegions } from './cognitiveFirewall';
import { createInitialState, simulateStep } from './sim';

// ---------- parsing ----------

/**
 * Accepts multiple transcript formats:
 *  A) "Speaker: message" (newline-separated turns)
 *  B) ">>> " / ">>> " with alternating roles
 *  C) JSON array [{ role, content }]
 *  D) "User:\n...\nAssistant:\n..." with multiline content
 */
export function parseTranscript(raw) {
  if (!raw?.trim()) return [];

  // Try JSON first
  const trimmed = raw.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map((t, i) => ({
        turn: i,
        speaker: t.role || t.speaker || 'unknown',
        text: t.content || t.text || ''
      })).filter((t) => t.text);
    } catch { /* fall through */ }
  }

  // "Speaker: content" pattern — greedy match including multiline
  const SPEAKER_RE = /^([A-Za-z0-9_-]{1,32}):\s*(.*)$/;
  const lines = raw.split('\n');
  const turns = [];
  let current = null;

  for (const line of lines) {
    const m = line.match(SPEAKER_RE);
    if (m) {
      if (current) turns.push(current);
      current = { turn: turns.length, speaker: m[1].trim(), text: m[2].trim() };
    } else if (current && line.trim()) {
      current.text += (current.text ? ' ' : '') + line.trim();
    }
  }
  if (current) turns.push(current);

  // Fall back: single paragraph per blank-line-separated block
  if (turns.length === 0) {
    const blocks = raw.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((b, i) => ({
      turn: i,
      speaker: i % 2 === 0 ? 'user' : 'assistant',
      text: b
    }));
  }
  return turns;
}

// ---------- scoring ----------

/**
 * Score each turn with the Cognitive Firewall and simulate the brain
 * reacting to the cumulative conversation. Returns per-turn snapshots.
 */
export function analyzeConversation(turns) {
  let brainState = createInitialState();
  const timeline = [];
  let peak = { turn: -1, pressure: 0 };
  let totalPressure = 0;

  for (const t of turns) {
    if (!t.text || t.text.length < 3) {
      timeline.push({
        ...t,
        scores: null,
        brainSnapshot: { ...brainState.regions }
      });
      continue;
    }

    const scores = scoreContent(t.text);
    // Apply to brain state
    brainState = mapTRIBEToRegions(brainState, scores);
    // Drift: let the simulation recover one step between turns
    brainState = simulateStep(brainState);

    totalPressure += scores.manipulationPressure;
    if (scores.manipulationPressure > peak.pressure) {
      peak = { turn: t.turn, pressure: scores.manipulationPressure };
    }

    timeline.push({
      ...t,
      scores,
      brainSnapshot: { ...brainState.regions }
    });
  }

  // Compute drift: how much did the brain change cumulatively?
  const initialRegions = createInitialState().regions;
  const finalRegions = brainState.regions;
  const drift = {};
  let totalDrift = 0;
  for (const key of Object.keys(finalRegions)) {
    drift[key] = finalRegions[key] - (initialRegions[key] ?? 0);
    totalDrift += Math.abs(drift[key]);
  }

  return {
    timeline,
    summary: {
      totalTurns: turns.length,
      scoredTurns: timeline.filter((t) => t.scores).length,
      averagePressure: totalPressure / Math.max(1, timeline.length),
      peakTurn: peak.turn,
      peakPressure: peak.pressure,
      drift,
      totalDrift,
      finalRegions
    }
  };
}

/**
 * Extract a condensed drift classification for the whole conversation.
 */
export function classifyConversationDrift(summary) {
  const { averagePressure, peakPressure, totalDrift } = summary;
  if (peakPressure > 0.7 || totalDrift > 2.0) {
    return { level: 'severe', label: 'Severe cognitive drift' };
  }
  if (averagePressure > 0.4 || totalDrift > 1.0) {
    return { level: 'moderate', label: 'Moderate drift — watch key turns' };
  }
  if (peakPressure > 0.3) {
    return { level: 'mild', label: 'Mild pressure spikes' };
  }
  return { level: 'calm', label: 'Calm conversation' };
}
