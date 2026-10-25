export enum Material {
  AIR = 0,
  SAND = 1,
  WATER = 2,
  WALL = 3,
  NEURO = 4,
  SYNAPSE = 5,
  DOPAMINE = 6,
  INHIB = 7,
}

export const MATERIAL_COUNT = 8;

export interface MaterialSpec {
  id: Material;
  name: string;
  label: string;
  color: string;
  rgb: readonly [number, number, number];
  blurb: string;
  hotkey?: string;
}

export const MATERIAL_BY_ID: Record<Material, MaterialSpec> = {
  [Material.AIR]: {
    id: Material.AIR,
    name: 'Air',
    label: 'Air',
    color: '#06060a',
    rgb: [6, 6, 10],
    blurb: 'Empty space.',
    hotkey: '0',
  },
  [Material.SAND]: {
    id: Material.SAND,
    name: 'Sand',
    label: 'Sand',
    color: '#eab308',
    rgb: [234, 179, 8],
    blurb: 'Heavy granular powder that falls and piles up.',
    hotkey: '1',
  },
  [Material.WATER]: {
    id: Material.WATER,
    name: 'Water',
    label: 'Water',
    color: '#38bdf8',
    rgb: [56, 189, 248],
    blurb: 'Liquid that flows and pools in basins.',
    hotkey: '2',
  },
  [Material.WALL]: {
    id: Material.WALL,
    name: 'Wall',
    label: 'Wall',
    color: '#64748b',
    rgb: [100, 116, 139],
    blurb: 'Static barrier that holds liquids and powders.',
    hotkey: '3',
  },
  [Material.NEURO]: {
    id: Material.NEURO,
    name: 'Excitatory neuron',
    label: 'Neuron',
    color: '#00f5ff',
    rgb: [0, 245, 255],
    blurb: 'Leaky integrate-and-fire excitatory unit.',
    hotkey: '4',
  },
  [Material.SYNAPSE]: {
    id: Material.SYNAPSE,
    name: 'Synapse wire',
    label: 'Synapse',
    color: '#a855f7',
    rgb: [168, 85, 247],
    blurb: 'Conducts spikes at 1 cell/tick and learns via STDP.',
    hotkey: '5',
  },
  [Material.DOPAMINE]: {
    id: Material.DOPAMINE,
    name: 'Dopamine',
    label: 'Dopamine',
    color: '#10b981',
    rgb: [16, 185, 129],
    blurb: 'Neuromodulator liquid that triples nearby STDP learning gain.',
    hotkey: '6',
  },
  [Material.INHIB]: {
    id: Material.INHIB,
    name: 'Inhibitory neuron',
    label: 'Inhibitor',
    color: '#f43f5e',
    rgb: [244, 63, 94],
    blurb: 'Inhibitory LIF unit that sends hyperpolarising spikes.',
    hotkey: '7',
  },
};

export const SELECTABLE_MATERIALS: readonly MaterialSpec[] = Object.freeze([
  MATERIAL_BY_ID[Material.SAND],
  MATERIAL_BY_ID[Material.WATER],
  MATERIAL_BY_ID[Material.WALL],
  MATERIAL_BY_ID[Material.NEURO],
  MATERIAL_BY_ID[Material.SYNAPSE],
  MATERIAL_BY_ID[Material.DOPAMINE],
  MATERIAL_BY_ID[Material.INHIB],
]);

export const COLOR_RGB = new Uint8Array(MATERIAL_COUNT * 3);
for (let id = 0; id < MATERIAL_COUNT; id += 1) {
  const spec = MATERIAL_BY_ID[id as Material];
  if (spec) {
    COLOR_RGB[id * 3] = spec.rgb[0];
    COLOR_RGB[id * 3 + 1] = spec.rgb[1];
    COLOR_RGB[id * 3 + 2] = spec.rgb[2];
  }
}

export function materialByHotkey(key: string): Material | null {
  for (const spec of Object.values(MATERIAL_BY_ID)) {
    if (spec.hotkey && spec.hotkey.toLowerCase() === key.toLowerCase()) {
      return spec.id;
    }
  }
  return null;
}
