import { describe, expect, it } from '../../test/tinyVitest.js';
import {
  buildAllCuratedLevels,
  buildCuratedLevel,
  buildLevel,
  CURATED_LEVELS,
  levelDifficulty,
  MAX_LEVEL_TEXT,
} from './brainGameLevels.js';
import { resolvePackets, scorePackets } from './brainGame3d.js';
import { INTERVENTIONS, MISSION } from './brainGame.js';
import { CALIBRATION_CORPUS } from '../../lib/calibrationCorpus.js';

const levels = buildAllCuratedLevels();

describe('curated levels', () => {
  it('every curated level resolves to a real corpus item', () => {
    const ids = new Set(CALIBRATION_CORPUS.map((item) => item.id));
    for (const level of CURATED_LEVELS) expect(ids.has(level.corpusId)).toBe(true);
  });

  it('builds them all', () => {
    expect(levels).toHaveLength(CURATED_LEVELS.length);
  });

  it('uses unique ids', () => {
    expect(new Set(CURATED_LEVELS.map((level) => level.id)).size).toBe(CURATED_LEVELS.length);
  });

  it('falls back to the first level for an unknown id', () => {
    expect(buildCuratedLevel('not-a-level').id).toBe(CURATED_LEVELS[0].id);
  });

  it('is deterministic', () => {
    expect(buildCuratedLevel('guru-urgency-pitch')).toEqual(buildCuratedLevel('guru-urgency-pitch'));
  });
});

// The ladder has to actually be a ladder. These pin the shape of the curve
// rather than exact numbers, so tuning a cue pattern cannot silently flatten it.
describe('the difficulty curve', () => {
  it('opens with a level that has nothing to fight', () => {
    const first = levels[0];
    expect(first.honest).toBe(true);
    expect(first.packets).toHaveLength(0);
    expect(first.empty).toBe(true);
  });

  it('ends with the hardest level', () => {
    const scores = levels.map((level) => levelDifficulty(level).score);
    expect(Math.max(...scores)).toBe(scores[scores.length - 1]);
  });

  it('makes the boss level attack on all three routes', () => {
    const boss = levels[levels.length - 1];
    expect(boss.routes.length).toBe(3);
  });

  it('rates route variety above raw volume', () => {
    // Eight packets down one route should not outrank six across three.
    const oneRoute = { packets: Array.from({ length: 8 }, () => ({ route: 'threat' })) };
    const threeRoutes = { packets: [
      { route: 'threat' }, { route: 'threat' }, { route: 'memory' },
      { route: 'memory' }, { route: 'judgment' }, { route: 'judgment' },
    ] };
    expect(levelDifficulty(threeRoutes).score).toBeGreaterThan(levelDifficulty(oneRoute).score);
  });

  it('reports nothing detected as zero difficulty', () => {
    expect(levelDifficulty({ packets: [] }).score).toBe(0);
    expect(levelDifficulty(null).score).toBe(0);
  });
});

// Playability. A level nobody can win, or nobody can lose, is not a game.
describe('every curated level is winnable and losable', () => {
  const playable = levels.filter((level) => level.packets.length > 0);

  it('has fightable levels at all', () => {
    expect(playable.length).toBeGreaterThan(4);
  });

  it('lets everything through if the player does nothing', () => {
    for (const level of playable) {
      const result = resolvePackets({ packets: level.packets, log: [], interventions: INTERVENTIONS });
      expect(result.containment).toBe(0);
    }
  });

  it('can be fully sealed by playing every counter early', () => {
    const log = INTERVENTIONS.map((choice, index) => ({ tick: 1 + index, id: choice.id }));
    for (const level of playable) {
      const result = resolvePackets({ packets: level.packets, log, interventions: INTERVENTIONS });
      expect(scorePackets(result).grade).toBe('sealed');
    }
  });

  it('cannot be sealed by cuts alone once familiarity or reasoning routes appear', () => {
    const cutsOnly = INTERVENTIONS.filter((choice) => choice.kind === 'cut')
      .map((choice, index) => ({ tick: 1 + index, id: choice.id }));
    const nonThreat = playable.filter((level) => level.routes.some((route) => route !== 'threat'));
    expect(nonThreat.length).toBeGreaterThan(2);
    for (const level of nonThreat) {
      const result = resolvePackets({ packets: level.packets, log: cutsOnly, interventions: INTERVENTIONS });
      expect(result.containment).toBeLessThan(100);
    }
  });

  it('stays inside the intervention budget to seal a level', () => {
    // Sealing everything must be possible without exceeding what the mission
    // actually grants, or perfect play would be unreachable.
    expect(INTERVENTIONS.length).toBeLessThanOrEqual(MISSION.budget);
  });
});

describe('buildLevel from arbitrary text', () => {
  it('is deterministic for the same text and seed', () => {
    const text = 'Doors close tonight. Act now before it is too late.';
    expect(buildLevel({ text, seed: 's' })).toEqual(buildLevel({ text, seed: 's' }));
  });

  it('finds packets in manipulative text', () => {
    const level = buildLevel({ text: 'Only 3 seats left, doors close tonight. Experts agree everyone is switching.' });
    expect(level.packets.length).toBeGreaterThan(0);
    expect(level.empty).toBe(false);
  });

  it('flags an empty level rather than implying the text is clean', () => {
    const level = buildLevel({ text: 'Deploy finished at 14:02. Error rate returned to baseline.' });
    expect(level.packets).toHaveLength(0);
    expect(level.empty).toBe(true);
  });

  it('handles empty and missing input without throwing', () => {
    expect(buildLevel({ text: '' }).empty).toBe(true);
    expect(buildLevel({}).empty).toBe(true);
  });

  it('caps very long input', () => {
    const level = buildLevel({ text: 'danger '.repeat(5000) });
    expect(level.text.length).toBeLessThanOrEqual(MAX_LEVEL_TEXT);
  });

  it('carries the detected techniques through for the post-run panel', () => {
    const level = buildLevel({ text: 'Doors close tonight and everyone else has already joined.' });
    expect(level.techniques.length).toBeGreaterThan(0);
    expect(level.techniques[0].published.length).toBeGreaterThan(0);
  });
});
