import { Bot, Camera, Code2, FileSearch, FlaskConical, Microscope, Layers, ScanLine, Building2 } from 'lucide-react';
export const NAV_ITEMS = [
  { id: 'world', label: 'World Builder', mobileLabel: 'World', href: '/', icon: ScanLine, description: 'Turn any photo into a world. Turn any world into a robot simulation.' },
  { id: 'create', label: 'Create a world', mobileLabel: 'Create', href: '/world/index.html#workspace', icon: Building2, description: 'Start from a photo, a phone walkthrough or an existing scan.' },
  { id: 'arena', label: 'Robot Arena', mobileLabel: 'Arena', href: '/arena/', icon: Bot, description: 'Explore robot challenges and site planning previews.' },
  { id: 'developers', label: 'Developers', mobileLabel: 'API', href: '/world/api.html', icon: Code2, description: 'Private worker API for captures, jobs and artifacts.' },
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
