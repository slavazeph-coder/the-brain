/**
 * Layer 30 — Neurochemistry Data
 *
 * Six neurotransmitters, each with a region-effect profile and baseline.
 * Presets simulate real neurochemical states (caffeine, meditation, SSRI, etc.)
 * by setting NT levels; the engine maps those levels onto brain regions.
 *
 * Levels are 0..1 with 0.5 as physiological baseline. Deviation from 0.5 is
 * what drives region change — moving a slider from 0.5 → 0.8 pushes that NT
 * "above baseline" which nudges target regions by `regionWeights × delta`.
 */

export const NT_BASELINE = 0.5;

export const NEUROTRANSMITTERS = {
  dopamine: {
    id: 'dopamine',
    label: 'Dopamine',
    short: 'DA',
    color: '#ffd54a',
    blurb: 'Reward prediction · motivation · movement',
    // Positive = this region is UP when NT is above baseline
    regionWeights: { BG: 0.55, PFC: 0.30, THL: 0.12 }
  },
  serotonin: {
    id: 'serotonin',
    label: 'Serotonin',
    short: '5-HT',
    color: '#7dd87f',
    blurb: 'Mood regulation · satiety · impulse control',
    regionWeights: { PFC: 0.30, CTX: 0.18, AMY: -0.25 }
  },
  cortisol: {
    id: 'cortisol',
    label: 'Cortisol',
    short: 'CORT',
    color: '#ff6040',
    blurb: 'Stress axis · threat vigilance · memory suppression',
    regionWeights: { AMY: 0.50, HPC: -0.30, PFC: -0.20 }
  },
  oxytocin: {
    id: 'oxytocin',
    label: 'Oxytocin',
    short: 'OXT',
    color: '#ff9ab8',
    blurb: 'Social bonding · trust · attachment',
    regionWeights: { AMY: -0.18, HPC: 0.20, PFC: 0.15, CTX: 0.08 }
  },
  norepinephrine: {
    id: 'norepinephrine',
    label: 'Norepinephrine',
    short: 'NE',
    color: '#ff4066',
    blurb: 'Arousal · vigilance · fight-or-flight',
    regionWeights: { THL: 0.40, AMY: 0.25, PFC: -0.10, CBL: 0.10 }
  },
  acetylcholine: {
    id: 'acetylcholine',
    label: 'Acetylcholine',
    short: 'ACh',
    color: '#4db8ff',
    blurb: 'Attention · encoding · cortical activation',
    regionWeights: { CTX: 0.32, HPC: 0.25, THL: 0.20 }
  }
};

export const NT_IDS = Object.keys(NEUROTRANSMITTERS);

/**
 * Preset bath — a named neurochemical state. `levels` is a partial map
 * (unspecified NTs default to baseline 0.5). `vibe` is a short description
 * rendered in the UI.
 */
export const NT_PRESETS = [
  {
    id: 'baseline',
    label: 'Baseline',
    vibe: 'Resting physiological state',
    icon: '◯',
    levels: { dopamine: 0.5, serotonin: 0.5, cortisol: 0.5, oxytocin: 0.5, norepinephrine: 0.5, acetylcholine: 0.5 }
  },
  {
    id: 'caffeine',
    label: 'Caffeine',
    vibe: 'Adenosine blockade · cortical arousal · mild DA bump',
    icon: '☕',
    levels: { dopamine: 0.62, norepinephrine: 0.72, acetylcholine: 0.62, cortisol: 0.58 }
  },
  {
    id: 'meditation',
    label: 'Meditation',
    vibe: '20 min breath focus · parasympathetic dominant',
    icon: '🧘',
    levels: { serotonin: 0.72, oxytocin: 0.66, cortisol: 0.28, norepinephrine: 0.35, acetylcholine: 0.58 }
  },
  {
    id: 'stress',
    label: 'Acute Stress',
    vibe: 'Sympathetic surge · HPA-axis engaged',
    icon: '⚡',
    levels: { cortisol: 0.85, norepinephrine: 0.82, serotonin: 0.32, oxytocin: 0.35, dopamine: 0.42 }
  },
  {
    id: 'ssri',
    label: 'SSRI (4 wk)',
    vibe: 'Chronic reuptake block · tonic 5-HT elevated',
    icon: '💊',
    levels: { serotonin: 0.78, cortisol: 0.42, dopamine: 0.48 }
  },
  {
    id: 'flow',
    label: 'Flow State',
    vibe: 'Optimal challenge · DA/NE sweet spot',
    icon: '🌊',
    levels: { dopamine: 0.72, norepinephrine: 0.62, acetylcholine: 0.68, serotonin: 0.58, cortisol: 0.38 }
  },
  {
    id: 'sleep_dep',
    label: 'Sleep Deprivation',
    vibe: '24 h no sleep · DA/ACh crash · cortisol leak',
    icon: '🥱',
    levels: { dopamine: 0.32, acetylcholine: 0.28, cortisol: 0.68, norepinephrine: 0.58, serotonin: 0.38 }
  },
  {
    id: 'panic',
    label: 'Panic Attack',
    vibe: 'Amygdala runaway · PFC offline',
    icon: '🌀',
    levels: { cortisol: 0.92, norepinephrine: 0.95, serotonin: 0.22, oxytocin: 0.25, dopamine: 0.35 }
  },
  {
    id: 'mdma',
    label: 'MDMA (phase II)',
    vibe: 'Massive 5-HT/OXT release · empathogen',
    icon: '❤️',
    levels: { serotonin: 0.92, oxytocin: 0.92, dopamine: 0.72, cortisol: 0.38, norepinephrine: 0.58 }
  }
];

/**
 * Mapping from Layer 29 affect clusters to NT nudges (from baseline).
 * Used by "match from last decode" to derive NT levels from an affect
 * fingerprint.
 */
export const AFFECT_NT_SIGNATURE = {
  // Threat cluster drives cortisol + NE, suppresses 5-HT
  fear:       { cortisol: +0.35, norepinephrine: +0.30, serotonin: -0.12 },
  anger:      { norepinephrine: +0.35, cortisol: +0.22, dopamine: +0.10, serotonin: -0.12 },
  disgust:    { serotonin: -0.18, cortisol: +0.12 },
  // Reward cluster drives DA, oxytocin for awe
  joy:        { dopamine: +0.30, serotonin: +0.15 },
  awe:        { oxytocin: +0.22, dopamine: +0.20, acetylcholine: +0.12 },
  pride:      { dopamine: +0.22, serotonin: +0.12 },
  // Social cluster is oxytocin-centric
  belonging:  { oxytocin: +0.28, serotonin: +0.15, cortisol: -0.10 },
  nostalgia:  { oxytocin: +0.18, dopamine: +0.10, acetylcholine: +0.15 },
  shame:      { cortisol: +0.28, serotonin: -0.18, oxytocin: -0.12 },
  // Cognitive cluster is ACh + DA
  curiosity:  { dopamine: +0.22, acetylcholine: +0.20 },
  certainty:  { serotonin: +0.18, dopamine: +0.08 },
  confusion:  { acetylcholine: +0.15, norepinephrine: +0.10, serotonin: -0.08 }
};
