import { Bot, FileSearch, FlaskConical, Microscope, Layers } from 'lucide-react';
export const NAV_ITEMS = [
  { id: 'arena', label: 'Robot arcade', mobileLabel: 'Arcade', href: '/arena/', icon: Bot, description: 'Choose a robot and model, try a challenge and replay a run.' },
  { id: 'test-packs', label: 'Test packs', mobileLabel: 'Test packs', href: '/arena/#campaigns', icon: Layers, description: 'Explore repeatable robot-policy test packs and their readiness.' },
];
export const OVERFLOW_ITEMS = [
  { id: 'review', label: 'Review', mobileLabel: 'Review', href: '/office', icon: FileSearch, description: 'Review passages, drafts, claims and timestamped cues.' },
  { id: 'evidence', label: 'Evidence', mobileLabel: 'Evidence', href: '/evidence', icon: Microscope, description: 'Inspect the detector’s evaluation, known misses and false alarms.' },
  { id: 'lab', label: 'Lab', href: '/lab', icon: FlaskConical, description: 'Explore toys and experiments.' },
];
export function getNavItem(id) {
  return [...NAV_ITEMS, ...OVERFLOW_ITEMS].find((item) => item.id === id) || OVERFLOW_ITEMS[0];
}
