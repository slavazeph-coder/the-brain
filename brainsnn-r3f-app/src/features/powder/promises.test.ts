// Every promise the palette makes, checked against what the engine does.
//
// Each material ships a `blurb` that appears as its tooltip. Those are claims
// made to a visitor, and they were written alongside the rules rather than
// derived from them — which is exactly how the STDP gap got shipped: a
// documented behaviour that nothing ever exercised end to end.
//
// So this file walks the palette and, for each material, asserts the specific
// thing its blurb says. Where a claim was already covered by powderEngine.test
// it is not duplicated here; what follows is the set that was not.
import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine, FIRE_FUEL } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS, STDP_GAIN, STDP_GAIN_DOPAMINE } from './neuroLayer.ts';
import { MATERIALS, MATERIAL_BY_ID, Material } from './materials.ts';

function grid(width = 40, height = 24, seed = 'promise') {
  return new PowderEngine({ width, height, seed });
}

/** Runs the automaton and reports whether `predicate` ever held. */
function within(engine: PowderEngine, ticks: number, predicate: () => boolean): boolean {
  for (let tick = 0; tick < ticks; tick += 1) {
    if (predicate()) return true;
    engine.tick();
  }
  return predicate();
}

describe('the palette makes no claim it cannot keep', () => {
  it('gives every material a blurb that says something', () => {
    for (const spec of MATERIALS) {
      // Selectable materials carry a tooltip a visitor reads before choosing;
      // byproducts like Rock ("Cooled lava.") only have to be accurate.
      expect(spec.blurb.length).toBeGreaterThan(spec.selectable ? 20 : 8);
    }
  });

  // FIRE: "Rises, consumes oil and plants, dies out."
  // Oil and dying out are covered in powderEngine.test; plants and rising are
  // the halves that were only ever claimed.
  it('fire consumes plants, as both its blurb and the plant blurb promise', () => {
    const engine = grid();
    for (let x = 5; x < 12; x += 1) engine.setCell(x, 20, Material.PLANT);
    engine.setCell(8, 19, Material.FIRE);
    const before = engine.countOf(Material.PLANT);
    for (let tick = 0; tick < 200; tick += 1) engine.tick();
    expect(engine.countOf(Material.PLANT)).toBeLessThan(before);
  });

  it('fire rises when it has nothing left to eat', () => {
    const engine = grid();
    engine.setCell(20, 20, Material.FIRE);
    const startedAt = 20;
    const rose = within(engine, 30, () => {
      for (let y = 0; y < startedAt; y += 1) {
        if (engine.getCell(20, y) === Material.FIRE) return true;
      }
      return false;
    });
    expect(rose).toBe(true);
  });

  // GAS: "Rises and spreads. Ignites violently." Rising is covered; igniting
  // is the claim with nothing behind it.
  it('gas ignites when fire reaches it', () => {
    const engine = grid();
    // A pocket of gas with a flame directly beneath it.
    for (let x = 10; x < 16; x += 1) engine.setCell(x, 10, Material.GAS);
    engine.setCell(12, 11, Material.FIRE);
    const before = engine.countOf(Material.GAS);
    for (let tick = 0; tick < 120; tick += 1) engine.tick();
    expect(engine.countOf(Material.GAS)).toBeLessThan(before);
  });

  // DOPAMINE: "Flows like water, evaporates, boosts learning nearby."
  // Evaporation and the learning boost are covered elsewhere; flowing is not.
  it('dopamine flows sideways rather than stacking, like water', () => {
    const engine = grid();
    for (let y = 18; y < 23; y += 1) engine.setCell(20, y, Material.DOPAMINE);
    const columnBefore = 5;
    for (let tick = 0; tick < 60; tick += 1) engine.tick();

    let inColumn = 0;
    for (let y = 0; y < engine.height; y += 1) {
      if (engine.getCell(20, y) === Material.DOPAMINE) inColumn += 1;
    }
    // Some evaporates on its timer; the claim is that it spread, not that it
    // all survived.
    expect(inColumn).toBeLessThan(columnBefore);
    expect(engine.countOf(Material.DOPAMINE)).toBeGreaterThan(0);
  });

  it('boosts learning by exactly the factor the blurb implies', () => {
    // "boosts learning nearby" is only honest if the gain is actually larger.
    expect(STDP_GAIN_DOPAMINE).toBeGreaterThan(STDP_GAIN);
    expect(STDP_GAIN_DOPAMINE / STDP_GAIN).toBeCloseTo(3, 5);
  });

  // WATER: "Flows and levels." Spreading is covered; levelling — ending up at
  // an even depth rather than a heap — is the stronger half of the claim.
  it('water levels out instead of leaving a heap', () => {
    const engine = grid();
    for (let y = 14; y < 23; y += 1) {
      for (let x = 18; x < 22; x += 1) engine.setCell(x, y, Material.WATER);
    }
    for (let tick = 0; tick < 400; tick += 1) engine.tick();

    // Measure the surface height of each occupied column and compare extremes.
    const heights: number[] = [];
    for (let x = 0; x < engine.width; x += 1) {
      let top = -1;
      for (let y = 0; y < engine.height; y += 1) {
        if (engine.getCell(x, y) === Material.WATER) { top = y; break; }
      }
      if (top >= 0) heights.push(top);
    }
    expect(heights.length).toBeGreaterThan(4);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(3);
  });

  // OIL: "Floats on water." Covered. "Extremely flammable" is comparative, so
  // it is only honest if oil catches more readily than something that is not
  // flagged flammable at all.
  it('burns oil but not sand, which is what "extremely flammable" has to mean', () => {
    // A walled basin, so the fuel cannot spread into a one-cell film whose
    // position is incidental. This is the case the claim is actually about: a
    // pool of the stuff, lit at the surface.
    function burnPool(material: Material) {
      const engine = grid(40, 24, 'pool');
      for (let y = 14; y < 24; y += 1) {
        engine.setCell(12, y, Material.WALL);
        engine.setCell(25, y, Material.WALL);
      }
      for (let y = 16; y < 23; y += 1) {
        for (let x = 13; x < 25; x += 1) engine.setCell(x, y, material);
      }
      for (let tick = 0; tick < 40; tick += 1) engine.tick();
      const before = engine.countOf(material);

      let topY = engine.height;
      for (let y = 0; y < engine.height; y += 1) {
        for (let x = 13; x < 25; x += 1) if (engine.getCell(x, y) === material && y < topY) topY = y;
      }
      engine.setCell(18, topY - 1, Material.FIRE);
      for (let tick = 0; tick < 250; tick += 1) engine.tick();
      return { before, after: engine.countOf(material) };
    }

    const oil = burnPool(Material.OIL);
    expect(oil.before).toBeGreaterThan(50);
    // "Extremely flammable" has to mean the pool goes up, not that one cell
    // is nibbled. Measured: 84 cells to zero within ~120 ticks.
    expect(oil.after).toBe(0);

    const sand = burnPool(Material.SAND);
    expect(sand.after).toBe(sand.before);
  });

  // NEURO / SYNAPSE / INHIB claims are exercised in neuroLayer.test; the one
  // worth restating here is the palette's own wording, because "one cell per
  // tick" is a number a visitor can check with their eyes.
  it('carries a spike exactly one cell per tick, as the synapse blurb says', () => {
    const engine = grid(40, 12, 'wire');
    const layer = new NeuroLayer(engine.size);
    engine.setCell(2, 6, Material.NEURO);
    for (let x = 3; x < 20; x += 1) engine.setCell(x, 6, Material.SYNAPSE);
    engine.voltage[engine.index(2, 6)] = GAME_PARAMS.threshold * 2;

    // After n steps the head should be n cells along, not further.
    for (let step = 1; step <= 8; step += 1) {
      layer.step(engine, GAME_PARAMS);
      const head = 2 + step;
      expect(layer.quietFor(engine.index(head, 6))).toBe(0);
      if (head + 1 < 20) {
        expect(layer.quietFor(engine.index(head + 1, 6))).toBeGreaterThan(0);
      }
    }
  });

  it('starts fire with fuel so "dies out" is a promise it can keep', () => {
    const engine = grid();
    engine.setCell(10, 10, Material.FIRE);
    expect(engine.getScratch(engine.index(10, 10))).toBe(FIRE_FUEL);
  });

  // The blurbs name other materials by name. A rename would leave the text
  // pointing at something that no longer exists.
  it('only names materials that exist', () => {
    const names = new Set(MATERIALS.map((spec) => spec.name.toLowerCase()));
    const mentioned = ['sand', 'water', 'wall', 'fire', 'plant', 'oil', 'glass', 'rock', 'steam'];
    for (const name of mentioned) {
      const referenced = MATERIALS.some((spec) => spec.blurb.toLowerCase().includes(name));
      if (!referenced) continue;
      expect(names.has(name)).toBe(true);
    }
  });

  it('describes the eraser the way the page actually behaves', () => {
    // AIR's blurb tells the visitor right-click erases to it, so AIR has to be
    // what an erase produces.
    expect(MATERIAL_BY_ID[Material.AIR].blurb.toLowerCase()).toContain('erase');
    const engine = grid();
    engine.setCell(5, 5, Material.SAND);
    engine.brushDraw(5, 5, 1, Material.AIR);
    expect(engine.getCell(5, 5)).toBe(Material.AIR);
  });
});
