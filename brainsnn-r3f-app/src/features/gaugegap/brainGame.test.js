import { describe, expect, it } from '../../test/tinyVitest.js';
import { createBrainParams, createBrainState, stepBrain } from '../brain3d/brainModel.js';
import { createRng } from '../../lib/rng.js';
import {
  applyIntervention,
  CALM_DRIVE,
  CHALLENGE,
  countInterventions,
  driveAtTick,
  evaluateRun,
  INTERVENTIONS,
  MISSION,
  missionNotice,
  PRESSURE_DRIVE,
} from './brainGame.js';

// Play a whole run headlessly, which is exactly how the game is scored.
function playRun({ mode = 'mission', choices = [], seed = 'game', ticks = null } = {}) {
  const rules = mode === 'challenge' ? CHALLENGE : MISSION;
  const total = ticks ?? rules.durationTicks;
  const params = createBrainParams();
  const rng = createRng(seed);
  let state = createBrainState(params);
  let interventions = { lesions: [], cuts: [], stimuli: {} };
  for (const choice of choices) interventions = applyIntervention(interventions, choice);

  const frames = [];
  let breachTicks = 0;
  let worstBreach = 0;
  let targets = CALM_DRIVE;
  for (let tick = 0; tick < total; tick += 1) {
    targets = driveAtTick(tick, total);
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
    const hijack = window.reduce((sum, frame) => (
      sum + ((frame.activities.AMY + frame.activities.BG) / 2 - frame.activities.PFC)
    ), 0) / window.length;
    const hijackIndex = Math.round(Math.max(0, Math.min(1, hijack + 0.5)) * 100);
    breachTicks = hijackIndex > rules.hijackLimit ? breachTicks + 1 : 0;
    worstBreach = Math.max(worstBreach, breachTicks);
  }

  return evaluateRun({
    frames,
    finalState: state,
    params,
    targets,
    mode,
    used: countInterventions(interventions),
    breachTicks,
    worstBreach,
  });
}

describe('driveAtTick', () => {
  it('starts calm and ramps into full pressure', () => {
    const start = driveAtTick(0, 300);
    const end = driveAtTick(300, 300);
    expect(Math.abs(start.AMY - CALM_DRIVE.AMY)).toBeLessThan(1e-9);
    expect(Math.abs(end.AMY - PRESSURE_DRIVE.AMY)).toBeLessThan(1e-9);
    expect(end.PFC).toBeLessThan(start.PFC);
  });

  it('is monotonic in threat drive', () => {
    const samples = [0, 40, 80, 120].map((tick) => driveAtTick(tick, 300).AMY);
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
  });
});

describe('applyIntervention', () => {
  it('records each kind without mutating the original', () => {
    const base = { lesions: [], cuts: [], stimuli: {} };
    const lesioned = applyIntervention(base, INTERVENTIONS.find((entry) => entry.kind === 'lesion'));
    expect(lesioned.lesions).toContain('AMY');
    expect(base.lesions.length).toBe(0);

    const cut = applyIntervention(lesioned, INTERVENTIONS.find((entry) => entry.id === 'cut-ctx-amy'));
    expect(cut.cuts).toContain('CTX-AMY');

    const boosted = applyIntervention(cut, INTERVENTIONS.find((entry) => entry.id === 'boost-pfc'));
    expect(boosted.stimuli.PFC).toBeGreaterThan(0);
    expect(countInterventions(boosted)).toBe(3);
  });

  it('does not double-count a repeated intervention', () => {
    const lesion = INTERVENTIONS.find((entry) => entry.kind === 'lesion');
    let state = applyIntervention({ lesions: [], cuts: [], stimuli: {} }, lesion);
    state = applyIntervention(state, lesion);
    expect(countInterventions(state)).toBe(1);
  });
});

describe('the mission is machine-checked', () => {
  it('is lost when the player does nothing against rising pressure', () => {
    const result = playRun({ mode: 'mission', choices: [] });
    expect(result.status).toBe('lost');
    expect(result.worstBreach).toBeGreaterThanOrEqual(MISSION.breachGrace);
  });

  it('is won by silencing the threat region', () => {
    const result = playRun({ mode: 'mission', choices: [INTERVENTIONS.find((entry) => entry.id === 'lesion-amy')] });
    expect(result.status).toBe('won');
    expect(result.scores.defense).toBeGreaterThan(0);
  });

  it('is won by boosting judgment instead', () => {
    const result = playRun({ mode: 'mission', choices: [INTERVENTIONS.find((entry) => entry.id === 'boost-pfc')] });
    expect(result.status).toBe('won');
  });

  // Difficulty gradient: a plausible-looking intervention is not automatically
  // a sufficient one, which is what makes the mission worth replaying.
  it('is still lost if the chosen intervention is too weak', () => {
    const result = playRun({ mode: 'mission', choices: [INTERVENTIONS.find((entry) => entry.id === 'cut-ctx-amy')] });
    expect(result.status).toBe('lost');
  });

  it('rewards spending less of the budget', () => {
    const frugal = playRun({ mode: 'mission', choices: [INTERVENTIONS.find((e) => e.id === 'lesion-amy')] });
    const lavish = playRun({ mode: 'mission', choices: INTERVENTIONS.slice(0, 5) });
    expect(frugal.scores.efficiency).toBeGreaterThan(lavish.scores.efficiency);
  });

  it('is deterministic for a given seed', () => {
    const a = playRun({ mode: 'mission', choices: [INTERVENTIONS[0]], seed: 'fixed' });
    const b = playRun({ mode: 'mission', choices: [INTERVENTIONS[0]], seed: 'fixed' });
    expect(JSON.stringify(a.scores)).toBe(JSON.stringify(b.scores));
  });
});

describe('evaluateRun', () => {
  it('stays running before the duration elapses', () => {
    const partial = playRun({ mode: 'mission', choices: [INTERVENTIONS[1]], ticks: 40 });
    expect(partial.status).toBe('running');
  });

  it('handles an empty run without throwing', () => {
    const empty = evaluateRun({ frames: [], finalState: null, params: createBrainParams(), targets: null, mode: 'sandbox', used: 0, breachTicks: 0 });
    expect(empty.status).toBe('running');
    expect(empty.metrics).toBe(null);
  });

  it('keeps every score inside 0-100', () => {
    const result = playRun({ mode: 'mission', choices: [INTERVENTIONS[0]] });
    for (const value of Object.values(result.scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('missionNotice', () => {
  it('describes sandbox, victory and defeat differently', () => {
    const won = { status: 'won', scores: { defense: 80 }, remaining: 4, hijack: 30, control: 1.4, breachTicks: 0 };
    const lost = { status: 'lost', scores: { defense: 10 }, remaining: 0, hijack: 90, control: 0.3, breachTicks: 30 };
    expect(missionNotice(won, 'sandbox')).toMatch(/Sandbox/);
    expect(missionNotice(won, 'mission')).toMatch(/Held the line/);
    expect(missionNotice(lost, 'mission')).toMatch(/offline/);
    expect(missionNotice(lost, 'challenge')).toMatch(/target/);
  });
});
