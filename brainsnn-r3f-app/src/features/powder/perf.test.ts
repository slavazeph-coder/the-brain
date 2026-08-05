// A coarse guard on the thing that makes this lab possible at all.
//
// The brief's acceptance bar is 2,000 particles at 60 fps. Measured on Node 22
// with the full pipeline (automaton tick + brain layer + pixel render), the
// engine costs about 2 ms per frame at 2,200 particles and about 4 ms with all
// 38,400 cells active — 12% and 23% of a 16.7 ms frame.
//
// The ceilings below are roughly 4x those numbers. That is deliberate: a
// timing assertion tight enough to measure performance is an assertion that
// fails on a busy CI runner for no reason. This is here to catch the change
// that makes the loop accidentally quadratic — a scan that walks neighbours of
// neighbours, an allocation per cell, a lookup that leaves the typed arrays —
// not to police a few percent.
import { describe, expect, it } from '../../test/tinyVitest.js';
import { PowderEngine } from './powderEngine.ts';
import { NeuroLayer, GAME_PARAMS } from './neuroLayer.ts';
import { Material } from './materials.ts';
import { renderGrid } from './renderGrid.ts';

const FRAMES = 120;
const WARMUP = 20;

/** Falling sand and water plus a live circuit — the realistic worst case. */
function busyGrid(target: number) {
  const engine = new PowderEngine({ seed: 'perf' });
  const layer = new NeuroLayer(engine.size);
  let placed = 0;
  for (let y = engine.height - 1; y >= 0 && placed < target; y -= 1) {
    for (let x = 0; x < engine.width && placed < target; x += 1) {
      engine.setCell(x, y, (x + y) % 3 === 0 ? Material.WATER : Material.SAND);
      placed += 1;
    }
  }
  for (let x = 10; x < 200; x += 1) engine.setCell(x, 8, Material.SYNAPSE);
  for (let x = 10; x < 200; x += 20) engine.setCell(x, 9, Material.NEURO);
  return { engine, layer };
}

function msPerFrame(target: number) {
  const { engine, layer } = busyGrid(target);
  const image = { data: new Uint8ClampedArray(engine.size * 4) };
  for (let i = 0; i < WARMUP; i += 1) { engine.tick(); layer.step(engine, GAME_PARAMS); }
  const started = Date.now();
  for (let i = 0; i < FRAMES; i += 1) {
    engine.tick();
    layer.step(engine, GAME_PARAMS);
    renderGrid(engine, layer, image as never);
  }
  return (Date.now() - started) / FRAMES;
}

describe('powder engine performance', () => {
  it('holds the frame budget at the 2,000-particle acceptance bar', () => {
    // Measured ~2.0 ms; 8 ms still leaves half a frame for the browser.
    expect(msPerFrame(2000)).toBeLessThan(8);
  });

  it('holds the frame budget with every cell active', () => {
    // Measured ~3.9 ms on a grid with no air left in it at all.
    expect(msPerFrame(38_400)).toBeLessThan(16);
  });

  // The point of the packed layout: cost tracks cell count, not particle count,
  // because the scan visits every cell either way. A rule that got quadratic in
  // occupancy would break this ratio long before it broke the ceilings above.
  it('costs about the same whether the grid is sparse or full', () => {
    const sparse = msPerFrame(2000);
    const full = msPerFrame(38_400);
    expect(full).toBeLessThan(sparse * 6 + 4);
  });
});
