import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS } from './neuroLayer.ts';
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
