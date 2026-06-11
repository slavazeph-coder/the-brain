/**
 * The one registry mapping sections → the panels they contain.
 *
 * Drives the SectionNav count badges, each section's header + table of
 * contents, and cross-section ⌘K navigation (sectionForLayer). Panels are
 * listed in render order. `layerId` keys into LAYER_CATALOG (and becomes
 * the `data-panel-id="l<N>"` anchor); the few panels that aren't catalog
 * layers use a string `anchor` instead and must carry their own `title`.
 */
import { LAYER_CATALOG } from './layerCatalog';

const BY_ID = new Map(LAYER_CATALOG.map((l) => [l.id, l]));

export const SECTION_REGISTRY = {
  insights: {
    label: 'Insights',
    blurb: 'Live charts, correlations, and a plain-language narration of what the brain is doing right now.',
    panels: [
      { anchor: 'activity-charts', title: 'Activity Charts' },
      { layerId: 7 },
      { layerId: 8, title: 'Narrative Engine' },
    ],
  },
  firewall: {
    label: 'Scan & Firewall',
    blurb: 'Score any text for manipulation — locally, or with TRIBE v2 / Gemini / Gemma — and gate it through the Lobster Trap.',
    panels: [
      { layerId: 3, title: 'TRIBE v2' },
      { layerId: 38, title: 'Daily Challenge' },
      { anchor: 'quiz', title: 'Manipulation Quiz' },
      { layerId: 4 },
      { layerId: 5, title: 'Gemma Analysis' },
      { layerId: 101, title: 'Gemini Analysis' },
      { layerId: 102, title: 'Lobster Trap' },
    ],
  },
  knowledge: {
    label: 'Knowledge',
    blurb: 'Save and replay brain states, build a second brain from your notes and code, and let agents steer it over MCP.',
    panels: [
      { layerId: 6 },
      { layerId: 17 },
      { layerId: 18 },
      { layerId: 19 },
      { layerId: 20, title: 'Code Brain' },
      { layerId: 21 },
      { layerId: 22 },
    ],
  },
  defense: {
    label: 'Defense',
    blurb: 'Stress-test the firewall: red-team corpora, autopsies, inbox triage, fingerprints, and your immunity score.',
    panels: [
      { layerId: 23, title: 'Immunity Score' },
      { layerId: 24, title: 'Embeddings' },
      { layerId: 25, title: 'Red Team' },
      { anchor: 'bypass-submit', title: 'Bypass Submit' },
      { layerId: 36, title: 'Autopsy' },
      { layerId: 43, title: 'Time-Series' },
      { layerId: 44, title: 'Inbox' },
      { layerId: 47, title: 'Diff' },
      { layerId: 49 },
      { layerId: 50 },
      { layerId: 51, title: 'Fingerprint' },
      { layerId: 53, title: 'Echo' },
    ],
  },
  tools: {
    label: 'Tools',
    blurb: 'The workbench: custom rules, OCR and audio scanning, macros, diagnostics, replay, and the full layer index.',
    searchCta: true,
    panels: [
      { layerId: 54, title: 'API Docs' },
      { layerId: 55, title: 'Custom Rules' },
      { layerId: 56, title: 'Badges' },
      { layerId: 57, title: 'Portability' },
      { layerId: 58, title: 'Image OCR' },
      { layerId: 59, title: 'Audio' },
      { layerId: 60, title: 'Macros' },
      { layerId: 61, title: 'Diagnostic' },
      { layerId: 62, title: 'Hypothesis' },
      { layerId: 63 },
      { layerId: 64, title: 'Debate' },
      { layerId: 65, title: 'Replay' },
      { layerId: 66, title: 'Coverage' },
      { layerId: 67 },
      { layerId: 68 },
      { layerId: 69 },
      { layerId: 71, title: 'Oscillations' },
      { layerId: 72 },
    ],
  },
  studio: {
    label: 'Studio',
    blurb: 'Play and personalize: training games, persona lenses, reply composer, themes, rule packs, and milestones.',
    searchCta: true,
    panels: [
      { layerId: 73, title: 'Text Adventure' },
      { layerId: 74, title: 'Comparator' },
      { layerId: 75, title: 'Drill-Down' },
      { layerId: 77 },
      { layerId: 79, title: 'Compliment' },
      { layerId: 81, title: 'Extension' },
      { layerId: 83, title: 'Rule Packs' },
      { layerId: 84 },
      { layerId: 85, title: 'Journalism' },
      { layerId: 86 },
      { layerId: 87, title: 'Genre' },
      { layerId: 88 },
      { layerId: 89, title: 'Reply Composer' },
      { layerId: 90 },
      { layerId: 91, title: 'PWA Install' },
      { layerId: 93, title: 'Feedback' },
      { layerId: 94 },
      { layerId: 96, title: 'Cross-device Sync' },
      { layerId: 98, title: 'Theme & A11y' },
      { layerId: 99, title: 'Community Pack' },
      { layerId: 100, title: 'Milestones' },
      { layerId: 26 },
      { layerId: 27 },
    ],
  },
  neuro: {
    label: 'Neuro & RAG',
    blurb: 'The research bench: retrieval over your docs, affect decoding, neurochemistry sliders, and evolving rulesets.',
    panels: [
      { layerId: 28 },
      { layerId: 33, title: 'Multimodal RAG' },
      { layerId: 34 },
      { layerId: 35, title: 'Direct Insert' },
      { layerId: 29 },
      { layerId: 30, title: 'Neurochemistry' },
      { layerId: 31 },
      { layerId: 32 },
      { layerId: 13 },
    ],
  },
  io: {
    label: 'Share & I/O',
    blurb: 'Get things in and out: voice narration, plugins, live sync rooms, share links, GIF export, and EEG input.',
    panels: [
      { layerId: 14, title: 'Voice Narrator' },
      { layerId: 15, title: 'Plugins' },
      { layerId: 16 },
      { layerId: 11, title: 'Share & Embed' },
      { anchor: 'export', title: 'Export' },
      { anchor: 'timeline', title: 'Timeline Replay' },
      { anchor: 'eeg', title: 'Live EEG' },
    ],
  },
};

/** Resolved panel entry: { key, title } where key is `l<N>` or the anchor. */
export function sectionPanels(sectionId) {
  const section = SECTION_REGISTRY[sectionId];
  if (!section) return [];
  return section.panels.map((p) => ({
    key: p.layerId != null ? `l${p.layerId}` : p.anchor,
    layerId: p.layerId ?? p.anchor,
    title: p.title || BY_ID.get(p.layerId)?.name || String(p.anchor),
  }));
}

/** Which section contains a given catalog layer id (or string anchor)? */
export function sectionForLayer(layerId) {
  for (const [id, section] of Object.entries(SECTION_REGISTRY)) {
    for (const p of section.panels) {
      if (p.layerId === layerId || p.anchor === layerId) return id;
    }
  }
  return null;
}

export function sectionPanelCount(sectionId) {
  return SECTION_REGISTRY[sectionId]?.panels.length ?? 0;
}
