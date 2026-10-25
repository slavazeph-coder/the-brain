import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { Material } from './materials.ts';
import {
  GAME_PARAMS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  NeuroLayer,
  PARAM_SETS,
  REAL_PARAMS,
  REAL_PSP_GAIN,
  SPIKE_TICKS,
  STDP_WINDOW,
  type NeuroParams,
} from './neuroLayer.ts';
import { BRUNEL_DEFAULTS } from '../../lib/snn/lifNetwork.js';

/**
 * The canonical circuit from the brief: NEURO -> SYNAPSE wire -> NEURO.
 * Returns the engine, the layer, and the two neuron indices.
 */
function circuit(wireLength = 5, width = 40, height = 12) {
  const engine = new PowderEngine({ width, height, seed: 'neuro' });
  const layer = new NeuroLayer(engine.size);
  const y = 5;
  engine.setCell(4, y, Material.NEURO);
  for (let i = 1; i <= wireLength; i += 1) engine.setCell(4 + i, y, Material.SYNAPSE);
  engine.setCell(5 + wireLength, y, Material.NEURO);
  return {
    engine,
    layer,
    source: engine.index(4, y),
    target: engine.index(5 + wireLength, y),
    firstWire: engine.index(5, y),
    lastWire: engine.index(4 + wireLength, y),
    y,
  };
}

/**
 * Push a unit over threshold without depending on how it got there.
 * Comfortably suprathreshold on purpose: the tick applies leak *before* the
 * threshold check (matching lifNetwork.js, which does `v * decay + arriving`),
 * so a value set exactly at threshold decays under it and never fires.
 */
function charge(engine: PowderEngine, at: number, params: NeuroParams) {
  engine.voltage[at] = params.threshold * 2 + 1;
}

function stepAll(engine: PowderEngine, layer: NeuroLayer, params: NeuroParams, ticks: number) {
  const totals = { fired: 0, spikes: 0 };
  for (let i = 0; i < ticks; i += 1) {
    const stats = layer.step(engine, params);
    totals.fired += stats.fired;
    totals.spikes += stats.spikes;
  }
  return totals;
}

describe('parameter sets', () => {
  it('offers exactly the two the lab switches between', () => {
    expect(PARAM_SETS.length).toBe(2);
    expect(PARAM_SETS.map((p) => p.id).join()).toBe('game,real');
  });

  // The real set must come from the validated network, not be retyped, or the
  // two can drift apart silently.
  it('derives the real model from BRUNEL_DEFAULTS', () => {
    expect(REAL_PARAMS.threshold).toBe(BRUNEL_DEFAULTS.vThreshold);
    expect(REAL_PARAMS.reset).toBe(BRUNEL_DEFAULTS.vReset);
    expect(REAL_PARAMS.refractoryTicks).toBe(BRUNEL_DEFAULTS.refractoryMs);
    expect(REAL_PARAMS.inhibitoryFactor).toBe(-BRUNEL_DEFAULTS.g);
  });

  // lifNetwork.js uses an exact exponential rather than a forward-Euler step.
  it('decays with the same exact exponential lifNetwork uses', () => {
    expect(REAL_PARAMS.decay).toBe(Math.exp(-1 / BRUNEL_DEFAULTS.tauMs));
    expect(REAL_PARAMS.decay).toBeLessThan(1);
    expect(REAL_PARAMS.decay).toBeGreaterThan(0.9);
  });

  // The one deliberate departure, stated in the note so it cannot be mistaken
  // for a faithful reproduction.
  it('says plainly that the amplitude is scaled', () => {
    expect(REAL_PARAMS.psp).toBe(BRUNEL_DEFAULTS.J * REAL_PSP_GAIN);
    expect(REAL_PARAMS.note).toContain('scaled');
  });

  it('makes inhibition stronger than excitation in both sets', () => {
    for (const params of PARAM_SETS) {
      expect(params.inhibitoryFactor).toBeLessThan(0);
      expect(Math.abs(params.inhibitoryFactor)).toBeGreaterThanOrEqual(0.5);
    }
  });
});

