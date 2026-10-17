import React from 'react';
import { BrainCircuit, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton.jsx';
import { NAV_ITEMS, OVERFLOW_ITEMS } from './navigation.js';


function NavButton({ item, active, collapsed, onNavigate }) {
  return (
    <button type="button" aria-label={item.label} className={active === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
      <item.icon size={18} aria-hidden="true" />
      {!collapsed ? <span>{item.label}</span> : null}
    </button>
  );
}

export function DesktopSidebar({ active, onNavigate, collapsed, onToggle }) {
  const workflowItems = NAV_ITEMS;
  return (
    <aside className={`desktop-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <span className="brand-glyph"><BrainCircuit size={22} aria-hidden="true" /></span>
        {!collapsed ? (
          <span>
            <strong>BrainSNN</strong>
            <small>Robot policy testing</small>
          </span>
        ) : null}
      </div>
      <nav className="sidebar-nav">
        {workflowItems.map((item) => (
          <NavButton key={item.id} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="sidebar-bottom">
        <details><summary aria-label="More navigation">More</summary>{OVERFLOW_ITEMS.map((item) => <NavButton key={item.id} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />)}</details>
        <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
        </IconButton>
      </div>
    </aside>
  );
}
