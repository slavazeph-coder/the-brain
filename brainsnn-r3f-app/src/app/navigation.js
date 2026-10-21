import { Bot, Camera, Code2, FileSearch, FlaskConical, Microscope, Layers, ScanLine, Building2 } from 'lucide-react';
export const NAV_ITEMS = [
  { id: 'world', label: 'World Engine', mobileLabel: 'World', href: '/', icon: ScanLine, description: 'Turn ordinary phone video and photos into useful 3D worlds.' },
  { id: 'use-cases', label: 'Use cases', mobileLabel: 'Uses', href: '/#industries', icon: Building2, description: 'Explore spatial workflows for property, trades, design and robotics.' },
  { id: 'arena', label: 'Robot Arena', mobileLabel: 'Arena', href: '/arena/', icon: Bot, description: 'Explore robot challenges and site planning previews.' },
  { id: 'developers', label: 'Developers', mobileLabel: 'API', href: '/#developers', icon: Code2, description: 'Learn about the proposed BrainSNN World Engine API.' },
];
export const OVERFLOW_ITEMS = [
  { id: 'scan', label: 'Capture studio', mobileLabel: 'Scan', href: '/scan', icon: Camera, description: 'Preview your phone video or photos and prepare for reconstruction.' },
  { id: 'test-packs', label: 'Robot test pricing', href: '/arena/#campaigns', icon: Layers, description: 'Inspect robot test-pack pricing assumptions.' },
  { id: 'review', label: 'Review', mobileLabel: 'Review', href: '/office', icon: FileSearch, description: 'Review passages, drafts, claims and timestamped cues.' },
  { id: 'evidence', label: 'Evidence', mobileLabel: 'Evidence', href: '/evidence', icon: Microscope, description: 'Inspect the text detector evaluation and its limits.' },
  { id: 'lab', label: 'Lab', href: '/lab', icon: FlaskConical, description: 'Explore experiments and research tools.' },
];
export function getNavItem(id) {
  return [...NAV_ITEMS, ...OVERFLOW_ITEMS].find(item => item.id === id) || NAV_ITEMS[0];
}
