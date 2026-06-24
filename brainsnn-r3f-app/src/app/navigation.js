import { Brain, GitCompare, History, Send, FlaskConical } from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'cortex', label: 'Cortex', mobileLabel: 'Scan', icon: Brain, description: 'Scan and diagnose content.' },
  { id: 'synapse', label: 'Synapse', mobileLabel: 'Improve', icon: GitCompare, description: 'Rewrite and compare versions.' },
  { id: 'memory', label: 'Memory', mobileLabel: 'Memory', icon: History, description: 'Saved scans and versions.' },
  { id: 'queue', label: 'Neural Queue', mobileLabel: 'More', icon: Send, description: 'Local approvals and exports.' },
  { id: 'research', label: 'Research', mobileLabel: 'More', icon: FlaskConical, description: 'Advanced SNN and Crumb lab.' },
];

export function getNavItem(id) {
  return NAV_ITEMS.find((item) => item.id === id) || NAV_ITEMS[0];
}
