import React from 'react';
import { Command, Download } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { getNavItem } from './navigation.js';

export function AppHeader({ active, onOpenCommand, onExport, hasResult }) {
  const item = getNavItem(active);
  return (
    <header className="app-header app-header-compact">
      <div>
        <p className="bsn-kicker">{item.label}</p>
      </div>
      <div className="header-actions">
        <Button variant="ghost" onClick={onOpenCommand}><Command size={16} aria-hidden="true" /> Command</Button>
        <span title={hasResult ? undefined : 'Run a scan first to export it'}>
          <Button variant="primary" onClick={onExport} disabled={!hasResult}><Download size={16} aria-hidden="true" /> Export</Button>
        </span>
      </div>
    </header>
  );
}
