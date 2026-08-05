// The material table for the Neuro Powder Lab.
//
// Fourteen materials, ten of them the classic falling-sand set and four of them
// the reason this is not a clone: NEURO, SYNAPSE, DOPAMINE and INHIB turn the
// sandbox into something you can build a working circuit in.
//
// Colours are flat 4x4-pixel fills, drawn from the site's own palette. Nothing
// here is derived from Dan-Ball or The Powder Toy.
//
// This module is pure data plus small pure helpers so the bare-Node test runner
// can execute it (see scripts/test-runner.mjs, which strips types).

/**
 * Material ids.
 *
 * A const object rather than a TypeScript `enum`: `isolatedModules` is on, and
 * Node's type stripping erases types without transforming them, so an enum
 * (which emits a runtime object) cannot survive either. This shape is plain
 * JavaScript at runtime and still gives a narrow union type.
 *
 * Ids 14-16 are reaction products, not things the player paints.
 */
export const Material = {
  AIR: 0,
  SAND: 1,
  WATER: 2,
  WALL: 3,
  FIRE: 4,
  PLANT: 5,
  OIL: 6,
  GAS: 7,
  ACID: 8,
  LAVA: 9,
  NEURO: 10,
  SYNAPSE: 11,
  DOPAMINE: 12,
  INHIB: 13,
  /** Water that boiled. Behaves as a rising gas. */
  STEAM: 14,
  /** What lava becomes when it cools. */
  ROCK: 15,
  /** What sand becomes when lava touches it. */
  GLASS: 16,
} as const;

export type Material = (typeof Material)[keyof typeof Material];

export type Phase = 'empty' | 'solid' | 'powder' | 'liquid' | 'gas' | 'energy' | 'wire';

export interface MaterialSpec {
  id: Material;
  name: string;
  /** Palette label; short enough for a 14-slot picker. */
  label: string;
  color: string;
  /** Higher sinks through lower. Gases are negative so they rise. */
  density: number;
  phase: Phase;
  /** Shown in the palette; user-placeable materials only. */
  selectable: boolean;
  /** Keyboard shortcut, matching the brief's 1-9 then QWERT layout. */
  hotkey?: string;
  /** Burns when fire touches it. */
  flammable?: boolean;
  /** Acid eats it. WALL is the deliberate exception. */
  corrodible?: boolean;
  blurb: string;
}

/**
 * Ordered as the palette renders. `selectable: false` entries are outcomes of
 * reactions rather than things you paint.
 */
export const MATERIALS: readonly MaterialSpec[] = Object.freeze([
  { id: Material.AIR, name: 'Air', label: 'Air', color: '#0a0a0f', density: 0, phase: 'empty', selectable: true, hotkey: '1', corrodible: false, blurb: 'Empty space. Right-click erases to this.' },
  { id: Material.SAND, name: 'Sand', label: 'Sand', color: '#c2b280', density: 3, phase: 'powder', selectable: true, hotkey: '2', corrodible: true, blurb: 'Falls and piles. Lava turns it to glass.' },
  { id: Material.WATER, name: 'Water', label: 'Water', color: '#3a86ff', density: 2, phase: 'liquid', selectable: true, hotkey: '3', corrodible: false, blurb: 'Flows and levels. Boils to steam, feeds plants.' },
  { id: Material.WALL, name: 'Wall', label: 'Wall', color: '#2a2a30', density: 100, phase: 'solid', selectable: true, hotkey: '4', corrodible: false, blurb: 'Immovable. The one thing acid cannot eat.' },
  { id: Material.FIRE, name: 'Fire', label: 'Fire', color: '#ff5a30', density: -1, phase: 'energy', selectable: true, hotkey: '5', corrodible: false, blurb: 'Rises, consumes oil and plants, dies out.' },
  { id: Material.PLANT, name: 'Plant', label: 'Plant', color: '#2d6a4f', density: 1, phase: 'solid', selectable: true, hotkey: '6', flammable: true, corrodible: true, blurb: 'Grows toward water. Burns well.' },
  { id: Material.OIL, name: 'Oil', label: 'Oil', color: '#1a1a1a', density: 1, phase: 'liquid', selectable: true, hotkey: '7', flammable: true, corrodible: true, blurb: 'Floats on water. Extremely flammable.' },
  { id: Material.GAS, name: 'Gas', label: 'Gas', color: '#888888', density: -2, phase: 'gas', selectable: true, hotkey: '8', flammable: true, corrodible: false, blurb: 'Rises and spreads. Ignites violently.' },
  { id: Material.ACID, name: 'Acid', label: 'Acid', color: '#39ff14', density: 2, phase: 'liquid', selectable: true, hotkey: '9', corrodible: false, blurb: 'Dissolves almost everything except wall.' },
  { id: Material.LAVA, name: 'Lava', label: 'Lava', color: '#ff2200', density: 4, phase: 'liquid', selectable: true, hotkey: 'Q', corrodible: false, blurb: 'Melts sand to glass. Cools to rock.' },
  { id: Material.NEURO, name: 'Neuron', label: 'Neuro', color: '#ff00ff', density: 3, phase: 'solid', selectable: true, hotkey: 'W', corrodible: true, blurb: 'Leaky integrate-and-fire cell. Charges, then spikes.' },
  { id: Material.SYNAPSE, name: 'Synapse', label: 'Synapse', color: '#00ffff', density: 2, phase: 'wire', selectable: true, hotkey: 'E', corrodible: true, blurb: 'Carries a spike one cell per tick. Learns.' },
  { id: Material.DOPAMINE, name: 'Dopamine', label: 'Dopa', color: '#ffff00', density: 1, phase: 'liquid', selectable: true, hotkey: 'R', corrodible: false, blurb: 'Flows like water, evaporates, boosts learning nearby.' },
  { id: Material.INHIB, name: 'Inhibitory neuron', label: 'Inhib', color: '#9d4edd', density: 3, phase: 'solid', selectable: true, hotkey: 'T', corrodible: true, blurb: 'Fires a negative spike. Suppresses its targets.' },

  { id: Material.STEAM, name: 'Steam', label: 'Steam', color: '#cbd5e1', density: -3, phase: 'gas', selectable: false, corrodible: false, blurb: 'Boiled water. Rises and disperses.' },
  { id: Material.ROCK, name: 'Rock', label: 'Rock', color: '#4b5563', density: 50, phase: 'solid', selectable: false, corrodible: true, blurb: 'Cooled lava.' },
  { id: Material.GLASS, name: 'Glass', label: 'Glass', color: '#a5f3fc', density: 50, phase: 'solid', selectable: false, corrodible: true, blurb: 'Sand that met lava.' },
]);

