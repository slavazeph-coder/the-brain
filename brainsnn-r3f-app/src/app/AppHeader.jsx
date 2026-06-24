import React from 'react';
import { Command, Download, Sparkles } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { getNavItem } from './navigation.js';

export function AppHeader({ active, onOpenCommand, onExport, onUpgrade, hasResult }) {
  const item = getNavItem(active);
  return (
    <header className="app-header">
      <div>
        <p className="bsn-kicker">{item.label}</p>
        <h1>{item.description}</h1>
        <p>The decision engine for everything your brand publishes.</p>
        <div className="app-header-status" aria-label="System status">
          <span className="status-chip"><span aria-hidden="true" />SNN_ENGINE_ACTIVE</span>
          <span className="status-chip"><span aria-hidden="true" />LOCAL_MEMORY_READY</span>
        </div>
      </div>
      <div className="header-actions">
        <Button variant="ghost" onClick={onOpenCommand}><Command size={16} aria-hidden="true" /> Command</Button>
        <Button variant="secondary" onClick={onUpgrade}><Sparkles size={16} aria-hidden="true" /> Pro / Pilot</Button>
        <Button variant="primary" onClick={onExport} disabled={!hasResult}><Download size={16} aria-hidden="true" /> Export</Button>
      </div>
    </header>
  );
}
