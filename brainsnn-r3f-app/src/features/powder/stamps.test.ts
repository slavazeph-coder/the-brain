import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS, MAX_WEIGHT, REAL_PARAMS } from './neuroLayer.ts';
import { Material } from './materials.ts';
import { applyStamp, OPENING_SCENE, STAMPS, STAMP_LEGEND_KEYS, STARTER_CIRCUIT } from './stamps.ts';
import { renderGrid } from './renderGrid.ts';

function blankImage(size: number) {
  return { data: new Uint8ClampedArray(size * 4) };
}

describe('stamps', () => {
  it('uses only characters the legend knows', () => {
    const known = new Set(STAMP_LEGEND_KEYS);
    for (const stamp of [...STAMPS, OPENING_SCENE]) {
      for (const row of stamp.rows) {
        for (const character of row) {
          // A typo in a stamp would otherwise silently place nothing.
          expect(known.has(character) || character === ' ').toBe(true);
        }
      }
    }
  });

  it('gives every stamp a unique id and a blurb', () => {
    expect(new Set(STAMPS.map((s) => s.id)).size).toBe(STAMPS.length);
    for (const stamp of STAMPS) expect(stamp.blurb.length).toBeGreaterThan(10);
  });

  it('places cells where it is told', () => {
    const engine = new PowderEngine({ width: 40, height: 20, seed: 's' });
    const placed = applyStamp(engine, STARTER_CIRCUIT, 5, 10);
    expect(placed).toBeGreaterThan(0);
    expect(engine.getCell(5, 10)).toBe(Material.NEURO);
    expect(engine.getCell(6, 10)).toBe(Material.SYNAPSE);
  });

  it('leaves dots alone so a stamp can overlay existing work', () => {
    const engine = new PowderEngine({ width: 40, height: 20, seed: 's' });
    engine.setCell(6, 11, Material.WALL);
    applyStamp(engine, { id: 't', name: 't', blurb: 'x', rows: ['NNN', '...'] }, 5, 10);
    expect(engine.getCell(6, 11)).toBe(Material.WALL);
  });

  it('clips at the edge rather than wrapping', () => {
    const engine = new PowderEngine({ width: 20, height: 10, seed: 's' });
    applyStamp(engine, STARTER_CIRCUIT, 18, 5);
    expect(engine.getCell(0, 5)).toBe(Material.AIR);
    expect(engine.getCell(0, 6)).toBe(Material.AIR);
  });

  // The opening scene is what a first visitor sees; if it does not fire, the
  // page looks broken on arrival.
  it('gives the opening scene a circuit that actually spikes', () => {
    const engine = new PowderEngine({ seed: 'opening' });
    const layer = new NeuroLayer(engine.size);
    applyStamp(engine, OPENING_SCENE, 20, 34);
    expect(engine.countOf(Material.NEURO)).toBeGreaterThan(3);
    expect(engine.countOf(Material.SYNAPSE)).toBeGreaterThan(50);

    for (let at = 0; at < engine.size; at += 1) {
      const kind = engine.cells[at] & 0x1f;
      if (kind === Material.NEURO || kind === Material.INHIB) {
        engine.voltage[at] = GAME_PARAMS.threshold * 2;
      }
    }
    let spikes = 0;
    for (let tick = 0; tick < 40; tick += 1) spikes += layer.step(engine, GAME_PARAMS).spikes;
    expect(spikes).toBeGreaterThan(0);
  });

  // Dopamine is a liquid. An open pool drains on the first tick, which is why
  // the opening scene puts it in a walled basin.
  it('keeps the opening scene dopamine from draining away', () => {
    const engine = new PowderEngine({ seed: 'basin' });
    applyStamp(engine, OPENING_SCENE, 20, 34);
    const before = engine.countOf(Material.DOPAMINE);
    expect(before).toBeGreaterThan(20);
    for (let tick = 0; tick < 40; tick += 1) engine.tick();
    // Some evaporates on its timer; the point is that most is still there.
    expect(engine.countOf(Material.DOPAMINE)).toBeGreaterThan(before * 0.8);
  });
});

