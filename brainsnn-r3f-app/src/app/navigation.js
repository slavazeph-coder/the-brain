import { Bot, Brain, BrainCircuit, Camera, Code2, FileSearch, FlaskConical, Footprints, Microscope, Layers, Building2 } from 'lucide-react';
// The four doors the site leads with. Walk is the call to action in the public nav.
export const NAV_ITEMS = [
  { id: 'walk', label: 'Walk', mobileLabel: 'Walk', href: '/walk/', icon: Footprints, cta: true, ctaLabel: 'Walk a space', description: 'Map a space with your phone: GPS track, tapped features, photos and video.' },
  { id: 'world', label: 'World Builder', mobileLabel: 'World', href: '/world/', icon: Building2, description: 'Turn a walk, photos or a scan into an editable 3D world and try a robot in it.' },
  { id: 'creative-engine', label: 'Creative Engine', mobileLabel: 'Engine', href: '/app', icon: Brain, description: 'Scan, improve and compare drafts for attention, trust and pressure signals.' },
  { id: 'developers', label: 'API', mobileLabel: 'API', href: '/platform/', icon: Code2, description: 'Developer platform: sandbox, API explorer, client review, keys and usage.' },
  { id: 'lab', label: 'Lab', mobileLabel: 'Lab', href: '/lab', icon: FlaskConical, description: 'Explore experiments and research tools.' },
];
export const OVERFLOW_ITEMS = [
  { id: 'agent-lab', label: 'Agent Lab', href: '/agent-lab', icon: BrainCircuit, description: 'How BrainSNN analyzes, improves and tests agent work, with recorded evidence.' },
  { id: 'arena', label: 'Robot Arena', mobileLabel: 'Arena', href: '/arena/', icon: Bot, description: 'Explore robot challenges and site planning previews.' },
  { id: 'scan', label: 'Capture studio', mobileLabel: 'Scan', href: '/scan', icon: Camera, description: 'Preview your phone video or photos and prepare for reconstruction.' },
  { id: 'test-packs', label: 'Robot test pricing', href: '/arena/#campaigns', icon: Layers, description: 'Inspect robot test-pack pricing assumptions.' },
  { id: 'review', label: 'Review', mobileLabel: 'Review', href: '/office', icon: FileSearch, description: 'Review passages, drafts, claims and timestamped cues.' },
  { id: 'evidence', label: 'Evidence', mobileLabel: 'Evidence', href: '/evidence', icon: Microscope, description: 'Inspect the text detector evaluation and its limits.' },
];
export function getNavItem(id) {
  return [...NAV_ITEMS, ...OVERFLOW_ITEMS].find(item => item.id === id) || NAV_ITEMS[0];
}
