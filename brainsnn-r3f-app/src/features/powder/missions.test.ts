import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS, REAL_PARAMS } from './neuroLayer.ts';
import { Material } from './materials.ts';
import { RegimeRecorder, type RegimeReadout } from './regime.ts';
import {
  LEARNED_WEIGHT,
  LONG_AXON_CELLS,
  MISSIONS,
  MISSION_IDS,
  MissionTracker,
  longestActiveAxon,
  type MissionContext,
} from './missions.ts';

const NO_REGIME: RegimeReadout = {
  ready: false, reason: '', cvIsi: 0, fano: 0, synchrony: 0,
  rateHz: null, regime: null, neurons: 0, spikes: 0, windowTicks: 300,
};

function context(over: Partial<MissionContext> = {}): MissionContext {
  const engine = over.engine ?? new PowderEngine({ width: 64, height: 32, seed: 'm' });
  return {
    engine,
    layer: over.layer ?? new NeuroLayer(engine.size),
    regime: over.regime ?? NO_REGIME,
    firedSinceLastCheck: over.firedSinceLastCheck ?? false,
  };
}

function byId(id: string) {
  const mission = MISSIONS.find((m) => m.id === id);
  if (!mission) throw new Error(`no mission ${id}`);
  return mission;
}

describe('mission catalogue', () => {
  it('gives every mission a unique id', () => {
    expect(new Set(MISSION_IDS).size).toBe(MISSIONS.length);
  });

  it('tells you both how to do it and what it teaches', () => {
    for (const mission of MISSIONS) {
      expect(mission.title.length).toBeGreaterThan(5);
      expect(mission.hint.length).toBeGreaterThan(15);
      expect(mission.why.length).toBeGreaterThan(25);
    }
  });

  // The failure that would make the whole feature a lie: an objective that is
  // already satisfied on an empty grid.
  it('awards nothing on an empty grid', () => {
    const empty = context();
    for (const mission of MISSIONS) {
      expect(mission.check(empty)).toBe(false);
    }
  });
});

describe('individual objectives', () => {
  it('first-spark needs a firing, not merely a neuron', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'spark' });
    engine.setCell(4, 4, Material.NEURO);
    expect(byId('first-spark').check(context({ engine }))).toBe(false);
    expect(byId('first-spark').check(context({ engine, firedSinceLastCheck: true }))).toBe(true);
  });

  it('learned needs the weight actually raised, not merely a synapse', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'learn' });
    engine.setCell(4, 4, Material.SYNAPSE); // starts at 0.1
    expect(byId('learned').check(context({ engine }))).toBe(false);
    engine.weight[engine.index(4, 4)] = LEARNED_WEIGHT;
    expect(byId('learned').check(context({ engine }))).toBe(true);
  });

  it('dopamine needs the dopamine to still be in range', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'dopa' });
    engine.setCell(4, 4, Material.SYNAPSE);
    engine.weight[engine.index(4, 4)] = LEARNED_WEIGHT;
    // Learned, but no dopamine anywhere: not this objective.
    expect(byId('dopamine').check(context({ engine }))).toBe(false);

    engine.setCell(20, 4, Material.DOPAMINE); // far away
    expect(byId('dopamine').check(context({ engine }))).toBe(false);

    engine.setCell(6, 4, Material.DOPAMINE); // within radius 5
    expect(byId('dopamine').check(context({ engine }))).toBe(true);
  });

  it('inhibit needs a negative membrane potential', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'inhib' });
    engine.setCell(4, 4, Material.NEURO);
    engine.setCell(8, 4, Material.INHIB);
    expect(byId('inhibit').check(context({ engine }))).toBe(false);
    engine.voltage[engine.index(4, 4)] = -0.4;
    expect(byId('inhibit').check(context({ engine }))).toBe(true);
  });

  it('regime-ai needs the measured regime, not a guess', () => {
    expect(byId('regime-ai').check(context({ regime: { ...NO_REGIME, regime: 'SR' } }))).toBe(false);
    expect(byId('regime-ai').check(context({ regime: { ...NO_REGIME, regime: 'AI' } }))).toBe(true);
  });
});

