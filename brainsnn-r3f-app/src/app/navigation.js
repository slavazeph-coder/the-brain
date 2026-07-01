import { Brain, CreditCard, FlaskConical, GitCompare, History, Microscope, Sparkles } from 'lucide-react';
import { LAYER_CATALOG } from '../lib/layerCatalog.js';

export const NAV_ITEMS = [
  { id: 'analyze', label: 'Analyze', mobileLabel: 'Analyze', icon: Brain, description: 'Cortex scan for attention, trust and trigger signals.' },
  { id: 'improve', label: 'Improve', mobileLabel: 'Improve', icon: Sparkles, description: 'Synapse rewrites and version comparison.' },
  { id: 'autopsy', label: 'Autopsy', mobileLabel: 'Autopsy', icon: GitCompare, description: 'Battle two variants through the layer stack.' },
  { id: 'history', label: 'History', mobileLabel: 'More', icon: History, description: 'Memory, context triggers and saved scans.' },
  { id: 'pricing', label: 'Pricing', mobileLabel: 'More', icon: CreditCard, description: 'Paid beta plans and engine readiness.' },
  { id: 'research', label: 'Research', mobileLabel: 'More', icon: FlaskConical, description: `${LAYER_CATALOG.length}-layer map, TRIBE, Gemma and Crumb lab.` },
  { id: 'queue', label: 'Queue', mobileLabel: 'More', icon: Microscope, description: 'Local review queue and approvals.' },
];

export function getNavItem(id) {
  return NAV_ITEMS.find((item) => item.id === id) || NAV_ITEMS[0];
}
