// Rules and scoring for the Defend the Brain mission.
//
// Every other lab in the arcade prints a mission string that nothing checks.
// This one has a real win condition, a real fail state and a finite budget, all
// evaluated against the deterministic brain model.
import { computeBrainMetrics } from '../brain3d/brainMetrics.js';

export const GAME_MODES = Object.freeze([
  { id: 'sandbox', label: 'Sandbox', blurb: 'Every control unlocked. No objective — break it and see what happens.' },
  { id: 'mission', label: 'Mission', blurb: 'Incoming pressure ramps up. Keep judgment online with a limited budget.' },
  { id: 'challenge', label: 'Challenge', blurb: 'Hit the target with as few interventions as you can, then share the seed.' },
]);

// Thresholds are tuned to what the model actually does under full pressure,
// measured rather than guessed: doing nothing breaches for ~179 consecutive
// ticks (a decisive loss), silencing threat or boosting judgment holds the
// line, and cutting the salience route helps but is not enough on its own.
export const MISSION = Object.freeze({
  durationTicks: 300, // ~36 s at the 120 ms tick
  budget: 6,
  hijackLimit: 60, // sustained breach loses the run
  breachGrace: 25, // ticks allowed above the limit before failing
  controlTarget: 0.9, // PFC / AMY needed to count as holding
});

export const CHALLENGE = Object.freeze({
  durationTicks: 220,
  budget: 4,
  hijackTarget: 45,
  parInterventions: 3,
});

// A calm baseline and the pressure profile that ramps in during a mission.
export const CALM_DRIVE = Object.freeze({ THL: 0.45, CTX: 0.55, HPC: 0.45, PFC: 0.7, AMY: 0.2, BG: 0.25, CBL: 0.4 });
export const PRESSURE_DRIVE = Object.freeze({ THL: 0.85, CTX: 0.45, HPC: 0.35, PFC: 0.15, AMY: 0.9, BG: 0.85, CBL: 0.3 });

/** Linear ramp from calm to full pressure over the first 40% of the run. */
export function driveAtTick(tick, durationTicks) {
  const ramp = Math.max(0, Math.min(1, tick / Math.max(1, durationTicks * 0.4)));
  const blend = {};
  for (const code of Object.keys(CALM_DRIVE)) {
    blend[code] = CALM_DRIVE[code] * (1 - ramp) + PRESSURE_DRIVE[code] * ramp;
  }
  return blend;
}

export const INTERVENTIONS = Object.freeze([
  { id: 'boost-pfc', label: 'Boost judgment', kind: 'stimulus', target: 'PFC', amount: 0.22, hint: 'Drive the prefrontal region directly.' },
  { id: 'lesion-amy', label: 'Silence threat', kind: 'lesion', target: 'AMY', hint: 'Take the amygdala offline entirely.' },
  { id: 'cut-ctx-amy', label: 'Cut salience route', kind: 'cut', target: 'CTX-AMY', hint: 'Stop meaning from feeding threat.' },
  { id: 'cut-amy-bg', label: 'Cut action pressure', kind: 'cut', target: 'AMY-BG', hint: 'Stop threat from driving the action gate.' },
  { id: 'boost-cbl', label: 'Steady the pattern', kind: 'stimulus', target: 'CBL', amount: 0.18, hint: 'Cerebellar calibration into cortex.' },
]);

export function applyIntervention(interventions, choice) {
  const next = {
    lesions: [...(interventions.lesions || [])],
    cuts: [...(interventions.cuts || [])],
    stimuli: { ...(interventions.stimuli || {}) },
  };
  if (choice.kind === 'lesion' && !next.lesions.includes(choice.target)) next.lesions.push(choice.target);
  if (choice.kind === 'cut' && !next.cuts.includes(choice.target)) next.cuts.push(choice.target);
  if (choice.kind === 'stimulus') next.stimuli[choice.target] = choice.amount;
  return next;
}

export function countInterventions(interventions) {
  return (interventions.lesions?.length || 0)
    + (interventions.cuts?.length || 0)
    + Object.keys(interventions.stimuli || {}).length;
}

/**
 * Evaluate a run. `frames` is the rolling trace of steps taken so far.
 * Returns the live status plus a three-axis score in the arcade's house style,
 * where control and efficiency pull against each other.
 */
export function evaluateRun({ frames, finalState, params, targets, mode, used, breachTicks = 0, worstBreach = null, elapsed = null }) {
  const rules = mode === 'challenge' ? CHALLENGE : MISSION;
  const metrics = frames.length && finalState
    ? computeBrainMetrics({ trace: frames, finalState, params, targets })
    : null;

  const hijack = metrics ? metrics.hijackIndex : 0;
  const control = metrics ? metrics.controlRatio : 1;
  // Callers may pass only a rolling window of frames for metrics, so the
  // elapsed tick count is supplied separately when it differs.
  const ticksElapsed = elapsed == null ? frames.length : elapsed;
  const budget = rules.budget;
  const remaining = Math.max(0, budget - used);

  // A mission is lost the moment the breach streak exceeds the grace period —
  // recovering afterwards does not undo it, so the check uses the worst streak
  // seen, not whatever happens to be true on the final tick.
  const worst = worstBreach == null ? breachTicks : worstBreach;
  let status = 'running';
  if (mode === 'mission') {
    if (worst >= rules.breachGrace) status = 'lost';
    else if (ticksElapsed >= rules.durationTicks) status = 'won';
  } else if (mode === 'challenge') {
    if (ticksElapsed >= rules.durationTicks) {
      status = hijack <= rules.hijackTarget ? 'won' : 'lost';
    }
  }

  const controlScore = Math.round(Math.max(0, Math.min(1, (control - 0.4) / 1.2)) * 100);
  const efficiency = budget > 0 ? Math.round((remaining / budget) * 100) : 100;
  const stability = Math.round(Math.max(0, 1 - worst / Math.max(1, rules.breachGrace)) * 100);
  const defense = Math.round(Math.max(0, Math.min(100, controlScore * 0.45 + stability * 0.35 + efficiency * 0.2)));

  return {
    status,
    metrics,
    hijack,
    control: Math.round(control * 100) / 100,
    elapsed: ticksElapsed,
    remaining,
    used,
    breachTicks,
    worstBreach: worst,
    scores: { control: controlScore, efficiency, stability, defense },
  };
}

export function missionNotice(evaluation, mode) {
  if (mode === 'sandbox') return 'Sandbox: poke the circuit and watch the readouts move.';
  if (evaluation.status === 'won') return `Held the line. Defense ${evaluation.scores.defense} with ${evaluation.remaining} interventions unspent.`;
  if (evaluation.status === 'lost') {
    return mode === 'challenge'
      ? `Hijack finished at ${evaluation.hijack}, above the ${CHALLENGE.hijackTarget} target. Try a different cut.`
      : 'Judgment went offline. The threat loop took the gate.';
  }
  if (evaluation.breachTicks > 0) return `Hijack at ${evaluation.hijack} — over the limit. Intervene now.`;
  return `Hijack ${evaluation.hijack}, control ${evaluation.control}. Holding.`;
}