// The brief's acceptance criterion, for both parameter sets.
describe('a drawn circuit spikes', () => {
  for (const params of PARAM_SETS) {
    it(`propagates NEURO -> SYNAPSE -> NEURO (${params.id})`, () => {
      const c = circuit(5);
      charge(c.engine, c.source, params);
      const totals = stepAll(c.engine, c.layer, params, 60);
      expect(totals.spikes).toBeGreaterThan(0);
      // The downstream neuron must actually receive charge.
      expect(c.engine.voltage[c.target] !== 0 || totals.fired > 1).toBe(true);
    });
  }

  it('carries the spike all the way down a long wire', () => {
    const c = circuit(20, 60);
    charge(c.engine, c.source, GAME_PARAMS);
    // Enough ticks for one cell per tick to cross twenty cells.
    stepAll(c.engine, c.layer, GAME_PARAMS, 60);
    expect(c.layer.quietFor(c.lastWire)).toBeLessThan(0xffff);
  });

  // Delay proportional to length is the property that makes drawing a long
  // axon mean something, so it is pinned rather than left to chance.
  it('takes longer to cross a longer wire', () => {
    function arrival(length: number): number {
      const c = circuit(length, 80);
      charge(c.engine, c.source, GAME_PARAMS);
      for (let tick = 1; tick <= 200; tick += 1) {
        c.layer.step(c.engine, GAME_PARAMS);
        if (c.layer.quietFor(c.lastWire) === 0) return tick;
      }
      return -1;
    }
    const short = arrival(4);
    const long = arrival(24);
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it('does nothing without a stimulus', () => {
    const c = circuit(5);
    const totals = stepAll(c.engine, c.layer, GAME_PARAMS, 80);
    expect(totals.spikes).toBe(0);
    expect(totals.fired).toBe(0);
  });

  it('does not conduct across a gap in the wire', () => {
    const engine = new PowderEngine({ width: 40, height: 12, seed: 'gap' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.NEURO);
    engine.setCell(5, 5, Material.SYNAPSE);
    // (6,5) deliberately left as air
    engine.setCell(7, 5, Material.SYNAPSE);
    charge(engine, engine.index(4, 5), GAME_PARAMS);
    stepAll(engine, layer, GAME_PARAMS, 40);
    expect(layer.quietFor(engine.index(7, 5))).toBe(0xffff);
  });
});

// The core gameplay shape, and the reason REAL_PSP_GAIN exists: a fresh synapse
// visibly charges its target but cannot fire it, and a learned one can. That is
// what makes STDP and dopamine worth using rather than decoration -- and it has
// to hold in BOTH parameter sets or the real-model toggle is a dead switch.
describe('learning changes what a circuit can do', () => {
  function peakAndFires(params: NeuroParams, weight: number) {
    const engine = new PowderEngine({ width: 20, height: 12, seed: 'shape' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.NEURO);
    engine.setCell(5, 5, Material.SYNAPSE);
    engine.setCell(6, 5, Material.NEURO);
    engine.weight[engine.index(5, 5)] = weight;
    const post = engine.index(6, 5);
    let peak = 0;
    let fires = 0;
    for (let burst = 0; burst < 8; burst += 1) {
      charge(engine, engine.index(4, 5), params);
      for (let t = 0; t < 8; t += 1) {
        const before = engine.timer[post];
        layer.step(engine, params);
        peak = Math.max(peak, engine.voltage[post]);
        if (engine.timer[post] > before && engine.timer[post] === params.refractoryTicks) fires += 1;
      }
    }
    return { peak, fires };
  }

  for (const params of PARAM_SETS) {
    it(`charges but does not fire through a fresh synapse (${params.id})`, () => {
      const fresh = peakAndFires(params, MIN_WEIGHT);
      expect(fresh.peak).toBeGreaterThan(0);
      expect(fresh.peak).toBeLessThan(params.threshold);
      expect(fresh.fires).toBe(0);
    });

    it(`fires through a fully learned synapse (${params.id})`, () => {
      const learned = peakAndFires(params, MAX_WEIGHT);
      expect(learned.fires).toBeGreaterThan(0);
    });
  }
});

describe('spike mechanics', () => {
  it('marks a fired neuron so the renderer can flash it', () => {
    const c = circuit(3);
    charge(c.engine, c.source, GAME_PARAMS);
    c.layer.step(c.engine, GAME_PARAMS);
    expect(c.layer.isFiring(c.source)).toBe(true);
  });

  it('resets a fired neuron and holds it refractory', () => {
    const c = circuit(3);
    charge(c.engine, c.source, GAME_PARAMS);
    c.layer.step(c.engine, GAME_PARAMS);
    expect(c.engine.voltage[c.source]).toBe(GAME_PARAMS.reset);
    expect(c.engine.timer[c.source]).toBeGreaterThan(0);
  });

  it('ignores input while refractory', () => {
    const c = circuit(3);
    charge(c.engine, c.source, GAME_PARAMS);
    c.layer.step(c.engine, GAME_PARAMS);
    // Try to drive it again immediately; the refractory clamp must win.
    c.engine.voltage[c.source] = GAME_PARAMS.threshold + 5;
    const stats = c.layer.step(c.engine, GAME_PARAMS);
    expect(stats.fired).toBe(0);
    expect(c.engine.voltage[c.source]).toBe(GAME_PARAMS.reset);
  });

  it('leaks charge away when input stops', () => {
    const c = circuit(3);
    c.engine.voltage[c.source] = GAME_PARAMS.threshold * 0.5;
    const before = c.engine.voltage[c.source];
    stepAll(c.engine, c.layer, GAME_PARAMS, 10);
    expect(c.engine.voltage[c.source]).toBeLessThan(before);
  });

  // Without a refractory tail a spike reflects off the wire end and oscillates
  // forever. The Wireworld head/tail scheme is what prevents that.
  it('does not reflect a spike back down the wire', () => {
    const c = circuit(6);
    charge(c.engine, c.source, GAME_PARAMS);
    const totals = stepAll(c.engine, c.layer, GAME_PARAMS, 200);
    // A reflecting spike would keep re-triggering; a single stimulus should
    // produce a bounded number of synapse activations.
    expect(totals.spikes).toBeLessThan(40);
  });

  it('holds a synapse visibly spiking for the specified duration', () => {
    const c = circuit(4);
    charge(c.engine, c.source, GAME_PARAMS);
    c.layer.step(c.engine, GAME_PARAMS); // neuron fires, marks pending
    expect(c.engine.timer[c.firstWire]).toBeGreaterThanOrEqual(SPIKE_TICKS);
  });
});

describe('inhibition', () => {
  it('drives a target negative instead of positive', () => {
    const width = 40;
    const engine = new PowderEngine({ width, height: 12, seed: 'inhib' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.INHIB);
    engine.setCell(5, 5, Material.SYNAPSE);
    engine.setCell(6, 5, Material.NEURO);
    const target = engine.index(6, 5);
    charge(engine, engine.index(4, 5), GAME_PARAMS);
    stepAll(engine, layer, GAME_PARAMS, 10);
    expect(engine.voltage[target]).toBeLessThan(0);
  });

  it('sends a positive spike from an excitatory neuron on the same wiring', () => {
    const engine = new PowderEngine({ width: 40, height: 12, seed: 'excite' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.NEURO);
    engine.setCell(5, 5, Material.SYNAPSE);
    engine.setCell(6, 5, Material.NEURO);
    const target = engine.index(6, 5);
    charge(engine, engine.index(4, 5), GAME_PARAMS);
    stepAll(engine, layer, GAME_PARAMS, 10);
    expect(engine.voltage[target]).toBeGreaterThan(0);
  });
});

describe('learning', () => {
  it('starts a fresh synapse weak so learning has somewhere to go', () => {
    const engine = new PowderEngine({ width: 10, height: 10, seed: 'w' });
    engine.setCell(3, 3, Material.SYNAPSE);
    expect(engine.weight[engine.index(3, 3)]).toBeCloseTo(MIN_WEIGHT);
  });

  /**
   * Pre-before-post: the synapse spikes, then the downstream neuron fires
   * within the window, so the synapse gets credit.
   */
  function stdpRun(withDopamine: boolean): number {
    const engine = new PowderEngine({ width: 20, height: 12, seed: 'stdp' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.NEURO);
    engine.setCell(5, 5, Material.SYNAPSE);
    engine.setCell(6, 5, Material.NEURO);
    if (withDopamine) engine.setCell(6, 3, Material.DOPAMINE);
    const wire = engine.index(5, 5);
    const post = engine.index(6, 5);

    for (let round = 0; round < 6; round += 1) {
      charge(engine, engine.index(4, 5), GAME_PARAMS);
      layer.step(engine, GAME_PARAMS); // pre fires, wire pending
      layer.step(engine, GAME_PARAMS); // wire becomes head
      charge(engine, post, GAME_PARAMS); // post fires inside the window
      layer.step(engine, GAME_PARAMS);
      for (let idle = 0; idle < 14; idle += 1) layer.step(engine, GAME_PARAMS);
    }
    return engine.weight[wire];
  }

  it('strengthens a synapse that helped cause a spike', () => {
    expect(stdpRun(false)).toBeGreaterThan(MIN_WEIGHT);
  });

  it('learns faster with dopamine present', () => {
    expect(stdpRun(true)).toBeGreaterThan(stdpRun(false));
  });

  it('never pushes weight outside its range', () => {
    const engine = new PowderEngine({ width: 20, height: 12, seed: 'clamp' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.NEURO);
    engine.setCell(5, 5, Material.SYNAPSE);
    engine.setCell(6, 5, Material.NEURO);
    engine.setCell(6, 3, Material.DOPAMINE);
    const wire = engine.index(5, 5);
    for (let round = 0; round < 60; round += 1) {
      charge(engine, engine.index(4, 5), GAME_PARAMS);
      layer.step(engine, GAME_PARAMS);
      layer.step(engine, GAME_PARAMS);
      charge(engine, engine.index(6, 5), GAME_PARAMS);
      layer.step(engine, GAME_PARAMS);
    }
    expect(engine.weight[wire]).toBeLessThanOrEqual(MAX_WEIGHT);
    expect(engine.weight[wire]).toBeGreaterThanOrEqual(MIN_WEIGHT);
  });

  it('does not reward a synapse that spiked long before the neuron fired', () => {
    const engine = new PowderEngine({ width: 20, height: 12, seed: 'late' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(4, 5, Material.NEURO);
    engine.setCell(5, 5, Material.SYNAPSE);
    engine.setCell(6, 5, Material.NEURO);
    const wire = engine.index(5, 5);

    charge(engine, engine.index(4, 5), GAME_PARAMS);
    layer.step(engine, GAME_PARAMS);
    layer.step(engine, GAME_PARAMS);
    // Wait well past the causal window before firing the downstream neuron.
    for (let i = 0; i < STDP_WINDOW * 4; i += 1) layer.step(engine, GAME_PARAMS);
    const before = engine.weight[wire];
    charge(engine, engine.index(6, 5), GAME_PARAMS);
    layer.step(engine, GAME_PARAMS);
    expect(engine.weight[wire]).toBeLessThanOrEqual(before);
  });

  it('lets an unused synapse fade', () => {
    const engine = new PowderEngine({ width: 12, height: 12, seed: 'decay' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(5, 5, Material.SYNAPSE);
    const wire = engine.index(5, 5);
    engine.weight[wire] = MAX_WEIGHT;
    for (let i = 0; i < 400; i += 1) layer.step(engine, GAME_PARAMS);
    expect(engine.weight[wire]).toBeLessThan(MAX_WEIGHT);
    expect(engine.weight[wire]).toBeGreaterThanOrEqual(MIN_WEIGHT);
  });
});

describe('stats', () => {
  it('counts what the HUD reports', () => {
    const c = circuit(5);
    const stats = c.layer.step(c.engine, GAME_PARAMS);
    expect(stats.neurons).toBe(2);
    expect(stats.synapses).toBe(5);
    expect(stats.meanWeight).toBeCloseTo(MIN_WEIGHT);
  });

  it('counts dopamine cells', () => {
    const c = circuit(3);
    c.engine.setCell(2, 2, Material.DOPAMINE);
    expect(c.layer.step(c.engine, GAME_PARAMS).dopamineCells).toBe(1);
  });

  it('resets cleanly', () => {
    const c = circuit(3);
    charge(c.engine, c.source, GAME_PARAMS);
    c.layer.step(c.engine, GAME_PARAMS);
    c.layer.reset();
    expect(c.layer.isFiring(c.source)).toBe(false);
    expect(c.layer.quietFor(c.firstWire)).toBe(0xffff);
  });
});