// Stamp blurbs are claims a visitor reads before pressing anything, and they
// were written alongside the circuits rather than derived from them. Two were
// measurably false before these tests existed.
describe('every stamp does what its blurb says', () => {
  function stamp(id: string) {
    const found = STAMPS.find((s) => s.id === id);
    if (!found) throw new Error(`no stamp ${id}`);
    return found;
  }

  function neuronsOf(engine: PowderEngine) {
    const out: number[] = [];
    for (let at = 0; at < engine.size; at += 1) {
      if ((engine.cells[at] & 0x1f) === Material.NEURO) out.push(at);
    }
    return out;
  }

  it('keeps the learning bench dopamine in its trough instead of dripping on the wire', () => {
    const engine = new PowderEngine({ seed: 'trough' });
    applyStamp(engine, stamp('learning'), 30, 60);
    const before = engine.countOf(Material.DOPAMINE);
    expect(before).toBeGreaterThan(30);
    for (let tick = 0; tick < 60; tick += 1) engine.tick();
    // Some evaporates on its timer; none should have escaped the trough.
    expect(engine.countOf(Material.DOPAMINE)).toBeGreaterThan(before * 0.8);
    for (let x = 30; x < 72; x += 1) {
      expect(engine.getCell(x, 62)).not.toBe(Material.DOPAMINE);
    }
  });

  it('places a learned synapse for "=" and a fresh one for "-"', () => {
    const engine = new PowderEngine({ width: 20, height: 8, seed: 'legend' });
    applyStamp(engine, { id: 'x', name: 'x', blurb: 'x'.repeat(20), rows: ['-='] }, 2, 3);
    expect(engine.weight[engine.index(2, 3)]).toBeCloseTo(0.1, 3);
    expect(engine.weight[engine.index(3, 3)]).toBeCloseTo(MAX_WEIGHT, 3);
  });

  // "Spark the left neuron, then the right one about two-thirds of a second
  // later." The previous blurb said to press Stimulate, which fires both ends
  // on the same tick — so the synapse never spiked before the far neuron and
  // the weight never moved off its floor. That was shipped and false.
  it('learning bench trains under the protocol its blurb describes', () => {
    for (const params of [GAME_PARAMS, REAL_PARAMS]) {
      const engine = new PowderEngine({ seed: 'bench' });
      const layer = new NeuroLayer(engine.size);
      applyStamp(engine, stamp('learning'), 30, 60);
      const neurons = neuronsOf(engine);
      const left = Math.min(...neurons);
      const right = Math.max(...neurons);

      for (let tick = 0; tick < 4000; tick += 1) {
        const phase = tick % 90;
        if (phase === 0) engine.voltage[left] = params.threshold * 2;
        if (phase === 41) engine.voltage[right] = params.threshold * 2; // ~2/3 s at 60 fps
        engine.tick();
        layer.step(engine, params);
      }

      let best = 0;
      for (let at = 0; at < engine.size; at += 1) {
        if ((engine.cells[at] & 0x1f) === Material.SYNAPSE) best = Math.max(best, engine.weight[at]);
      }
      expect(best).toBeCloseTo(MAX_WEIGHT, 2);
    }
  });

  it('learning bench teaches nothing when both ends fire together', () => {
    // The negative case, which is what the old blurb told you to do.
    const engine = new PowderEngine({ seed: 'bench-neg' });
    const layer = new NeuroLayer(engine.size);
    applyStamp(engine, stamp('learning'), 30, 60);
    for (let tick = 0; tick < 3000; tick += 1) {
      if (tick % 30 === 0) {
        for (const at of neuronsOf(engine)) {
          if (engine.timer[at] === 0) engine.voltage[at] = REAL_PARAMS.threshold * 2;
        }
      }
      engine.tick();
      layer.step(engine, REAL_PARAMS);
    }
    let best = 0;
    for (let at = 0; at < engine.size; at += 1) {
      if ((engine.cells[at] & 0x1f) === Material.SYNAPSE) best = Math.max(best, engine.weight[at]);
    }
    expect(best).toBeCloseTo(0.1, 3);
  });

  // The loop's corners used to be blank, leaving four dead-end stubs rather
  // than a ring, so nothing ever went round it.
  it('feedback loop is a closed ring, not four stubs', () => {
    const engine = new PowderEngine({ seed: 'ring' });
    const layer = new NeuroLayer(engine.size);
    applyStamp(engine, stamp('loop'), 100, 70);
    const neurons = neuronsOf(engine);
    expect(neurons.length).toBe(2);

    // Every synapse in the stamp must connect to at least two others, which a
    // dead-end stub cannot.
    let stubs = 0;
    for (let at = 0; at < engine.size; at += 1) {
      if ((engine.cells[at] & 0x1f) !== Material.SYNAPSE) continue;
      const x = at % engine.width;
      const y = (at / engine.width) | 0;
      let links = 0;
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const kind = engine.getCell(x + dx, y + dy);
        if (kind === Material.SYNAPSE || kind === Material.NEURO) links += 1;
      }
      if (links < 2) stubs += 1;
    }
    expect(stubs).toBe(0);
    void layer;
  });

  it('feedback loop needs both arms under the Brunel model, as its blurb says', () => {
    function farNeuronFires(cutOneArm: boolean, params: typeof REAL_PARAMS) {
      const engine = new PowderEngine({ seed: 'coin' });
      const layer = new NeuroLayer(engine.size);
      applyStamp(engine, stamp('loop'), 100, 70);
      if (cutOneArm) engine.setCell(104, 74, Material.AIR);
      const neurons = neuronsOf(engine);
      const near = Math.min(...neurons);
      const far = Math.max(...neurons);
      engine.voltage[near] = params.threshold * 2;
      for (let tick = 0; tick < 200; tick += 1) {
        engine.tick();
        layer.step(engine, params);
        if (layer.isFiring(far)) return true;
      }
      return false;
    }
    // Two arms arrive on the same tick; one arrival of 12 mV cannot lift a
    // resting neuron to a 20 mV threshold, but two can.
    expect(farNeuronFires(false, REAL_PARAMS)).toBe(true);
    expect(farNeuronFires(true, REAL_PARAMS)).toBe(false);
    // The blurb scopes the claim to the Brunel model, and it has to: under the
    // game constants a single learned arrival already clears threshold.
    expect(farNeuronFires(true, GAME_PARAMS)).toBe(true);
  });

  it('simple circuit drives the far neuron, but only on the second spark', () => {
    function run(sparks: number) {
      const engine = new PowderEngine({ seed: 'starter' });
      const layer = new NeuroLayer(engine.size);
      applyStamp(engine, STARTER_CIRCUIT, 40, 40);
      const neurons = neuronsOf(engine);
      const near = Math.min(...neurons);
      const far = Math.max(...neurons);

      let fired = false;
      let peak = 0;
      for (let tick = 0; tick < 120; tick += 1) {
        // Sparks 8 ticks apart, close enough that the second lands before the
        // first has leaked away.
        if (tick % 8 === 0 && tick / 8 < sparks && engine.timer[near] === 0) {
          engine.voltage[near] = REAL_PARAMS.threshold * 2;
        }
        engine.tick();
        layer.step(engine, REAL_PARAMS);
        peak = Math.max(peak, engine.voltage[far]);
        if (layer.isFiring(far)) fired = true;
      }
      return { fired, peak };
    }

    // One arrival is 12 mV against a 20 mV threshold from rest: visible charge,
    // no spike. This is the shape REAL_PSP_GAIN was chosen to produce.
    const once = run(1);
    expect(once.fired).toBe(false);
    expect(once.peak).toBeGreaterThan(5);
    expect(run(4).fired).toBe(true);
  });
});

