// Anatomical region layout and pathway graph for the 3D brain scene.
// Ported from ui/brainsnn-site/src/constants/site.js. Three-free by design so
// the simulation and mapping layers stay outside the lazy vendor-three chunk.

export const REGION_LONG_NAMES = {
  CTX: 'Cortex',
  HPC: 'Hippocampus',
  THL: 'Thalamus',
  AMY: 'Amygdala',
  BG: 'Basal Ganglia',
  PFC: 'Prefrontal Cortex',
  CBL: 'Cerebellum',
};

export const BRAIN_REGIONS = [
  {
    code: 'THL',
    name: REGION_LONG_NAMES.THL,
    position: [0, 0.1, 0],
    color: '#22d3ee',
    baseActivity: 0.56,
    description: 'The intake gate: what makes the reader notice first.',
  },
  {
    code: 'CTX',
    name: REGION_LONG_NAMES.CTX,
    position: [2.45, 0.65, -0.15],
    color: '#00f5ff',
    baseActivity: 0.26,
    description: 'Meaning assembly: how claims and framing become interpretation.',
  },
  {
    code: 'HPC',
    name: REGION_LONG_NAMES.HPC,
    position: [1.25, -1.6, 1.35],
    color: '#a855f7',
    baseActivity: 0.18,
    description: 'Memory linkage: what the message connects to past beliefs.',
  },
  {
    code: 'PFC',
    name: REGION_LONG_NAMES.PFC,
    position: [3.45, 1.9, 0.75],
    color: '#38bdf8',
    baseActivity: 0.2,
    description: 'Executive control: whether the reader stays reflective instead of reactive.',
  },
  {
    code: 'AMY',
    name: REGION_LONG_NAMES.AMY,
    position: [1.85, -0.95, -2.15],
    color: '#fb7185',
    baseActivity: 0.13,
    description: 'Threat and salience: fear, outrage, urgency and protective attention.',
  },
  {
    code: 'BG',
    name: REGION_LONG_NAMES.BG,
    position: [-1.9, -0.55, -1.25],
    color: '#8b5cf6',
    baseActivity: 0.14,
    description: 'Behavioral gating: what the message pressures the reader to do next.',
  },
  {
    code: 'CBL',
    name: REGION_LONG_NAMES.CBL,
    position: [-3.1, 1.2, 1.6],
    color: '#14b8a6',
    baseActivity: 0.17,
    description: 'Pattern calibration: timing, repetition and emotional conditioning.',
  },
];

export const PATHWAYS = [
  { id: 'THL-CTX', from: 'THL', to: 'CTX', initialWeight: 0.63, inhibitory: false, curveOffset: [0.25, 1.45, 0.2], label: 'attention to meaning' },
  { id: 'CTX-HPC', from: 'CTX', to: 'HPC', initialWeight: 0.46, inhibitory: false, curveOffset: [0.45, 0.15, 0.55], label: 'context to memory' },
  { id: 'HPC-CTX', from: 'HPC', to: 'CTX', initialWeight: 0.42, inhibitory: false, curveOffset: [0.1, -0.25, -0.2], label: 'memory to interpretation' },
  { id: 'CTX-PFC', from: 'CTX', to: 'PFC', initialWeight: 0.49, inhibitory: false, curveOffset: [0.35, 0.65, 0.35], label: 'interpretation to judgment' },
  { id: 'PFC-CTX', from: 'PFC', to: 'CTX', initialWeight: 0.34, inhibitory: false, curveOffset: [-0.2, 0.25, -0.35], label: 'reflection to meaning' },
  { id: 'CTX-AMY', from: 'CTX', to: 'AMY', initialWeight: 0.31, inhibitory: false, curveOffset: [0.4, -0.2, -0.7], label: 'meaning to salience' },
  { id: 'AMY-BG', from: 'AMY', to: 'BG', initialWeight: 0.34, inhibitory: false, curveOffset: [-0.35, -0.05, 0.1], label: 'emotion to action pressure' },
  { id: 'BG-THL', from: 'BG', to: 'THL', initialWeight: 0.26, inhibitory: true, curveOffset: [-0.25, 0.15, -0.2], label: 'behavioral gate' },
  { id: 'CBL-CTX', from: 'CBL', to: 'CTX', initialWeight: 0.29, inhibitory: false, curveOffset: [0.15, -0.35, -0.3], label: 'pattern calibration' },
  { id: 'PFC-HPC', from: 'PFC', to: 'HPC', initialWeight: 0.32, inhibitory: false, curveOffset: [0.55, 0.05, 0.55], label: 'judgment to memory' },
];

export const REGION_MAP = Object.fromEntries(BRAIN_REGIONS.map((region) => [region.code, region]));

export const PATHWAY_MAP = Object.fromEntries(PATHWAYS.map((pathway) => [pathway.id, pathway]));

// Curve geometry for the axons, kept here rather than in the scene so it stays
// three-free and unit-testable — the game positions packets along exactly the
// same curves the scene draws, and the two must not be allowed to drift.

/** Control point of a pathway's quadratic curve: the midpoint plus its offset. */
export function pathwayControlPoint(pathway) {
  const from = REGION_MAP[pathway.from];
  const to = REGION_MAP[pathway.to];
  if (!from || !to) return [0, 0, 0];
  const offset = pathway.curveOffset || [0, 0, 0];
  return [
    (from.position[0] + to.position[0]) / 2 + offset[0],
    (from.position[1] + to.position[1]) / 2 + offset[1],
    (from.position[2] + to.position[2]) / 2 + offset[2],
  ];
}

/** Point at parameter `t` on the quadratic Bézier through start/control/end. */
export function quadraticPoint(start, control, end, t) {
  const u = 1 - t;
  const a = u * u;
  const b = 2 * u * t;
  const c = t * t;
  return [
    a * start[0] + b * control[0] + c * end[0],
    a * start[1] + b * control[1] + c * end[1],
    a * start[2] + b * control[2] + c * end[2],
  ];
}

/** Point at `t` along a named pathway, or null if the id is unknown. */
export function pointOnPathway(pathwayId, t) {
  const pathway = PATHWAY_MAP[pathwayId];
  if (!pathway) return null;
  const from = REGION_MAP[pathway.from];
  const to = REGION_MAP[pathway.to];
  if (!from || !to) return null;
  return quadraticPoint(from.position, pathwayControlPoint(pathway), to.position, Math.max(0, Math.min(1, t)));
}

// Plain-language tooltip copy per region, phrased for a non-technical reader.
export const REGION_MEANINGS = {
  THL: (value) => `Attention intake at ${value}/100 — how hard this content grabs notice.`,
  CTX: (value) => `Meaning-making at ${value}/100 — how much interpretive work the copy invites.`,
  HPC: (value) => `Memory linkage at ${value}/100 — how strongly it hooks into familiar stories.`,
  PFC: (value) => `Reflective control at ${value}/100 — ${value < 40 ? 'pressure is crowding out careful thought' : 'the reader can stay deliberate'}.`,
  AMY: (value) => `Threat & urgency response at ${value}/100 — ${value >= 60 ? 'strong pressure signals detected' : 'emotional pressure stays moderate'}.`,
  BG: (value) => `Action push at ${value}/100 — how hard the message shoves toward click/share/buy.`,
  CBL: (value) => `Pattern conditioning at ${value}/100 — repetition and rhythm effects.`,
};
