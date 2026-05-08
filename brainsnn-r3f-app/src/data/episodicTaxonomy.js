/**
 * Layer 101 — Episodic Cortex taxonomy
 *
 * Seven episodic categories that every captured note is routed through.
 * Inspired by obsidian-mind's classifier (decision/incident/win/...)
 * and cyrilXBT's "vault that talks back" architecture, but BrainSNN-native:
 * each category has a brain-region affinity vector so a stream of captures
 * actually drives the 3D cortex instead of sitting in a folder.
 *
 * Capture once → flows through firewall + affect + this taxonomy → lights
 * up the brain → gets embedded → becomes part of the synthesis pool.
 */

export const EPISODIC_CLUSTERS = {
  internal: { label: 'From you', color: '#5ee69a' },
  external: { label: 'From the world', color: '#5ad4ff' },
  social: { label: 'About people', color: '#ff9ab8' },
  pivot:    { label: 'Pivots & shocks', color: '#ff4066' }
};

export const EPISODIC_CATEGORIES = {
  decision: {
    id: 'decision',
    label: 'Decision',
    cluster: 'internal',
    icon: '◆',
    color: '#a86fdf',
    description: 'A choice you took, a position you formed, a trade-off you owned.',
    regions: { PFC: 0.55, CTX: 0.25, BG: 0.20 },
    triggers: [
      /\b(decide(?:d)?|deciding|chose|picked|going with|will (?:use|build|ship|adopt))/i,
      /\b(committed to|locked in|settling on|final answer)/i,
      /\b(tradeoff|trade-off|because we|chose .* over|in favor of)/i,
      /\b(architecture|approach|strategy|principle|stance)/i
    ]
  },
  insight: {
    id: 'insight',
    label: 'Insight',
    cluster: 'internal',
    icon: '✦',
    color: '#5ad4ff',
    description: 'Your own thinking — observation, hypothesis, dot connected.',
    regions: { CTX: 0.45, HPC: 0.30, PFC: 0.25 },
    triggers: [
      /\b(realized|noticed|observation|hypothes(?:is|ize)|theory|idea)/i,
      /\b(it seems|i think|i suspect|maybe|might be|worth noting)/i,
      /\b(connection between|same as|reminds me|pattern|recurring)/i,
      /\b(insight|epiphany|click(?:ed)?|aha)/i
    ]
  },
  question: {
    id: 'question',
    label: 'Question',
    cluster: 'internal',
    icon: '?',
    color: '#fdab43',
    description: 'Something you do not yet know. Open loops the brain returns to.',
    regions: { PFC: 0.40, CTX: 0.30, HPC: 0.30 },
    triggers: [
      /\?\s*$/m,
      /\b(why|how come|what if|i wonder|do we know|is it true|why does)/i,
      /\b(question|unclear|unknown|tbd|don't know|not sure)/i,
      /\b(should i|should we|worth (?:asking|investigating|checking))/i
    ]
  },

  artifact: {
    id: 'artifact',
    label: 'Artifact',
    cluster: 'external',
    icon: '◫',
    color: '#77dbe4',
    description: 'External input — saved article, tweet, paper, quote, snippet.',
    regions: { CTX: 0.40, THL: 0.35, HPC: 0.25 },
    triggers: [
      /\bhttps?:\/\/\S+/,
      /\b(article|paper|tweet|post|video|podcast|interview|quote)/i,
      /\b(via|source|from .*\.(com|org|io|dev|ai|net))/i,
      /^\s*["“]/m
    ]
  },
  win: {
    id: 'win',
    label: 'Win',
    cluster: 'external',
    icon: '★',
    color: '#5ee69a',
    description: 'Shipped, succeeded, broke through, hit a milestone.',
    regions: { BG: 0.45, PFC: 0.30, CTX: 0.25 },
    triggers: [
      /\b(shipped|launched|released|deployed|merged|landed)/i,
      /\b(won|nailed|cracked|solved|fixed|finished|completed)/i,
      /\b(milestone|breakthrough|first time|achievement)/i,
      /\b(:rocket:|🚀|🎉|✅|finally)/i
    ]
  },
  project: {
    id: 'project',
    label: 'Project',
    cluster: 'external',
    icon: '▶',
    color: '#5591c7',
    description: 'Active work — plan, milestone, status, in-progress thread.',
    regions: { PFC: 0.45, CTX: 0.35, BG: 0.20 },
    triggers: [
      /\b(working on|building|prototyp(?:e|ing)|drafting|writing)/i,
      /\b(milestone|sprint|todo|roadmap|next step|in progress)/i,
      /\b(blocked on|waiting on|stuck on|need to)/i,
      /\b(project|repo|codebase|product|feature|launch)/i
    ]
  },

  person: {
    id: 'person',
    label: 'Person',
    cluster: 'social',
    icon: '☻',
    color: '#ff9ab8',
    description: 'A note about a human — meeting, observation, relationship.',
    regions: { CTX: 0.35, AMY: 0.35, HPC: 0.30 },
    triggers: [
      /@[a-zA-Z][\w-]{1,30}\b/,
      /\b(met with|talked to|coffee with|1:1 with|call with)/i,
      /\b(said|told me|mentioned|asked|raised|pushed back)/i,
      /\b(my (?:manager|colleague|friend|partner|cofounder|kid|dad|mom))/i
    ]
  },

  incident: {
    id: 'incident',
    label: 'Incident',
    cluster: 'pivot',
    icon: '⚠',
    color: '#ff4066',
    description: 'Something broke, surprised, or hurt. The kind of moment to remember.',
    regions: { AMY: 0.45, HPC: 0.30, THL: 0.25 },
    triggers: [
      /\b(broke|broken|down|outage|incident|crash(?:ed)?|failed|failure)/i,
      /\b(regret|mistake|oops|messed up|screwed up|fucked up)/i,
      /\b(surprised|shocked|caught off guard|did not see)/i,
      /\b(production|prod|live|customer-facing) (?:bug|issue|outage)/i
    ]
  }
};

export const EPISODIC_IDS = Object.keys(EPISODIC_CATEGORIES);

/**
 * Default activation profile when a capture matches no triggers.
 * Diffuse cortical input — treat it as an artifact-by-default.
 */
export const DEFAULT_REGIONS = { CTX: 0.30, THL: 0.20, HPC: 0.20, PFC: 0.15, AMY: 0.05, BG: 0.05, CBL: 0.05 };

/**
 * Color lookup — returns the dominant category color, or grey if none.
 */
export function categoryColor(id) {
  return EPISODIC_CATEGORIES[id]?.color || '#7c8aa1';
}

/**
 * Cluster label/color for grouping in the panel UI.
 */
export function clusterFor(id) {
  const cat = EPISODIC_CATEGORIES[id];
  if (!cat) return EPISODIC_CLUSTERS.external;
  return EPISODIC_CLUSTERS[cat.cluster] || EPISODIC_CLUSTERS.external;
}
