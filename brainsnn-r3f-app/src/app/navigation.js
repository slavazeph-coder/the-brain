import { Brain, CreditCard, FlaskConical, Gamepad2, GitCompare, History, ListChecks, Orbit, Sparkles } from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'worlds', label: 'Behaviour Lab', mobileLabel: 'Lab', icon: Orbit, description: 'Run reproducible worlds, interventions and behavioural comparisons.' },
  { id: 'analyze', label: 'Creative Engine', mobileLabel: 'Analyze', icon: Brain, description: 'Scan content for attention, trust and risk signals.' },
  { id: 'improve', label: 'Improve', mobileLabel: 'Improve', icon: Sparkles, description: 'Generate and compare a stronger rewrite.' },
  { id: 'autopsy', label: 'Compare', mobileLabel: 'Compare', icon: GitCompare, description: 'Score two variants side by side.' },
  { id: 'queue', label: 'Approvals', mobileLabel: 'More', icon: ListChecks, description: 'Drafts waiting for review or export.' },
  { id: 'history', label: 'History', mobileLabel: 'More', icon: History, description: 'Saved scans and versions.' },
  { id: 'pricing', label: 'Pricing', mobileLabel: 'More', icon: CreditCard, description: 'Plans and upgrade options.' },
  { id: 'arcade', label: 'Public Worlds', mobileLabel: 'More', icon: Gamepad2, description: 'Explore the GaugeGap science arcade and interactive labs.' },
  { id: 'research', label: 'Research', mobileLabel: 'More', icon: FlaskConical, description: 'Layer map and experimental lab.' },
];

export function getNavItem(id) {
  return NAV_ITEMS.find((item) => item.id === id) || NAV_ITEMS[0];
}
