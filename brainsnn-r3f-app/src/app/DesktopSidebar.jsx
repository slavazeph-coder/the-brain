import React from 'react';
import { BrainCircuit, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton.jsx';
import { NAV_ITEMS } from './navigation.js';

export function DesktopSidebar({ active, onNavigate, collapsed, onToggle, onUpgrade }) {
  const ResearchIcon = NAV_ITEMS[4].icon;
  return (
    <aside className={`desktop-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <span className="brand-glyph"><BrainCircuit size={22} aria-hidden="true" /></span>
        {!collapsed ? (
          <span>
            <strong>BrainSNN</strong>
            <small>Decision Engine</small>
          </span>
        ) : null}
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.slice(0, 4).map((item) => (
          <button key={item.id} type="button" className={active === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
            <item.icon size={18} aria-hidden="true" />
            {!collapsed ? <span>{item.label}</span> : null}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <button type="button" className={active === 'research' ? 'active' : ''} onClick={() => onNavigate('research')}>
          <ResearchIcon size={18} aria-hidden="true" />
          {!collapsed ? <span>Research</span> : null}
        </button>
        <button type="button" onClick={onUpgrade}>
          <Settings size={18} aria-hidden="true" />
          {!collapsed ? <span>Plans</span> : null}
        </button>
        <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
        </IconButton>
      </div>
    </aside>
  );
}
