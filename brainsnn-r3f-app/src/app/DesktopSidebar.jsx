import React from 'react';
import { BrainCircuit, ChevronLeft, ChevronRight, CreditCard } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton.jsx';
import { NAV_ITEMS } from './navigation.js';

const WORKFLOW_IDS = ['analyze', 'improve', 'autopsy', 'queue'];
const LIBRARY_IDS = ['history', 'arcade', 'research'];

function NavButton({ item, active, collapsed, onNavigate }) {
  return (
    <button type="button" className={active === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
      <item.icon size={18} aria-hidden="true" />
      {!collapsed ? <span>{item.label}</span> : null}
    </button>
  );
}

export function DesktopSidebar({ active, onNavigate, collapsed, onToggle, onUpgrade }) {
  const workflowItems = WORKFLOW_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)).filter(Boolean);
  const libraryItems = LIBRARY_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)).filter(Boolean);
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
        {workflowItems.map((item) => (
          <NavButton key={item.id} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="sidebar-bottom">
        {libraryItems.map((item) => (
          <NavButton key={item.id} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
        <button type="button" className={active === 'pricing' ? 'active' : ''} onClick={onUpgrade}>
          <CreditCard size={18} aria-hidden="true" />
          {!collapsed ? <span>Pricing</span> : null}
        </button>
        <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
        </IconButton>
      </div>
    </aside>
  );
}
