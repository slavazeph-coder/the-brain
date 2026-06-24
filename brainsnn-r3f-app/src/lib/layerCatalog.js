export const LAYER_GROUPS = {
  view: { label: '3D & UX', color: '#00f5ff' },
  firewall: { label: 'Cognitive Firewall', color: '#a855f7' },
  share: { label: 'Share & Cards', color: '#f97316' },
  data: { label: 'Data & State', color: '#22c55e' },
  backend: { label: 'Backend & Agents', color: '#06b6d4' },
  progression: { label: 'Progression', color: '#eab308' },
};

const layerNames = [
  ['3D Brain Viewer', 'view'], ['Neural Flow Grid', 'view'], ['TRIBE v2 Frames', 'backend'],
  ['Cognitive Firewall', 'firewall'], ['Gemma 4 Engine', 'firewall'], ['Snapshots', 'data'],
  ['Analytics Dashboard', 'data'], ['Narrative Engine', 'data'], ['Toast Notifications', 'view'],
  ['Keyboard Shortcuts', 'view'], ['Share & Embed', 'share'], ['Onboarding Walkthrough', 'view'],
  ['Split Brain View', 'view'], ['AI Voice Narrator', 'view'], ['Plugin System', 'data'],
  ['Live Sync', 'share'], ['Heatmap Timeline', 'data'], ['Knowledge Brain', 'data'],
  ['MCP Bridge', 'backend'], ['Code-Aware Knowledge', 'data'], ['Brain Steward', 'backend'],
  ['Conversation Brain', 'firewall'], ['Cognitive Immunity Score', 'progression'], ['Real Embeddings', 'firewall'],
  ['Red Team Simulator', 'firewall'], ['Dream Mode', 'view'], ['Adversarial Training', 'firewall'],
  ['Neuro-RAG', 'firewall'], ['Affective Decoder', 'firewall'], ['Neurochemistry Sandbox', 'firewall'],
  ['Brain Evolve', 'firewall'], ['Attack Evolve', 'firewall'], ['Multimodal RAG Router', 'firewall'],
  ['Vector-Graph Fusion', 'firewall'], ['Direct Content Insertion', 'firewall'], ['Autopsy Mode', 'share'],
  ['Cognitive Fragments', 'view'], ['Daily Firewall Challenge', 'progression'], ['Propaganda Templates', 'firewall'],
  ['Sentence Heatmap', 'firewall'], ['Refutation Library', 'firewall'], ['Counter-Draft', 'firewall'],
  ['Time-Series Autopsy', 'share'], ['Inbox Mode', 'share'], ['Semantic Templates', 'firewall'],
  ['Firewall Receipts', 'share'], ['Diff Mode', 'share'], ['Ad Transparency', 'firewall'],
  ['Scan Anywhere', 'share'], ['Weekly Recap', 'progression'], ['Style Fingerprint', 'firewall'],
  ['Multi-lingual Firewall', 'firewall'], ['Echo Detector', 'firewall'], ['Public Scoring API', 'backend'],
  ['Custom Rules Editor', 'firewall'], ['Badge System', 'progression'], ['Data Portability', 'data'],
  ['Image OCR Firewall', 'firewall'], ['Audio Firewall', 'firewall'], ['Firewall Macros', 'firewall'],
  ['Firewall Diagnostic', 'firewall'], ['Hypothesis Mode', 'firewall'], ['Context Memory', 'data'],
  ['Debate Mode', 'share'], ['Firewall Replay', 'data'], ['Coverage Heatmap', 'firewall'],
  ['Calendar Heatmap', 'data'], ['Tone Shifter', 'firewall'], ['Similarity Search', 'firewall'],
  ['Explanation Mode', 'firewall'], ['Neural Oscillations', 'view'], ['Layer Explorer', 'view'],
  ['Text Adventure Training', 'progression'], ['Firewall Comparator', 'firewall'], ['Region Drill-Down', 'view'],
  ['Streaming Scoring API', 'backend'], ['Session Rooms', 'share'], ['Vertical Card Variants', 'share'],
  ['Compliment Detector', 'firewall'], ['Decoy / Sarcasm Detector', 'firewall'], ['Browser Extension Generator', 'share'],
  ['MCP Tool Expansion', 'backend'], ['Rule Pack Library', 'firewall'], ['Scan Archive', 'data'],
  ['Journalism Bulk Mode', 'firewall'], ['Privacy Budget', 'data'], ['Genre Classifier', 'firewall'],
  ['Persona Simulator', 'firewall'], ['Refutation Composer', 'firewall'], ['Personal Dictionary', 'firewall'],
  ['PWA Install', 'view'], ['Command Palette', 'view'], ['Feedback Calibration', 'firewall'],
  ['Role Tour', 'view'], ['Image Bbox Annotation', 'firewall'], ['Cross-device Sync', 'data'],
  ['Hotkey Map', 'view'], ['Theme + A11y', 'view'], ['Federated Community Firewall', 'firewall'],
  ['Milestone Dashboard', 'view'], ['Gemini Deep Analysis', 'backend'], ['Veea Lobster Trap', 'backend'],
];

const blurbs = {
  3: 'TRIBE v2 and scenario projections mapped to the 7-region BrainSNN model.',
  4: 'Deterministic pressure scoring across urgency, outrage, certainty, fear and trust erosion.',
  5: 'Gemma endpoint support for deep multimodal analysis when configured server-side.',
  29: '12-affect trigger decoding across threat, reward, social and cognitive clusters.',
  36: 'Per-content autopsy and A/B battle rollups for variants and transcripts.',
  39: 'Named manipulation and persuasion templates, surfaced as concrete evidence.',
  40: 'Sentence-level heatmap annotation connected to recommendations.',
  46: 'Deterministic scan receipt for export, share links and audit trails.',
  48: 'Ad transparency archetypes such as FOMO, proof gap and coercive scarcity.',
  63: 'Entity and campaign memory for recurring context triggers.',
  70: 'Plain-English narration of what each engine layer contributed.',
  101: 'Gemini/Gemma/OpenAI-style deep analysis and counter-draft guidance.',
  102: 'Prompt injection, PII and secret preflight before model calls.',
};

export const CORE_LAYER_IDS = [3, 4, 5, 29, 36, 39, 40, 46, 48, 63, 70, 101, 102];

export const LAYER_CATALOG = layerNames.map(([name, group], index) => {
  const id = index + 1;
  return {
    id,
    name,
    group,
    blurb: blurbs[id] || `${LAYER_GROUPS[group]?.label || 'BrainSNN'} layer preserved in the 102-layer engine stack.`,
  };
});

export function layersByIds(ids = CORE_LAYER_IDS) {
  const wanted = new Set(ids);
  return LAYER_CATALOG.filter((layer) => wanted.has(layer.id));
}

export function searchLayers(query = '', group = 'all') {
  const q = String(query || '').trim().toLowerCase();
  return LAYER_CATALOG.filter((layer) => {
    const groupMatch = group === 'all' || layer.group === group;
    if (!groupMatch) return false;
    if (!q) return true;
    return layer.name.toLowerCase().includes(q)
      || layer.blurb.toLowerCase().includes(q)
      || String(layer.id) === q
      || LAYER_GROUPS[layer.group]?.label.toLowerCase().includes(q);
  });
}
