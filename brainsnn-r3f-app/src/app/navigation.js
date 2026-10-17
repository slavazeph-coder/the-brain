import { Bot, FileSearch, FlaskConical, Microscope } from 'lucide-react';
export const NAV_ITEMS = [
  { id: 'arena', label: 'Arena', mobileLabel: 'Arena', href: '/arena/', icon: Bot, description: 'Run a mission and inspect what changes.' },
  { id: 'review', label: 'Review', mobileLabel: 'Review', href: '/office', icon: FileSearch, description: 'Review passages, drafts, claims and timestamped cues.' },
  { id: 'evidence', label: 'Evidence', mobileLabel: 'Evidence', href: '/evidence', icon: Microscope, description: 'Inspect the detector’s evaluation, known misses and false alarms.' },
];
export const OVERFLOW_ITEMS = [
  { id: 'lab', label: 'Lab', href: '/lab', icon: FlaskConical, description: 'Explore toys and experiments.' },
];
export function getNavItem(id) {
  return [...NAV_ITEMS, ...OVERFLOW_ITEMS].find((item) => item.id === id) || NAV_ITEMS[1];
}