describe('renderGrid', () => {
  it('fills every pixel opaque', () => {
    const engine = new PowderEngine({ width: 8, height: 8, seed: 'r' });
    const image = blankImage(engine.size);
    renderGrid(engine, null, image);
    for (let at = 0; at < engine.size; at += 1) {
      expect(image.data[at * 4 + 3]).toBe(255);
    }
  });

  it('paints materials in their declared colour', () => {
    const engine = new PowderEngine({ width: 8, height: 8, seed: 'r' });
    engine.setCell(1, 1, Material.WATER); // #3a86ff
    const image = blankImage(engine.size);
    renderGrid(engine, null, image, { showCharge: false, showWeight: false });
    const at = engine.index(1, 1) * 4;
    expect(image.data[at]).toBe(0x3a);
    expect(image.data[at + 1]).toBe(0x86);
    expect(image.data[at + 2]).toBe(0xff);
  });

  it('flashes a firing neuron white', () => {
    const engine = new PowderEngine({ width: 8, height: 8, seed: 'r' });
    const layer = new NeuroLayer(engine.size);
    engine.setCell(2, 2, Material.NEURO);
    engine.voltage[engine.index(2, 2)] = GAME_PARAMS.threshold * 2;
    layer.step(engine, GAME_PARAMS);
    const image = blankImage(engine.size);
    renderGrid(engine, layer, image);
    const at = engine.index(2, 2) * 4;
    expect(image.data[at]).toBe(255);
    expect(image.data[at + 1]).toBe(255);
    expect(image.data[at + 2]).toBe(255);
  });

  // Weight-as-brightness is what makes a learned circuit look learned.
  it('draws a strong synapse brighter than a weak one', () => {
    const engine = new PowderEngine({ width: 8, height: 8, seed: 'r' });
    engine.setCell(1, 1, Material.SYNAPSE);
    engine.setCell(3, 1, Material.SYNAPSE);
    engine.weight[engine.index(3, 1)] = 1;
    const image = blankImage(engine.size);
    renderGrid(engine, null, image);
    const weak = image.data[engine.index(1, 1) * 4 + 2];
    const strong = image.data[engine.index(3, 1) * 4 + 2];
    expect(strong).toBeGreaterThan(weak);
  });
});
