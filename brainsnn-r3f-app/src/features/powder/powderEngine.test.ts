import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine, DEFAULT_HEIGHT, DEFAULT_WIDTH, BOIL_TEMPERATURE } from './powderEngine.ts';
import { Material, DENSITY, MATERIALS, MATERIAL_BY_ID, SELECTABLE_MATERIALS, materialByHotkey } from './materials.ts';

function engine(width = 24, height = 16, seed = 'test') {
  return new PowderEngine({ width, height, seed });
}

/** Run n ticks and hand back the engine, for readability in assertions. */
function run(sim: PowderEngine, ticks: number): PowderEngine {
  for (let i = 0; i < ticks; i += 1) sim.tick();
  return sim;
}

describe('material table', () => {
  it('gives every material a unique id', () => {
    expect(new Set(MATERIALS.map((m) => m.id)).size).toBe(MATERIALS.length);
  });

  it('indexes every material by id', () => {
    for (const spec of MATERIALS) expect(MATERIAL_BY_ID[spec.id].name).toBe(spec.name);
  });

  it('offers the 14 the brief specifies in the palette', () => {
    expect(SELECTABLE_MATERIALS.length).toBe(14);
  });

  it('gives every selectable material a unique hotkey', () => {
    const keys = SELECTABLE_MATERIALS.map((m) => m.hotkey);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('resolves hotkeys case-insensitively', () => {
    expect(materialByHotkey('2')).toBe(Material.SAND);
    expect(materialByHotkey('w')).toBe(Material.NEURO);
    expect(materialByHotkey('W')).toBe(Material.NEURO);
    expect(materialByHotkey('~')).toBe(null);
  });

  it('orders densities so heavier things sink', () => {
    expect(DENSITY[Material.SAND]).toBeGreaterThan(DENSITY[Material.WATER]);
    expect(DENSITY[Material.WATER]).toBeGreaterThan(DENSITY[Material.OIL]);
    expect(DENSITY[Material.LAVA]).toBeGreaterThan(DENSITY[Material.SAND]);
    expect(DENSITY[Material.GAS]).toBeLessThan(0);
  });
});

describe('grid basics', () => {
  it('defaults to the specified 240x160 grid', () => {
    const sim = new PowderEngine();
    expect(sim.width).toBe(DEFAULT_WIDTH);
    expect(sim.height).toBe(DEFAULT_HEIGHT);
    expect(sim.size).toBe(DEFAULT_WIDTH * DEFAULT_HEIGHT);
  });

  it('starts empty', () => {
    expect(engine().countNonEmpty()).toBe(0);
  });

  it('round-trips a cell', () => {
    const sim = engine();
    sim.setCell(3, 4, Material.SAND);
    expect(sim.getCell(3, 4)).toBe(Material.SAND);
  });

  // Out-of-bounds reads as WALL so edge logic never needs a special case.
  it('treats out of bounds as solid rather than throwing', () => {
    const sim = engine();
    expect(sim.getCell(-1, 0)).toBe(Material.WALL);
    expect(sim.getCell(0, -1)).toBe(Material.WALL);
    expect(sim.getCell(999, 999)).toBe(Material.WALL);
    expect(() => sim.setCell(-5, -5, Material.SAND)).not.toThrow?.();
  });

  it('packs temperature and scratch without corrupting the material', () => {
    const sim = engine();
    sim.setCell(2, 2, Material.WATER);
    const at = sim.index(2, 2);
    sim.setTemperature(at, 210);
    sim.setScratch(at, 999);
    expect(sim.getCell(2, 2)).toBe(Material.WATER);
    expect(sim.getTemperature(at)).toBe(210);
    expect(sim.getScratch(at)).toBe(999);
  });

  it('clamps temperature and scratch into their fields', () => {
    const sim = engine();
    const at = sim.index(1, 1);
    sim.setTemperature(at, 9999);
    expect(sim.getTemperature(at)).toBeLessThanOrEqual(255);
    sim.setTemperature(at, -50);
    expect(sim.getTemperature(at)).toBe(0);
  });

  it('clears everything', () => {
    const sim = engine();
    sim.brushDraw(5, 5, 3, Material.SAND);
    sim.clear();
    expect(sim.countNonEmpty()).toBe(0);
    expect(sim.ticks).toBe(0);
  });
});

describe('brush', () => {
  it('paints a single cell at radius 0', () => {
    const sim = engine();
    sim.brushDraw(5, 5, 0, Material.SAND);
    expect(sim.countOf(Material.SAND)).toBe(1);
  });

  it('paints a disc, not a square', () => {
    const sim = engine();
    sim.brushDraw(8, 8, 3, Material.SAND);
    // A radius-3 disc is smaller than the 7x7 square that bounds it.
    expect(sim.countOf(Material.SAND)).toBeLessThan(49);
    expect(sim.countOf(Material.SAND)).toBeGreaterThan(20);
    expect(sim.getCell(8, 8)).toBe(Material.SAND);
    expect(sim.getCell(5, 5)).toBe(Material.AIR); // corner of the bounding box
  });

  it('clips at the edges instead of wrapping', () => {
    const sim = engine();
    sim.brushDraw(0, 0, 4, Material.SAND);
    // Nothing should have appeared on the opposite side.
    expect(sim.getCell(sim.width - 1, sim.height - 1)).toBe(Material.AIR);
  });

  // The gap every other canvas lab in this repo has: pointer samples arrive
  // ~16 ms apart, so a fast drag without interpolation draws dots.
  it('draws a continuous line between pointer samples', () => {
    const sim = engine(40, 40);
    sim.brushStroke(2, 2, 30, 30, 0, Material.SAND);
    // Every step of the diagonal is filled — no gaps.
    for (let i = 0; i <= 28; i += 1) {
      expect(sim.getCell(2 + i, 2 + i)).toBe(Material.SAND);
    }
  });

  it('handles a stroke that does not move', () => {
    const sim = engine();
    sim.brushStroke(4, 4, 4, 4, 0, Material.SAND);
    expect(sim.countOf(Material.SAND)).toBe(1);
  });

  it('handles horizontal and vertical strokes', () => {
    const sim = engine(30, 30);
    sim.brushStroke(1, 5, 20, 5, 0, Material.WALL);
    for (let x = 1; x <= 20; x += 1) expect(sim.getCell(x, 5)).toBe(Material.WALL);
    sim.brushStroke(25, 2, 25, 20, 0, Material.WALL);
    for (let y = 2; y <= 20; y += 1) expect(sim.getCell(25, y)).toBe(Material.WALL);
  });
});

describe('gravity and piling', () => {
  it('drops sand to the floor', () => {
    const sim = engine();
    sim.setCell(10, 0, Material.SAND);
    run(sim, 40);
    expect(sim.getCell(10, sim.height - 1)).toBe(Material.SAND);
  });

  it('conserves sand while it falls', () => {
    const sim = engine();
    sim.brushDraw(12, 3, 3, Material.SAND);
    const before = sim.countOf(Material.SAND);
    run(sim, 60);
    expect(sim.countOf(Material.SAND)).toBe(before);
  });

  it('never lets a particle leave the grid', () => {
    const sim = engine();
    sim.brushDraw(2, 2, 2, Material.SAND);
    sim.brushDraw(21, 2, 2, Material.WATER);
    const total = sim.countNonEmpty();
    run(sim, 120);
    expect(sim.countNonEmpty()).toBe(total);
  });

  it('piles rather than stacking a single column', () => {
    const sim = engine(31, 20);
    // Pour a lot of sand down one column.
    for (let i = 0; i < 60; i += 1) {
      sim.setCell(15, 0, Material.SAND);
      sim.tick();
    }
    run(sim, 80);
    // The pile must have spread sideways rather than reaching the ceiling.
    let widest = 0;
    for (let y = 0; y < sim.height; y += 1) {
      let row = 0;
      for (let x = 0; x < sim.width; x += 1) if (sim.getCell(x, y) === Material.SAND) row += 1;
      widest = Math.max(widest, row);
    }
    expect(widest).toBeGreaterThan(1);
  });

  // A fixed scan direction makes powder creep steadily to one side; the engine
  // alternates per row and per tick specifically to avoid that.
  it('does not drift systematically to one side', () => {
    const sim = engine(41, 24);
    const centre = 20;
    for (let i = 0; i < 80; i += 1) {
      sim.setCell(centre, 0, Material.SAND);
      sim.tick();
    }
    run(sim, 120);
    let left = 0;
    let right = 0;
    for (let y = 0; y < sim.height; y += 1) {
      for (let x = 0; x < sim.width; x += 1) {
        if (sim.getCell(x, y) !== Material.SAND) continue;
        if (x < centre) left += 1;
        if (x > centre) right += 1;
      }
    }
    const total = left + right;
    if (total > 0) {
      const skew = Math.abs(left - right) / total;
      expect(skew).toBeLessThan(0.5);
    }
  });

  it('leaves walls exactly where they are put', () => {
    const sim = engine();
    sim.brushStroke(0, 10, sim.width - 1, 10, 0, Material.WALL);
    const before = sim.countOf(Material.WALL);
    run(sim, 50);
    expect(sim.countOf(Material.WALL)).toBe(before);
    expect(sim.getCell(5, 10)).toBe(Material.WALL);
  });

  it('rests sand on top of a wall instead of passing through', () => {
    const sim = engine();
    sim.brushStroke(0, 10, sim.width - 1, 10, 0, Material.WALL);
    sim.setCell(6, 2, Material.SAND);
    run(sim, 40);
    expect(sim.getCell(6, 9)).toBe(Material.SAND);
  });
});

describe('liquids and gases', () => {
  it('spreads water sideways rather than piling it', () => {
    const sim = engine(21, 12);
    for (let i = 0; i < 24; i += 1) {
      sim.setCell(10, 0, Material.WATER);
      sim.tick();
    }
    run(sim, 120);
    let bottomRow = 0;
    for (let x = 0; x < sim.width; x += 1) {
      if (sim.getCell(x, sim.height - 1) === Material.WATER) bottomRow += 1;
    }
    // Water levels: it should occupy a wide band, not a narrow tower.
    expect(bottomRow).toBeGreaterThan(3);
  });

  it('floats oil on top of water', () => {
    const sim = engine(9, 20);
    // Fill the lower half with water, drop oil into it.
    for (let y = 10; y < 20; y += 1) {
      for (let x = 0; x < 9; x += 1) sim.setCell(x, y, Material.WATER);
    }
    sim.setCell(4, 15, Material.OIL);
    run(sim, 160);
    let oilY = -1;
    for (let y = 0; y < sim.height; y += 1) {
      for (let x = 0; x < sim.width; x += 1) if (sim.getCell(x, y) === Material.OIL) oilY = y;
    }
    // Oil is less dense than water, so it must end up above the water column.
    expect(oilY).toBeLessThan(19);
  });

  it('sinks sand through water', () => {
    const sim = engine(9, 20);
    for (let y = 8; y < 20; y += 1) {
      for (let x = 0; x < 9; x += 1) sim.setCell(x, y, Material.WATER);
    }
    sim.setCell(4, 2, Material.SAND);
    run(sim, 160);
    expect(sim.getCell(4, sim.height - 1) === Material.SAND
      || sim.getCell(3, sim.height - 1) === Material.SAND
      || sim.getCell(5, sim.height - 1) === Material.SAND).toBe(true);
  });

  it('rises gas to the ceiling', () => {
    const sim = engine();
    sim.setCell(10, sim.height - 1, Material.GAS);
    run(sim, 60);
    let highest = sim.height;
    for (let y = 0; y < sim.height; y += 1) {
      for (let x = 0; x < sim.width; x += 1) {
        if (sim.getCell(x, y) === Material.GAS) { highest = Math.min(highest, y); }
      }
    }
    expect(highest).toBeLessThan(sim.height - 1);
  });

  it('boils water into steam once hot enough', () => {
    const sim = engine();
    sim.setCell(5, 5, Material.WATER);
    sim.setTemperature(sim.index(5, 5), BOIL_TEMPERATURE + 10);
    sim.tick();
    expect(sim.countOf(Material.WATER)).toBe(0);
    expect(sim.countOf(Material.STEAM)).toBe(1);
  });
});

describe('reactions', () => {
  // Fire is placed outside the disc and the baseline is taken afterwards: a
  // radius-2 brush at (10,10) already covers (10,8), so seeding fire there
  // would overwrite a cell and the count would drop for the wrong reason.
  // The pool is allowed to settle before it is lit, which is both what a player
  // does and what the scan order requires: rows resolve bottom-up, so a falling
  // column moves out from under a flame placed in the same tick.
  it('burns oil when fire touches it', () => {
    const sim = engine();
    sim.brushDraw(10, 6, 2, Material.OIL);
    run(sim, 60);
    const before = sim.countOf(Material.OIL);

    let topY = sim.height;
    let topX = 10;
    for (let y = 0; y < sim.height; y += 1) {
      for (let x = 0; x < sim.width; x += 1) {
        if (sim.getCell(x, y) === Material.OIL && y < topY) { topY = y; topX = x; }
      }
    }
    sim.setCell(topX, topY - 1, Material.FIRE);
    run(sim, 80);
    expect(sim.countOf(Material.OIL)).toBeLessThan(before);
  });

  it('does not burn sand', () => {
    const sim = engine();
    sim.brushDraw(10, 12, 2, Material.SAND);
    sim.setCell(10, 9, Material.FIRE);
    const before = sim.countOf(Material.SAND);
    run(sim, 60);
    expect(sim.countOf(Material.SAND)).toBe(before);
  });

  it('burns fire out rather than letting it live forever', () => {
    const sim = engine();
    sim.setCell(10, 10, Material.FIRE);
    run(sim, 200);
    expect(sim.countOf(Material.FIRE)).toBe(0);
  });

  // Anchored on the floor: rows resolve bottom-up, so a sand cell placed
  // mid-air falls out from under the lava in the same tick it was seeded.
  it('turns sand to glass where lava touches it', () => {
    const sim = engine();
    const floor = sim.height - 1;
    sim.setCell(10, floor, Material.SAND);
    sim.setCell(10, floor - 1, Material.LAVA);
    run(sim, 6);
    expect(sim.countOf(Material.GLASS)).toBeGreaterThan(0);
  });

  it('quenches lava to rock when it meets water', () => {
    const sim = engine();
    const floor = sim.height - 1;
    sim.setCell(10, floor, Material.LAVA);
    sim.setCell(10, floor - 1, Material.WATER);
    run(sim, 8);
    expect(sim.countOf(Material.ROCK)).toBeGreaterThan(0);
  });

  it('dissolves what acid touches, but never a wall', () => {
    const sim = engine();
    sim.brushDraw(10, 6, 2, Material.SAND);
    run(sim, 60); // let the pile settle before pouring acid on it
    const sandBefore = sim.countOf(Material.SAND);
    sim.setCell(10, 0, Material.ACID);
    run(sim, 80);
    expect(sim.countOf(Material.SAND)).toBeLessThan(sandBefore);

    // Wall is the one exception, and the acid is seeded outside the block so
    // the baseline is not lowered just by overwriting a cell.
    const walled = engine();
    walled.brushDraw(10, 10, 2, Material.WALL);
    walled.setCell(10, 0, Material.ACID);
    const wallBefore = walled.countOf(Material.WALL);
    run(walled, 120);
    expect(walled.countOf(Material.WALL)).toBe(wallBefore);
  });

  // The water is trapped in a walled basin. Left free it simply falls away from
  // the plant on the first tick and nothing ever grows.
  it('grows plants toward water and not without it', () => {
    const sim = engine();
    const floor = sim.height - 1;
    sim.brushStroke(8, floor, 13, floor, 0, Material.WALL);
    sim.setCell(8, floor - 1, Material.WALL);
    sim.setCell(13, floor - 1, Material.WALL);
    sim.setCell(10, floor - 1, Material.PLANT);
    sim.setCell(11, floor - 1, Material.WATER);
    sim.setCell(12, floor - 1, Material.WATER);
    const before = sim.countOf(Material.PLANT);
    run(sim, 400);
    expect(sim.countOf(Material.PLANT)).toBeGreaterThan(before);

    const dry = engine();
    dry.setCell(10, 10, Material.PLANT);
    run(dry, 400);
    expect(dry.countOf(Material.PLANT)).toBe(1);
  });

  it('evaporates dopamine so a plasticity field is temporary', () => {
    const sim = engine();
    sim.setCell(10, 2, Material.DOPAMINE);
    // The lifetime is long; assert it is counting down rather than waiting it out.
    const at0 = sim.index(10, 2);
    const life = sim.getScratch(at0);
    run(sim, 5);
    let found = 0;
    for (let at = 0; at < sim.size; at += 1) {
      if ((sim.cells[at] & 0x1f) === Material.DOPAMINE) found = sim.getScratch(at);
    }
    expect(found).toBeLessThan(life);
  });
});

describe('determinism', () => {
  it('produces identical grids from the same seed', () => {
    const a = engine(30, 20, 'same-seed');
    const b = engine(30, 20, 'same-seed');
    for (const sim of [a, b]) sim.brushDraw(15, 3, 4, Material.SAND);
    run(a, 80);
    run(b, 80);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  // The obvious version of this test — pour the same pile under two seeds and
  // expect different grids — is wrong, and measuring said so: a settling pile
  // converges to the same packed rest state whichever way individual grains
  // tipped. The seed only decides outcomes where a genuine choice survives, so
  // that is what gets asserted: one grain landing on a one-cell pillar with both
  // diagonals free falls left or right depending on the seed.
  it('lets the seed decide a genuinely free choice', () => {
    const landings = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const sim = engine(21, 14, seed);
      sim.setCell(10, 13, Material.WALL);
      sim.setCell(10, 0, Material.SAND);
      run(sim, 30);
      for (let x = 0; x < sim.width; x += 1) {
        if (sim.getCell(x, 13) === Material.SAND) { landings.add(x); break; }
      }
    }
    expect(landings.size).toBeGreaterThan(1);
  });

  // The flip side, worth pinning because it is a robustness property rather
  // than an accident: where a pile comes to rest does not depend on the seed.
  it('settles a symmetric pile to the same rest state under any seed', () => {
    const a = engine(30, 20, 'seed-a');
    const b = engine(30, 20, 'seed-b');
    for (const sim of [a, b]) sim.brushDraw(15, 3, 4, Material.SAND);
    run(a, 120);
    run(b, 120);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });
});
