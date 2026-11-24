import React from 'react';
import { ArrowLeft, BrainCircuit, ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton.jsx';
import { ANALYZER_ITEMS, ANALYZER_MORE_ITEMS } from '../features/analyzer/analyzerNavigation.js';


function NavButton({ item, active, collapsed, onNavigate }) {
  return (
    <button type="button" aria-label={item.label} className={active === item.id ? 'active' : ''} onClick={() => onNavigate(item.id)}>
      <item.icon size={18} aria-hidden="true" />
      {!collapsed ? <span>{item.label}</span> : null}
    </button>
  );
}

export function DesktopSidebar({ active, onNavigate, collapsed, onToggle }) {
  const workflowItems = [...ANALYZER_ITEMS, ...ANALYZER_MORE_ITEMS];
  return (
    <aside className={`desktop-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary navigation">
      <div className="sidebar-brand">
        <span className="brand-glyph"><BrainCircuit size={22} aria-hidden="true" /></span>
        {!collapsed ? (
          <span>
            <strong>BrainSNN</strong>
            <small>Creative Engine</small>
          </span>
        ) : null}
      </div>
      <nav className="sidebar-nav">
        {workflowItems.map((item) => (
          <NavButton key={item.id} item={item} active={active} collapsed={collapsed} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="sidebar-bottom">
        <a className="sidebar-site-link" href="/" aria-label="BrainSNN home"><ArrowLeft size={16} aria-hidden="true" />{!collapsed ? <span>BrainSNN home</span> : null}</a>
        <IconButton label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} aria-hidden="true" /> : <ChevronLeft size={18} aria-hidden="true" />}
        </IconButton>
      </div>
    </aside>
  );
}
