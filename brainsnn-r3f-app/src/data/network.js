export const REGION_INFO = {
  CTX: { name: 'Cortex', role: 'Higher cognition, multisensory integration, and distributed processing.', color: '#4fa8b3' },
  HPC: { name: 'Hippocampus', role: 'Memory encoding and replay loop with cortex.', color: '#fdab43' },
  THL: { name: 'Thalamus', role: 'Sensory relay and broadcast hub into cortex.', color: '#6daa45' },
  AMY: { name: 'Amygdala', role: 'Emotional salience and fast threat weighting.', color: '#dd6974' },
  BG: { name: 'Basal Ganglia', role: 'Inhibitory gating and action selection.', color: '#5591c7' },
  PFC: { name: 'Prefrontal Cortex', role: 'Executive control and top-down regulation.', color: '#a86fdf' },
  CBL: { name: 'Cerebellum', role: 'Motor coordination and timing refinement.', color: '#d19900' }
};

export const POSITIONS = {
  THL: [0, 1.5, 0],
  CTX: [-2.6, 0.55, 0.15],
  PFC: [2.6, 0.6, 0.15],
  HPC: [0, -1.0, 1.75],
  AMY: [-2.15, -1.8, -1.45],
  BG: [2.15, -1.8, -1.45],
  CBL: [0, -2.65, -2.1]
};

export const LINKS = [
  ['THL', 'CTX'],
  ['CTX', 'HPC'],
  ['HPC', 'CTX'],
  ['CTX', 'PFC'],
  ['PFC', 'CTX'],
  ['CTX', 'AMY'],
  ['AMY', 'BG'],
  ['BG', 'THL'],
  ['CBL', 'CTX'],
  ['PFC', 'HPC']
];

export const BASELINE_REGIONS = {
  CTX: 0.24,
  HPC: 0.16,
  THL: 0.58,
  AMY: 0.12,
  BG: 0.14,
  PFC: 0.19,
  CBL: 0.17
};

export const BASELINE_WEIGHTS = {
  'THL→CTX': 0.58,
  'CTX→HPC': 0.47,
  'HPC→CTX': 0.39,
  'CTX→PFC': 0.42,
  'PFC→CTX': 0.33,
  'CTX→AMY': 0.28,
  'AMY→BG': 0.31,
  'BG→THL': 0.24,
  'CBL→CTX': 0.27,
  'PFC→HPC': 0.29
};

export const SCENARIOS = {
  baseline: { label: 'Baseline', regions: BASELINE_REGIONS, patch: {} },
  burst: {
    label: 'Sensory Burst',
    regions: { CTX: 0.28, HPC: 0.18, THL: 0.82, AMY: 0.14, BG: 0.15, PFC: 0.2, CBL: 0.18 },
    patch: {}
  },
  replay: {
    label: 'Memory Replay',
    regions: { CTX: 0.38, HPC: 0.72, THL: 0.32, AMY: 0.14, BG: 0.16, PFC: 0.26, CBL: 0.17 },
    patch: { 'CTX→HPC': 0.66, 'HPC→CTX': 0.68 }
  },
  emotion: {
    label: 'Emotional Salience',
    regions: { CTX: 0.24, HPC: 0.2, THL: 0.3, AMY: 0.78, BG: 0.46, PFC: 0.18, CBL: 0.16 },
    patch: { 'CTX→AMY': 0.62, 'AMY→BG': 0.71 }
  },
  executive: {
    label: 'Executive Override',
    regions: { CTX: 0.42, HPC: 0.34, THL: 0.25, AMY: 0.12, BG: 0.14, PFC: 0.8, CBL: 0.18 },
    patch: { 'CTX→PFC': 0.64, 'PFC→CTX': 0.61, 'PFC→HPC': 0.58 }
  }
};

export const TRIBE_SCENARIOS = {
  sensory_burst: { label: 'TRIBE: Sensory Burst', file: 'sensory_burst.json' },
  memory_replay: { label: 'TRIBE: Memory Replay', file: 'memory_replay.json' },
  emotional_salience: { label: 'TRIBE: Emotional Salience', file: 'emotional_salience.json' },
  executive_override: { label: 'TRIBE: Executive Override', file: 'executive_override.json' },
  baseline: { label: 'TRIBE: Baseline', file: 'baseline.json' }
};