export const MATERIAL_COUNT = MATERIALS.length;

/** Indexed by material id for O(1) lookup inside the hot loop. */
export const MATERIAL_BY_ID: readonly MaterialSpec[] = (() => {
  const table: MaterialSpec[] = [];
  for (const spec of MATERIALS) table[spec.id] = spec;
  return Object.freeze(table);
})();

export const SELECTABLE_MATERIALS: readonly MaterialSpec[] = Object.freeze(
  MATERIALS.filter((spec) => spec.selectable),
);

/** The six the homepage widget exposes, per the brief. */
export const STARTER_MATERIALS: readonly Material[] = Object.freeze([
  Material.SAND, Material.WATER, Material.FIRE,
  Material.NEURO, Material.SYNAPSE, Material.DOPAMINE,
]);

// --- Flat lookup tables -----------------------------------------------------
//
// The tick loop touches these tens of thousands of times per frame, so they are
// pre-flattened into typed arrays rather than reached through object properties.

export const DENSITY: Int16Array = (() => {
  const table = new Int16Array(MATERIAL_BY_ID.length);
  for (const spec of MATERIALS) table[spec.id] = spec.density;
  return table;
})();

function phaseFlags(predicate: (spec: MaterialSpec) => boolean): Uint8Array {
  const table = new Uint8Array(MATERIAL_BY_ID.length);
  for (const spec of MATERIALS) table[spec.id] = predicate(spec) ? 1 : 0;
  return table;
}

export const IS_POWDER = phaseFlags((spec) => spec.phase === 'powder');
export const IS_LIQUID = phaseFlags((spec) => spec.phase === 'liquid');
export const IS_GAS = phaseFlags((spec) => spec.phase === 'gas' || spec.phase === 'energy');
export const IS_FLAMMABLE = phaseFlags((spec) => Boolean(spec.flammable));
export const IS_CORRODIBLE = phaseFlags((spec) => Boolean(spec.corrodible));
/** Static: never moved by gravity, though it can still be destroyed. */
export const IS_STATIC = phaseFlags((spec) => spec.phase === 'solid' || spec.phase === 'wire');

/** RGB triples, pre-parsed so the renderer never touches a hex string. */
export const COLOR_RGB: Uint8Array = (() => {
  const table = new Uint8Array(MATERIAL_BY_ID.length * 3);
  for (const spec of MATERIALS) {
    const hex = spec.color.replace('#', '');
    table[spec.id * 3] = parseInt(hex.slice(0, 2), 16);
    table[spec.id * 3 + 1] = parseInt(hex.slice(2, 4), 16);
    table[spec.id * 3 + 2] = parseInt(hex.slice(4, 6), 16);
  }
  return table;
})();

export function materialByHotkey(key: string): Material | null {
  const upper = key.toUpperCase();
  const found = MATERIALS.find((spec) => spec.hotkey === upper);
  return found ? found.id : null;
}
