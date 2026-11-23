import { Brain, CreditCard, FlaskConical, GitCompare, History, ListChecks, Sparkles } from 'lucide-react';

// The Creative Engine's own sections. Each has a URL under /app so a section can
// be linked, bookmarked and reached with Back; the first three are the mobile tabs.
export const ANALYZER_ITEMS = [
  { id: 'analyze', path: '/app', label: 'Creative Engine', mobileLabel: 'Analyze', icon: Brain, description: 'Scan a draft for attention, trust and pressure signals.' },
  { id: 'improve', path: '/app/improve', label: 'Improve', mobileLabel: 'Improve', icon: Sparkles, description: 'Apply fixes and compare the rewrite with the original.' },
  { id: 'compare', path: '/app/compare', label: 'Compare', mobileLabel: 'Compare', icon: GitCompare, description: 'Score two versions side by side.' },
];
export const ANALYZER_MORE_ITEMS = [
  { id: 'queue', path: '/app/approvals', label: 'Approvals', icon: ListChecks, description: 'Drafts waiting for review or export.' },
  { id: 'history', path: '/app/history', label: 'History', icon: History, description: 'Saved scans and versions on this device.' },
  { id: 'research', path: '/app/research', label: 'Research', icon: FlaskConical, description: 'The 103-layer map, the 39 Hz soliton lab and decoded transcripts.' },
  { id: 'pricing', path: '/app/pricing', label: 'Pricing', icon: CreditCard, description: 'Plans and upgrade options.' },
];
const ALL = [...ANALYZER_ITEMS, ...ANALYZER_MORE_ITEMS];

export function analyzerItem(id) {
  return ALL.find((item) => item.id === id) || ALL[0];
}

/** The section a /app path names; unknown sub-paths open the scan. */
export function analyzerSection(pathname = '/app') {
  const path = pathname.replace(/\/+$/, '') || '/app';
  return ALL.find((item) => item.path === path)?.id || 'analyze';
}
