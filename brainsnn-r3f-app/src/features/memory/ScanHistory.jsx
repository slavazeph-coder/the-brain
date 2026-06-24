import React, { useMemo, useState } from 'react';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { MemoryFilters } from './MemoryFilters.jsx';
import { HistoryCard } from './HistoryCard.jsx';

function matches(item, filter) {
  if (filter === 'All') return true;
  if (filter === 'High potential') return (item.keyScores?.hookStrength || 0) >= 70;
  if (filter === 'Trust risk') return (item.keyScores?.trust || 0) < 55;
  if (filter === 'High manipulation risk') return (item.keyScores?.manipulationRisk || 0) >= 65;
  return item.status === filter;
}

export function ScanHistory({ history, onOpen, onDuplicate, onGoToCortex }) {
  const [filter, setFilter] = useState('All');
  const filtered = useMemo(() => history.items.filter((item) => matches(item, filter)), [filter, history.items]);

  if (!history.items.length) {
    return (
      <div className="memory-workspace">
        <header className="workspace-heading">
          <p className="bsn-kicker">Memory</p>
          <h1>Your local publishing memory.</h1>
          <p>Completed scans, saved versions and verdicts will appear here. This version stores them only in this browser.</p>
        </header>
        <EmptyState title="No saved scans yet" actionLabel="Run a Brain Scan" onAction={onGoToCortex}>
          Save a result from Cortex to build a useful local history of what works for your content.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="memory-workspace" data-testid="memory-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Memory</p>
        <h1>Previous scans and versions.</h1>
        <p>Local-only history for comparing drafts over time. No cloud sync is implied in this build.</p>
      </header>
      <div className="memory-toolbar">
        <MemoryFilters value={filter} onChange={setFilter} />
        <Button variant="ghost" onClick={() => { if (window.confirm('Clear all local BrainSNN memory?')) history.clear(); }}>Clear all</Button>
      </div>
      <div className="history-list">
        {filtered.map((item) => (
          <HistoryCard
            key={item.id}
            item={item}
            onOpen={onOpen}
            onDuplicate={onDuplicate}
            onDelete={history.remove}
          />
        ))}
      </div>
    </div>
  );
}
