/**
 * Layer 72 — Layer Explorer data
 *
 * Static catalog of every shipped BrainSNN layer + a searchable blurb.
 * Read from MEMORY.md's top-of-file list by hand. Updated layer-by-
 * layer as new ones ship.
 */

export const LAYER_CATALOG = [
  { id: 1, name: '3D Brain Viewer', group: 'view', blurb: 'React Three Fiber canvas with 7 regions + connectome.' },
  { id: 2, name: 'Neural Flow Grid', group: 'view', blurb: 'GPU-animated TubeGeometry pathways, GLSL shaders.' },
  { id: 3, name: 'TRIBE v2 Frames', group: 'backend', blurb: 'Meta fMRI predictions routed to regions.' },
  { id: 4, name: 'Cognitive Firewall', group: 'firewall', blurb: 'Regex-based manipulation scoring across 4 dimensions.' },
  { id: 5, name: 'Gemma 4 Engine', group: 'firewall', blurb: 'AI deep analysis for multimodal firewall.' },
  { id: 6, name: 'Snapshots', group: 'data', blurb: 'Save / load / compare brain states.' },
  { id: 7, name: 'Analytics Dashboard', group: 'data', blurb: 'Sparklines, correlation, z-score anomalies.' },
  { id: 8, name: 'Narrative Engine', group: 'data', blurb: 'Plain-language brain-activity narration.' },
  { id: 9, name: 'Toast Notifications', group: 'view', blurb: 'Top-right toast system.' },
  { id: 10, name: 'Keyboard Shortcuts', group: 'view', blurb: 'Space / b / r / 1–3 / s / e / q / ?.' },
  { id: 11, name: 'Share & Embed', group: 'share', blurb: 'Shareable URL + iframe embed + JSON export.' },
  { id: 12, name: 'Onboarding Walkthrough', group: 'view', blurb: '7-step guided tour for first-time users.' },
  { id: 13, name: 'Split Brain View', group: 'view', blurb: 'Side-by-side 3D comparison.' },
  { id: 14, name: 'AI Voice Narrator', group: 'view', blurb: 'Web Speech TTS of brain state.' },
  { id: 15, name: 'Plugin System', group: 'data', blurb: 'Sentiment / readability / credibility plugins.' },
  { id: 16, name: 'Live Sync', group: 'share', blurb: 'WebSocket multi-user rooms + chat.' },
  { id: 17, name: 'Heatmap Timeline', group: 'data', blurb: 'Canvas-rendered color matrix over time.' },
  { id: 18, name: 'Knowledge Brain', group: 'data', blurb: 'Second-brain system with LLM-Wiki generator.' },
  { id: 19, name: 'MCP Bridge', group: 'backend', blurb: '14 JSON-RPC tools for Claude/Codex agents.' },
  { id: 20, name: 'Code-Aware Knowledge', group: 'data', blurb: 'Code → graph → community → hybrid search.' },
  { id: 21, name: 'Brain Steward', group: 'backend', blurb: 'Autopilot that uses the MCP tool catalog.' },
  { id: 22, name: 'Conversation Brain', group: 'firewall', blurb: 'Multi-turn transcript → cognitive drift.' },
  { id: 23, name: 'Cognitive Immunity Score', group: 'progression', blurb: 'Persistent 0–100 resilience metric.' },
  { id: 24, name: 'Real Embeddings', group: 'firewall', blurb: 'MiniLM via transformers.js, in-browser.' },
  { id: 25, name: 'Red Team Simulator', group: 'firewall', blurb: '65-sample attack corpus vs the firewall.' },
  { id: 26, name: 'Dream Mode', group: 'view', blurb: 'Idle replay + STDP consolidation.' },
  { id: 27, name: 'Adversarial Training', group: 'firewall', blurb: 'n-gram lift self-improving firewall.' },
  { id: 28, name: 'Neuro-RAG', group: 'firewall', blurb: 'Semantic retrieval over pasted docs.' },
  { id: 29, name: 'Affective Decoder', group: 'firewall', blurb: '12-affect taxonomy on Russell circumplex.' },
  { id: 30, name: 'Neurochemistry Sandbox', group: 'firewall', blurb: '6 NT sliders with region-effect profiles.' },
  { id: 31, name: 'Brain Evolve', group: 'firewall', blurb: 'UCB1 + Island + MAP-Elites on firewall rules.' },
  { id: 32, name: 'Attack Evolve', group: 'firewall', blurb: 'String mutations to dodge current firewall.' },
  { id: 33, name: 'Multimodal RAG Router', group: 'firewall', blurb: 'text / image / table / equation / code.' },
  { id: 34, name: 'Vector-Graph Fusion', group: 'firewall', blurb: 'Reranks RAG hits with graph coherence.' },
  { id: 35, name: 'Direct Content Insertion', group: 'firewall', blurb: 'JSON paste for external parsers.' },
  { id: 36, name: 'Autopsy Mode', group: 'share', blurb: 'Per-speaker transcript profile + /a/<hash> card.' },
  { id: 37, name: 'Cognitive Fragments', group: 'view', blurb: 'Obsidian-style ~240 micro-neuron cloud.' },
  { id: 38, name: 'Daily Firewall Challenge', group: 'progression', blurb: '3 items/UTC day + streak + /d/<hash>.' },
  { id: 39, name: 'Propaganda Templates', group: 'firewall', blurb: '15 named technique detectors.' },
  { id: 40, name: 'Sentence Heatmap', group: 'firewall', blurb: 'Inline per-sentence pressure annotation.' },
  { id: 41, name: 'Refutation Library', group: 'firewall', blurb: 'Counter-response per template.' },
  { id: 42, name: 'Counter-Draft', group: 'firewall', blurb: 'Neutralize text + before/after + /x/<hash>.' },
  { id: 43, name: 'Time-Series Autopsy', group: 'share', blurb: 'Manipulation over time + /t/<hash>.' },
  { id: 44, name: 'Inbox Mode', group: 'share', blurb: 'Bulk triage + anonymized /n/<hash>.' },
  { id: 45, name: 'Semantic Templates', group: 'firewall', blurb: 'Embedding-based template matching.' },
  { id: 46, name: 'Firewall Receipts', group: 'share', blurb: 'Deterministic SHA-256 scan stamp.' },
  { id: 47, name: 'Diff Mode', group: 'share', blurb: 'A-vs-B side-by-side + /v/<hash>.' },
  { id: 48, name: 'Ad Transparency', group: 'firewall', blurb: '7 archetypes (phishing, cult, FOMO, …).' },
  { id: 49, name: 'Scan Anywhere', group: 'share', blurb: 'Bookmarklet + /?scan= deep-link contract.' },
  { id: 50, name: 'Weekly Recap', group: 'progression', blurb: 'Roll-up of local stats + /w/<hash>.' },
  { id: 51, name: 'Style Fingerprint', group: 'firewall', blurb: '12-dim stylometric author-match.' },
  { id: 52, name: 'Multi-lingual Firewall', group: 'firewall', blurb: 'Spanish + French pattern packs.' },
  { id: 53, name: 'Echo Detector', group: 'firewall', blurb: 'Shingle Jaccard coordinated-campaign finder.' },
  { id: 54, name: 'Public Scoring API', group: 'backend', blurb: 'POST /api/score + OpenAPI spec.' },
  { id: 55, name: 'Custom Rules Editor', group: 'firewall', blurb: 'User regex per category + import/export.' },
  { id: 56, name: 'Badge System', group: 'progression', blurb: '13 badges + /b/<hash> share card.' },
  { id: 57, name: 'Data Portability', group: 'data', blurb: 'Export / import / wipe all localStorage.' },
  { id: 58, name: 'Image OCR Firewall', group: 'firewall', blurb: 'tesseract.js screenshot → text → scan.' },
  { id: 59, name: 'Audio Firewall', group: 'firewall', blurb: 'Web Speech live transcribe → scan.' },
  { id: 60, name: 'Firewall Macros', group: 'firewall', blurb: 'Named preset scan suites.' },
  { id: 61, name: 'Firewall Diagnostic', group: 'firewall', blurb: 'Self-audit rules vs red-team corpus.' },
  { id: 62, name: 'Hypothesis Mode', group: 'firewall', blurb: 'Structured for/against evidence testing.' },
  { id: 63, name: 'Context Memory', group: 'data', blurb: 'Per-entity persistent scan profile.' },
  { id: 64, name: 'Debate Mode', group: 'share', blurb: 'Two-speaker momentum + winner.' },
  { id: 65, name: 'Firewall Replay', group: 'data', blurb: 'Record / export / import scan sessions.' },
  { id: 66, name: 'Coverage Heatmap', group: 'firewall', blurb: 'Which pattern caught which word inline.' },
  { id: 67, name: 'Calendar Heatmap', group: 'data', blurb: 'GitHub-style 53-week scan activity grid.' },
  { id: 68, name: 'Tone Shifter', group: 'firewall', blurb: 'Inject manipulation style for training.' },
  { id: 69, name: 'Similarity Search', group: 'firewall', blurb: 'Find similar past scans (embed / trigram).' },
  { id: 70, name: 'Explanation Mode', group: 'firewall', blurb: 'Plain-English narration of every scan.' },
  { id: 71, name: 'Neural Oscillations', group: 'view', blurb: 'Delta/theta/alpha/beta/gamma modulation.' },
  { id: 72, name: 'Layer Explorer', group: 'view', blurb: 'Searchable index of every shipped layer.' },
  { id: 73, name: 'Text Adventure Training', group: 'progression', blurb: 'Choose-your-reply manipulation scenarios.' },
  { id: 74, name: 'Firewall Comparator', group: 'firewall', blurb: 'Same text through 2 rulesets side-by-side.' },
];

export const LAYER_GROUPS = {
  view: { label: '3D & UX', color: '#5ad4ff' },
  firewall: { label: 'Cognitive Firewall', color: '#a86fdf' },
  share: { label: 'Share & Cards', color: '#fdab43' },
  data: { label: 'Data & State', color: '#5ee69a' },
  backend: { label: 'Backend & Agents', color: '#77dbe4' },
  progression: { label: 'Progression', color: '#e57b40' },
};

export function searchLayers(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return LAYER_CATALOG;
  return LAYER_CATALOG.filter((l) =>
    l.name.toLowerCase().includes(q)
    || l.blurb.toLowerCase().includes(q)
    || String(l.id) === q
    || LAYER_GROUPS[l.group]?.label.toLowerCase().includes(q)
  );
}
