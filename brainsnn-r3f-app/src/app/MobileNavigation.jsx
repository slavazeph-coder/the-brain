import React from 'react';
import { Brain, Ellipsis, GitCompare, History } from 'lucide-react';

const mobileItems = [
  { id: 'cortex', label: 'Scan', icon: Brain },
  { id: 'synapse', label: 'Improve', icon: GitCompare },
  { id: 'memory', label: 'Memory', icon: History },
  { id: 'queue', label: 'More', icon: Ellipsis },
];

export function MobileNavigation({ active, onNavigate }) {
  return (
    <nav className="mobile-navigation" aria-label="Mobile navigation">
      {mobileItems.map((item) => {
        const isActive = active === item.id || (item.id === 'queue' && active === 'research');
        return (
          <button key={item.id} type="button" className={isActive ? 'active' : ''} onClick={() => onNavigate(item.id)}>
            <item.icon size={18} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
