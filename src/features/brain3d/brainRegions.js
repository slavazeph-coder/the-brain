export const BRAIN_REGIONS = Object.freeze([
  {
    id: 'THL',
    code: 'THL',
    name: 'Thalamus',
    label: 'Thalamus',
    color: '#00f5ff',
    position: [0, 0, 0],
    baseActivity: 0.35,
    role: 'Sensory relay and arousal gating hub.',
    description: 'Central relay routing sensory bursts to cortical targets.',
  },
  {
    id: 'CTX',
    code: 'CTX',
    name: 'Sensory Cortex',
    label: 'Sensory Cortex',
    color: '#38bdf8',
    position: [-1.4, 1.1, 0.4],
    baseActivity: 0.32,
    role: 'Feature extraction and perceptual salience.',
    description: 'Processes incoming perceptual features and surface cues.',
  },
  {
    id: 'HPC',
    code: 'HPC',
    name: 'Hippocampus',
    label: 'Hippocampus',
    color: '#10b981',
    position: [-0.9, -0.7, -0.6],
    baseActivity: 0.28,
    role: 'Contextual memory and episodic anchoring.',
    description: 'Binds incoming signals to prior context and memory traces.',
  },
  {
    id: 'PFC',
    code: 'PFC',
    name: 'Prefrontal Cortex',
    label: 'Prefrontal Cortex',
    color: '#a855f7',
    position: [1.5, 1.0, 0.6],
    baseActivity: 0.45,
    role: 'Executive control and top-down inhibition.',
    description: 'Regulates impulsive responses and evaluates long-horizon claims.',
  },
  {
    id: 'AMY',
    code: 'AMY',
    name: 'Amygdala',
    label: 'Amygdala',
    color: '#f43f5e',
    position: [0.8, -0.8, 0.5],
    baseActivity: 0.22,
    role: 'Threat detection and emotional salience.',
    description: 'Responds rapidly to fear, urgency, and high-pressure cues.',
  },
  {
    id: 'BG',
    code: 'BG',
    name: 'Basal Ganglia',
    label: 'Basal Ganglia',
    color: '#f59e0b',
    position: [0.4, 0.3, -0.8],
    baseActivity: 0.26,
    role: 'Action selection and habit gating.',
    description: 'Gates motor and decision thresholds under reward and urgency.',
  },
  {
    id: 'CBL',
    code: 'CBL',
    name: 'Cerebellum',
    label: 'Cerebellum',
    color: '#6366f1',
    position: [-1.3, -1.1, -0.4],
    baseActivity: 0.25,
    role: 'Temporal prediction and error correction.',
    description: 'Tracks timing regularity and smooths rapid state transitions.',
  },
]);

export const REGION_MAP = Object.freeze(
  Object.fromEntries(BRAIN_REGIONS.map((r) => [r.code, r])),
);

export const REGION_MEANINGS = Object.freeze(
  Object.fromEntries(BRAIN_REGIONS.map((r) => [r.code, r.role])),
);

export const PATHWAYS = Object.freeze([
  { id: 'THL-CTX', from: 'THL', to: 'CTX', initialWeight: 0.52, inhibitory: false, offset: [0, 0.3, 0] },
  { id: 'THL-AMY', from: 'THL', to: 'AMY', initialWeight: 0.46, inhibitory: false, offset: [0.2, -0.2, 0.1] },
  { id: 'CTX-HPC', from: 'CTX', to: 'HPC', initialWeight: 0.44, inhibitory: false, offset: [-0.3, 0, -0.1] },
  { id: 'CTX-PFC', from: 'CTX', to: 'PFC', initialWeight: 0.48, inhibitory: false, offset: [0, 0.4, 0.2] },
  { id: 'HPC-PFC', from: 'HPC', to: 'PFC', initialWeight: 0.42, inhibitory: false, offset: [0.1, 0.1, 0] },
  { id: 'PFC-AMY', from: 'PFC', to: 'AMY', initialWeight: 0.50, inhibitory: true, offset: [0.3, 0, 0.2] },
  { id: 'AMY-BG', from: 'AMY', to: 'BG', initialWeight: 0.45, inhibitory: false, offset: [0.2, -0.1, -0.1] },
  { id: 'PFC-BG', from: 'PFC', to: 'BG', initialWeight: 0.43, inhibitory: false, offset: [0.2, 0.2, -0.1] },
  { id: 'BG-THL', from: 'BG', to: 'THL', initialWeight: 0.38, inhibitory: true, offset: [0, 0.1, -0.2] },
  { id: 'CTX-CBL', from: 'CTX', to: 'CBL', initialWeight: 0.40, inhibitory: false, offset: [-0.2, -0.1, 0] },
  { id: 'CBL-THL', from: 'CBL', to: 'THL', initialWeight: 0.41, inhibitory: false, offset: [-0.2, -0.2, 0] },
]);

export function pathwayControlPoint(pathway) {
  const from = REGION_MAP[pathway.from]?.position || [0, 0, 0];
  const to = REGION_MAP[pathway.to]?.position || [0, 0, 0];
  const offset = pathway.offset || [0, 0, 0];
  return [
    (from[0] + to[0]) / 2 + offset[0],
    (from[1] + to[1]) / 2 + offset[1],
    (from[2] + to[2]) / 2 + offset[2],
  ];
}

export function pointOnPathway(pathway, t = 0.5) {
  const start = REGION_MAP[pathway.from]?.position || [0, 0, 0];
  const end = REGION_MAP[pathway.to]?.position || [0, 0, 0];
  const control = pathwayControlPoint(pathway);
  const u = 1 - t;
  return [
    u * u * start[0] + 2 * u * t * control[0] + t * t * end[0],
    u * u * start[1] + 2 * u * t * control[1] + t * t * end[1],
    u * u * start[2] + 2 * u * t * control[2] + t * t * end[2],
  ];
}