describe('longestActiveAxon', () => {
  function wire(engine: PowderEngine, length: number, row = 5) {
    for (let x = 2; x < 2 + length; x += 1) engine.setCell(x, row, Material.SYNAPSE);
  }

  it('ignores a long wire that has never carried a spike', () => {
    const engine = new PowderEngine({ width: 64, height: 32, seed: 'axon' });
    const layer = new NeuroLayer(engine.size);
    wire(engine, LONG_AXON_CELLS + 5);
    // Drawn but never fired — "run a spike down it" is not satisfied by drawing.
    expect(longestActiveAxon(engine, layer)).toBe(0);
  });

  it('measures the run once a spike has passed through it', () => {
    const engine = new PowderEngine({ width: 64, height: 32, seed: 'axon' });
    const layer = new NeuroLayer(engine.size);
    wire(engine, LONG_AXON_CELLS + 5);
    engine.setCell(1, 5, Material.NEURO);
    engine.voltage[engine.index(1, 5)] = GAME_PARAMS.threshold * 2;

    // Long enough for the wave to reach the far end: one cell per tick.
    for (let tick = 0; tick < LONG_AXON_CELLS + 12; tick += 1) layer.step(engine, GAME_PARAMS);
    expect(longestActiveAxon(engine, layer)).toBeGreaterThanOrEqual(LONG_AXON_CELLS);
    expect(byId('long-axon').check({ ...context({ engine, layer }) })).toBe(true);
  });

  it('does not add two separate wires together', () => {
    const engine = new PowderEngine({ width: 64, height: 32, seed: 'axon' });
    const layer = new NeuroLayer(engine.size);
    // Two runs of 15 with four clear rows between them. Only the first is
    // driven, so the answer is 15 — not 30, and not 0.
    wire(engine, 15, 5);
    wire(engine, 15, 9);
    engine.setCell(1, 5, Material.NEURO);
    engine.voltage[engine.index(1, 5)] = GAME_PARAMS.threshold * 2;
    for (let tick = 0; tick < 20; tick += 1) layer.step(engine, GAME_PARAMS);

    expect(longestActiveAxon(engine, layer)).toBe(15);
  });
});

describe('MissionTracker', () => {
  it('checks on a cadence rather than every tick', () => {
    const tracker = new MissionTracker(20);
    const base = context();
    // 19 ticks with a firing latched, but no check yet.
    for (let tick = 0; tick < 19; tick += 1) {
      expect(tracker.observe(base).length).toBe(0);
    }
    // The 20th runs the checks. firedSinceLastCheck is latched by the tracker,
    // so a firing on tick 1 still counts on tick 20.
    const fired = { ...base, layer: base.layer };
    fired.layer.firedCells[0] = 0;
    fired.layer.firedCount = 1;
    tracker.observe(fired);
    expect(tracker.completedCount).toBeGreaterThan(0);
  });

  it('latches a spike that happened between checks', () => {
    const tracker = new MissionTracker(10);
    const base = context();
    base.layer.firedCount = 1; // fired on tick 1
    tracker.observe(base);
    base.layer.firedCount = 0; // silent for the rest of the window
    for (let tick = 0; tick < 9; tick += 1) tracker.observe(base);
    expect(tracker.isComplete('first-spark')).toBe(true);
  });

  it('reports each completion exactly once', () => {
    const tracker = new MissionTracker(1);
    const base = context();
    base.layer.firedCount = 1;
    expect(tracker.observe(base).map((m) => m.id)).toEqual(['first-spark']);
    expect(tracker.observe(base)).toEqual([]);
  });

  it('keeps completions when the grid is cleared', () => {
    // Clearing the grid does not un-teach you what a long axon is.
    const tracker = new MissionTracker(1);
    const base = context();
    base.layer.firedCount = 1;
    tracker.observe(base);
    base.engine.clear();
    base.layer.firedCount = 0;
    tracker.observe(base);
    expect(tracker.isComplete('first-spark')).toBe(true);
  });

  it('restores saved progress and ignores ids it does not know', () => {
    const tracker = new MissionTracker();
    tracker.restore(['learned', 'not-a-mission', 'regime-ai']);
    expect(tracker.isComplete('learned')).toBe(true);
    expect(tracker.isComplete('regime-ai')).toBe(true);
    expect(tracker.completedCount).toBe(2);
  });

  it('clears on reset', () => {
    const tracker = new MissionTracker(1);
    const base = context();
    base.layer.firedCount = 1;
    tracker.observe(base);
    tracker.reset();
    expect(tracker.completedCount).toBe(0);
  });
});

// The objectives have to be reachable by playing, not only by hand-setting
// fields. This drives a real circuit and expects the early ones to fall out.
describe('missions against a real circuit', () => {
  it('completes the spark and the long axon by actually building them', () => {
    const engine = new PowderEngine({ seed: 'play' });
    const layer = new NeuroLayer(engine.size);
    const recorder = new RegimeRecorder();
    const tracker = new MissionTracker(5);

    engine.setCell(10, 20, Material.NEURO);
    for (let x = 11; x < 11 + LONG_AXON_CELLS + 4; x += 1) engine.setCell(x, 20, Material.SYNAPSE);

    for (let tick = 0; tick < 200; tick += 1) {
      if (tick % 40 === 0) engine.voltage[engine.index(10, 20)] = REAL_PARAMS.threshold * 2;
      engine.tick();
      const stats = layer.step(engine, REAL_PARAMS);
      recorder.observe(layer, REAL_PARAMS, stats.neurons, stats.synapses);
      tracker.observe({ engine, layer, regime: recorder.current() });
    }

    expect(tracker.isComplete('first-spark')).toBe(true);
    expect(tracker.isComplete('long-axon')).toBe(true);
    // Nothing was drawn to satisfy these, and they must not be handed out.
    expect(tracker.isComplete('dopamine')).toBe(false);
    expect(tracker.isComplete('inhibit')).toBe(false);
  });
});
