export const REGION_INFO = {
  CTX: { name: 'Cortex', role: 'Higher-order integration and distributed cognition.', color: '#4fa8b3' },
  HPC: { name: 'Hippocampus', role: 'Memory indexing and replay loop with cortex.', color: '#fdab43' },
  THL: { name: 'Thalamus', role: 'Sensory relay hub gating signal flow into cortex.', color: '#6daa45' },
  AMY: { name: 'Amygdala', role: 'Salience and emotional relevance weighting.', color: '#dd6974' },
  BG: { name: 'Basal Ganglia', role: 'Inhibitory gating of thalamic output.', color: '#5591c7' },
  PFC: { name: 'Prefrontal Cortex', role: 'Executive planning and top-down modulation.', color: '#a86fdf' },
  CBL: { name: 'Cerebellum', role: 'Motor coordination and timing refinement.', color: '#d19900' }
};

export const POSITIONS = {
  THL:[0,1.5,0],
  CTX:[-2.6,0.55,0.15],
  PFC:[2.6,0.6,0.15],
  HPC:[0,-1.0,1.75],
  AMY:[-2.15,-1.8,-1.45],
  BG:[2.15,-1.8,-1.45],
  CBL:[0,-2.65,-2.1]
};

export const LINKS = [
  ['THL','CTX'], ['CTX','HPC'], ['HPC','CTX'], ['CTX','PFC'], ['PFC','CTX'],
  ['CTX','AMY'], ['AMY','BG'], ['BG','THL'], ['CBL','CTX'], ['PFC','HPC']
];

export const BASELINE_REGIONS = { CTX:.24,HPC:.16,THL:.58,AMY:.12,BG:.14,PFC:.19,CBL:.17 };
export const BASELINE_WEIGHTS = {
  'THL→CTX':.58,'CTX→HPC':.47,'HPC→CTX':.39,'CTX→PFC':.42,'PFC→CTX':.33,
  'CTX→AMY':.28,'AMY→BG':.31,'BG→THL':.24,'CBL→CTX':.27,'PFC→HPC':.29
};

export const SCENARIOS = {
  baseline: { label: 'Baseline', regions: BASELINE_REGIONS, patch: {} },
  burst: { label: 'Sensory Burst', regions: { CTX:.28,HPC:.18,THL:.82,AMY:.14,BG:.15,PFC:.2,CBL:.18 }, patch: {} },
  replay: { label: 'Memory Replay', regions: { CTX:.38,HPC:.72,THL:.32,AMY:.14,BG:.16,PFC:.26,CBL:.17 }, patch: { 'CTX→HPC': .66, 'HPC→CTX': .68 } },
  emotion: { label: 'Emotional Salience', regions: { CTX:.24,HPC:.2,THL:.3,AMY:.78,BG:.46,PFC:.18,CBL:.16 }, patch: { 'CTX→AMY': .62, 'AMY→BG': .71 } },
  executive: { label: 'Executive Override', regions: { CTX:.42,HPC:.34,THL:.25,AMY:.12,BG:.14,PFC:.8,CBL:.18 }, patch: { 'CTX→PFC': .64, 'PFC→CTX': .61, 'PFC→HPC': .58 } }
};
