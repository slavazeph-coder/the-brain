// Prebuilt circuits you can drop on the grid.
//
// A blank sandbox is the fastest way to lose someone: Powder Game worked
// because dropping sand did something immediately. These give a first-time
// visitor a working circuit to poke at, and give everyone the fiddly parts
// (a wire that actually connects) without drawing them cell by cell.
//
// A stamp is a small ASCII picture. Legend:
//   .  leave whatever is already there      N  neuron
//   -  synapse                              I  inhibitory neuron
//   D  dopamine                             #  wall
//   o  sand                                 ~  water
import { Material } from './materials.ts';
import type { PowderEngine } from './powderEngine.ts';

const LEGEND: Record<string, Material | null> = {
  '.': null,
  N: Material.NEURO,
  I: Material.INHIB,
  '-': Material.SYNAPSE,
  D: Material.DOPAMINE,
  '#': Material.WALL,
  o: Material.SAND,
  '~': Material.WATER,
};

export interface Stamp {
  id: string;
  name: string;
  blurb: string;
  rows: readonly string[];
}

/** The circuit from the brief: neuron, wire, neuron. */
export const STARTER_CIRCUIT: Stamp = Object.freeze({
  id: 'starter',
  name: 'Simple circuit',
  blurb: 'One neuron drives another down a wire. Press Stimulate.',
  rows: Object.freeze([
    'N-----------N',
  ]),
});

/**
 * What a first-time visitor lands on.
 *
 * A blank grid is the fastest way to lose someone, and a lone 13-cell circuit
 * is invisible at 240x160. This fills the width: three relay stages, an
 * inhibitory branch fighting for the same target, a dopamine bath under the
 * learning run, and sand to make the falling half obvious at a glance.
 */
/**
 * What a first-time visitor lands on.
 *
 * Built with string operations rather than a literal because it spans ~200 of
 * the grid's 240 columns: at a 4x upscale a single cell is about four pixels,
 * so a circuit has to be drawn wide to read at all. A blank grid, or a 13-cell
 * circuit lost in the middle of one, is the fastest way to lose someone.
 *
 * Three things are on screen at once, which is the whole pitch: a relay chain
 * whose hops you can watch, an inhibitory branch racing it to the same target,
 * and dopamine — in a basin, because it is a liquid and an open pool drains on
 * the first tick.
 */
function buildOpeningScene(): readonly string[] {
  const width = 200;
  const stage = 39; // cells between neurons in the relay chain

  // Five neurons joined by synapse runs.
  let chain = '';
  for (let x = 0; x < width; x += 1) chain += x % stage === 0 ? 'N' : '-';

  const blank = '.'.repeat(width);

  // An inhibitory neuron with a long axon that drops down to a shared target.
  const branchTurn = stage * 3;
  let branch = 'I' + '-'.repeat(branchTurn - 1) + '.'.repeat(width - branchTurn);
  const drop = '.'.repeat(branchTurn) + '-' + '.'.repeat(width - branchTurn - 1);
  const target = '.'.repeat(branchTurn) + 'N' + '.'.repeat(width - branchTurn - 1);

  // A walled basin so the dopamine stays where it was poured.
  const basinLeft = 6;
  const basinWidth = 46;
  const basinLid = '.'.repeat(basinLeft) + '#'.repeat(basinWidth) + '.'.repeat(width - basinLeft - basinWidth);
  const basinRow = '.'.repeat(basinLeft) + '#' + 'D'.repeat(basinWidth - 2) + '#'
    + '.'.repeat(width - basinLeft - basinWidth);

  // A sand hopper on the right, well clear of the wiring.
  const hopperLeft = width - 40;
  const sand = '.'.repeat(hopperLeft) + 'o'.repeat(34) + '.'.repeat(width - hopperLeft - 34);

  return Object.freeze([
    chain,
    blank,
    branch,
    drop,
    target,
    blank,
    basinRow,
    basinRow,
    basinLid,
    blank,
    sand,
  ]);
}

export const OPENING_SCENE: Stamp = Object.freeze({
  id: 'opening',
  name: 'Opening scene',
  blurb: 'A relay chain, an inhibitory branch, and a dopamine bath that stays put.',
  rows: buildOpeningScene(),
});

export const STAMPS: readonly Stamp[] = Object.freeze([
  STARTER_CIRCUIT,
  {
    id: 'chain',
    name: 'Relay chain',
    blurb: 'Three stages. Watch the delay grow with each hop.',
    rows: Object.freeze([
      'N-----N-----N',
    ]),
  },
  {
    id: 'inhibited',
    name: 'Inhibited pair',
    blurb: 'An inhibitory neuron fights an excitatory one for the same target.',
    rows: Object.freeze([
      'N-----.',
      '......-',
      'I-----.',
    ]),
  },
  {
    id: 'learning',
    name: 'Learning bench',
    blurb: 'A circuit sitting in dopamine. Stimulate it and watch the weight climb.',
    rows: Object.freeze([
      '..DDDDDDD..',
      'N----------N',
      '..DDDDDDD..',
    ]),
  },
  {
    id: 'loop',
    name: 'Feedback loop',
    blurb: 'Output wired back to input. Give it one spike and see what happens.',
    rows: Object.freeze([
      '.-------.',
      '-.......-',
      'N.......N',
      '-.......-',
      '.-------.',
    ]),
  },
  {
    id: 'hourglass',
    name: 'Hourglass',
    blurb: 'Sand, a funnel, and somewhere to land. No neurons involved.',
    rows: Object.freeze([
      'oooooooooo',
      '..........',
      '#........#',
      '.#......#.',
      '..#....#..',
      '...#..#...',
    ]),
  },
]);

/**
 * Stamp a pattern onto the grid with its top-left at (x, y).
 * Cells marked `.` are left alone, so a stamp can be laid over existing work.
 */
export function applyStamp(engine: PowderEngine, stamp: Stamp, x: number, y: number): number {
  let placed = 0;
  for (let row = 0; row < stamp.rows.length; row += 1) {
    const line = stamp.rows[row];
    for (let column = 0; column < line.length; column += 1) {
      const material = LEGEND[line[column]];
      if (material === null || material === undefined) continue;
      const cellX = x + column;
      const cellY = y + row;
      if (!engine.inBounds(cellX, cellY)) continue;
      engine.setCell(cellX, cellY, material);
      placed += 1;
    }
  }
  return placed;
}

/** Every character a stamp may contain. Exported so tests can guard the legend. */
export const STAMP_LEGEND_KEYS = Object.freeze(Object.keys(LEGEND));
