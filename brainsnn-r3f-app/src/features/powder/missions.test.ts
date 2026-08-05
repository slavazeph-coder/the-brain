import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS, MAX_WEIGHT, REAL_PARAMS } from './neuroLayer.ts';
import { Material } from './materials.ts';
import { RegimeRecorder, WINDOW_TICKS, type RegimeReadout } from './regime.ts';
import { createRng } from '../../lib/rng.js';
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

// This is the test that caught the real gap: the global Stimulate fires every
// neuron on the same tick, so a synapse never spikes before its downstream
// neuron and STDP can never trigger. "Teach a synapse" was unreachable by the
// path its own hint described.
describe('learning is reachable, and only the causal way round', () => {
  function pair() {
    const engine = new PowderEngine({ width: 60, height: 20, seed: 'stdp' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(5, 10, Material.NEURO);
    for (let x = 6; x < 15; x += 1) engine.setCell(x, 10, Material.SYNAPSE);
    engine.setCell(15, 10, Material.NEURO);
    return { engine, layer, up: engine.index(5, 10), down: engine.index(15, 10), last: engine.index(14, 10) };
  }

  /** Sparks upstream at phase 0 and downstream at `lag`, repeatedly. */
  function train(lag: number, ticks = 2000) {
    const { engine, layer, up, down, last } = pair();
    for (let tick = 0; tick < ticks; tick += 1) {
      const phase = tick % 40;
      if (phase === 0) engine.sparkAt(5, 10, 0, REAL_PARAMS.threshold);
      if (phase === lag) engine.sparkAt(15, 10, 0, REAL_PARAMS.threshold);
      layer.step(engine, REAL_PARAMS);
    }
    return engine.weight[last];
  }

  it('does not learn when both ends fire together, which is what Stimulate does', () => {
    const { engine, layer, last } = pair();
    for (let tick = 0; tick < 2000; tick += 1) {
      if (tick % 40 === 0) {
        // Every neuron at once: the global stimulus.
        engine.sparkAt(5, 10, 0, REAL_PARAMS.threshold);
        engine.sparkAt(15, 10, 0, REAL_PARAMS.threshold);
      }
      layer.step(engine, REAL_PARAMS);
    }
    expect(engine.weight[last]).toBeCloseTo(0.1, 2);
  });

  it('does not learn when the downstream spark comes too early', () => {
    // The wave needs 9 ticks to cross 9 cells; before that there is nothing
    // for the neuron to be caused by.
    expect(train(4)).toBeCloseTo(0.1, 2);
    expect(train(8)).toBeCloseTo(0.1, 2);
  });

  it('learns to full weight once the spark lands inside the causal window', () => {
    expect(train(9)).toBeCloseTo(1, 2);
    expect(train(14)).toBeCloseTo(1, 2);
  });
});

// The headline objective is billed as the point of the whole lab, so "can a
// player actually get there" is worth pinning rather than hoping. Same class of
// question that caught the STDP bug above.
describe('the asynchronous irregular objective is reachable', () => {
  /** A recurrent ring of neurons wired with learned synapses — drawable by hand. */
  function ring(count: number, inhibEvery: number) {
    const engine = new PowderEngine({ width: 120, height: 90, seed: 'ring' });
    const layer = new NeuroLayer(engine.size);
    const cx = 60, cy = 45, radius = 34;
    const spots = Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2;
      return { x: Math.round(cx + radius * Math.cos(angle)), y: Math.round(cy + radius * Math.sin(angle)) };
    });
    spots.forEach((p, i) => engine.setCell(
      p.x, p.y, inhibEvery > 0 && i % inhibEvery === 0 ? Material.INHIB : Material.NEURO,
    ));
    for (let i = 0; i < count; i += 1) {
      const a = spots[i];
      const b = spots[(i + 1) % count];
      let { x, y } = a;
      const stepX = Math.sign(b.x - x);
      const stepY = Math.sign(b.y - y);
      while (x !== b.x) { x += stepX; if (engine.getCell(x, y) === Material.AIR) engine.setCell(x, y, Material.SYNAPSE); }
      while (y !== b.y) { y += stepY; if (engine.getCell(x, y) === Material.AIR) engine.setCell(x, y, Material.SYNAPSE); }
    }
    for (let at = 0; at < engine.size; at += 1) {
      if ((engine.cells[at] & 0x1f) === Material.SYNAPSE) engine.weight[at] = MAX_WEIGHT;
    }
    return { engine, layer, neurons: spots.map((p) => engine.index(p.x, p.y)) };
  }

  function run(inhibEvery: number, drive: number, regular: boolean) {
    const { engine, layer, neurons } = ring(16, inhibEvery);
    const recorder = new RegimeRecorder();
    const rng = createRng(`ai-${inhibEvery}-${drive}-${regular}`);
    for (let tick = 0; tick < WINDOW_TICKS * 3; tick += 1) {
      neurons.forEach((at, i) => {
        const fire = regular ? tick % 20 === 0 : rng() < drive;
        if (fire && engine.timer[at] === 0) engine.voltage[at] = REAL_PARAMS.threshold * 2;
        void i;
      });
      const stats = layer.step(engine, REAL_PARAMS);
      recorder.observe(layer, REAL_PARAMS, stats.neurons, stats.synapses);
    }
    return recorder.current();
  }

  it('lands in AI when the drive is irregular', () => {
    const readout = run(3, 0.06, false);
    expect(readout.cvIsi).toBeGreaterThan(0.5);
    expect(readout.synchrony).toBeLessThan(0.02);
    expect(readout.regime).toBe('AI');
  });

  it('lands somewhere else when the same circuit is driven like a metronome', () => {
    // The circuit is identical; only the timing of the drive changed. That is
    // the lesson the objective is there to teach.
    expect(run(3, 0, true).regime).not.toBe('AI');
  });
});

describe('sparkAt', () => {
  it('charges only neurons, and only inside the brush', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'spark' });
    engine.setCell(5, 5, Material.NEURO);
    engine.setCell(5, 6, Material.SAND);
    engine.setCell(20, 5, Material.NEURO); // outside the brush
    expect(engine.sparkAt(5, 5, 2, 1)).toBe(1);
    expect(engine.voltage[engine.index(5, 5)]).toBe(2);
    expect(engine.voltage[engine.index(5, 6)]).toBe(0);
    expect(engine.voltage[engine.index(20, 5)]).toBe(0);
  });

  it('cannot override a refractory neuron', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'spark' });
    engine.setCell(5, 5, Material.NEURO);
    engine.timer[engine.index(5, 5)] = 4;
    expect(engine.sparkAt(5, 5, 1, 1)).toBe(0);
  });

  it('reports zero when there is nothing to charge', () => {
    const engine = new PowderEngine({ width: 32, height: 16, seed: 'spark' });
    expect(engine.sparkAt(5, 5, 3, 1)).toBe(0);
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
