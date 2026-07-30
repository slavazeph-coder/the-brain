// Verifiable run proofs for Defend the Brain.
//
// Because the model is deterministic, a run is fully described by its seed,
// mode and the tick at which each intervention was applied. That makes a score
// checkable by *recomputation*: replay the log and see whether the claimed
// result falls out. Forging a score means finding an input that replays to it,
// not editing a number — which is the property most leaderboards lack.
//
// PRIVACY: a proof carries no text and no personal data. It is a seed, a list
// of tick/intervention pairs, and the resulting metrics.
import { createBrainParams, createBrainState, stepBrain } from '../brain3d/brainModel.js';
import { createRng } from '../../lib/rng.js';
import { canonicalJson, sha256Hex } from './evidence.js';
import {
  applyIntervention,
  CALM_DRIVE,
  CHALLENGE,
  countInterventions,
  driveAtTick,
  evaluateRun,
  INTERVENTIONS,
  MISSION,
} from './brainGame.js';

export const RUN_PROOF_SCHEMA = 'brainsnn.defend_the_brain_run.v1';

const INTERVENTION_BY_ID = Object.fromEntries(INTERVENTIONS.map((entry) => [entry.id, entry]));

/**
 * Replay a run from its log. Pure and deterministic: identical inputs always
 * produce identical scores, on any machine.
 */
export function replayRun({ mode = 'mission', seed = 'defend-01', log = [] } = {}) {
  const rules = mode === 'challenge' ? CHALLENGE : MISSION;
  const total = mode === 'sandbox' ? 200 : rules.durationTicks;
  const params = createBrainParams();
  const rng = createRng(seed);
  let state = createBrainState(params);
  let interventions = { lesions: [], cuts: [], stimuli: {} };

  const byTick = new Map();
  for (const entry of log) {
    if (!INTERVENTION_BY_ID[entry.id]) continue;
    const tick = Math.max(0, Math.floor(entry.tick) || 0);
    if (!byTick.has(tick)) byTick.set(tick, []);
    byTick.get(tick).push(INTERVENTION_BY_ID[entry.id]);
  }

  const frames = [];
  let breachTicks = 0;
  let worstBreach = 0;
  let targets = CALM_DRIVE;

  for (let tick = 0; tick < total; tick += 1) {
    for (const choice of byTick.get(tick) || []) {
      interventions = applyIntervention(interventions, choice);
    }
    targets = mode === 'sandbox' ? CALM_DRIVE : driveAtTick(tick, total);
    state = stepBrain(state, { targets, params, interventions, rng });
    frames.push({
      tick: state.tick,
      activities: state.activities,
      spikes: state.spikes,
      weights: state.weights,
      drive: state.drive,
      stdpDelta: state.stdpDelta,
      meanFiring: state.meanFiring,
    });

    const window = frames.slice(-40);
    const raw = window.reduce((sum, frame) => (
      sum + ((frame.activities.AMY + frame.activities.BG) / 2 - frame.activities.PFC)
    ), 0) / window.length;
    const hijackIndex = Math.round(Math.max(0, Math.min(1, raw + 0.5)) * 100);
    const limit = mode === 'challenge' ? CHALLENGE.hijackTarget : MISSION.hijackLimit;
    breachTicks = hijackIndex > limit ? breachTicks + 1 : 0;
    worstBreach = Math.max(worstBreach, breachTicks);
  }

  return evaluateRun({
    frames: frames.slice(-60),
    finalState: state,
    params,
    targets,
    mode,
    used: countInterventions(interventions),
    breachTicks,
    worstBreach,
    elapsed: frames.length,
  });
}

/** Build a signed-by-content proof of a completed run. */
export async function buildRunProof({ mode, seed, log, now = new Date() }) {
  const outcome = replayRun({ mode, seed, log });
  const proof = {
    schema: RUN_PROOF_SCHEMA,
    created_at_utc: now.toISOString(),
    lab: 'braingame',
    mode,
    seed,
    log: log.map((entry) => ({ tick: entry.tick, id: entry.id })),
    result: {
      status: outcome.status,
      scores: outcome.scores,
      hijack: outcome.hijack,
      control: outcome.control,
      used: outcome.used,
      worstBreach: outcome.worstBreach,
    },
    claim_boundary: 'Score from a deterministic 7-region model replay. Verifiable by recomputation; '
      + 'not a measurement of any human brain.',
  };
  proof.content_hash = await sha256Hex(canonicalJson(proof));
  return proof;
}

/**
 * Verify a submitted proof by replaying it. Returns the reasons it failed
 * rather than a bare boolean, so a rejection can be explained.
 */
export async function verifyRunProof(proof) {
  const problems = [];
  if (!proof || proof.schema !== RUN_PROOF_SCHEMA) problems.push(`unsupported schema: ${proof?.schema}`);
  if (!proof?.seed) problems.push('missing seed');
  if (!Array.isArray(proof?.log)) problems.push('missing intervention log');

  if (problems.length) return { verified: false, problems };

  const recorded = proof.content_hash;
  // The hash is taken over the proof WITHOUT the hash field, so the key must be
  // removed rather than set to undefined (canonicalJson renders that as null).
  const unsigned = { ...proof };
  delete unsigned.content_hash;
  const recomputedHash = await sha256Hex(canonicalJson(unsigned));
  if (recorded && recorded !== 'unavailable-no-webcrypto' && recorded !== recomputedHash) {
    problems.push('content_hash mismatch: the proof was modified after export');
  }

  const replay = replayRun({ mode: proof.mode, seed: proof.seed, log: proof.log });
  if (replay.status !== proof.result?.status) {
    problems.push(`status mismatch: claimed ${proof.result?.status}, replayed ${replay.status}`);
  }
  if (replay.scores.defense !== proof.result?.scores?.defense) {
    problems.push(`score mismatch: claimed ${proof.result?.scores?.defense}, replayed ${replay.scores.defense}`);
  }

  return { verified: !problems.length, problems, replayed: replay.scores, recomputedHash };
}
