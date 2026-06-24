import React from 'react';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ApprovalCard } from './ApprovalCard.jsx';

export function ApprovalQueue({ queue, onGoToCortex, onOpen, onApprove, onReturn, onExport }) {
  if (!queue.length) {
    return (
      <div className="queue-workspace">
        <header className="workspace-heading">
          <p className="bsn-kicker">Neural Queue</p>
          <h1>Your local review queue.</h1>
          <p>Keep drafts that need changes, approval or export. This is local-only until team workflows are implemented.</p>
        </header>
        <EmptyState title="Nothing waiting for review" actionLabel="Run a Brain Scan" onAction={onGoToCortex}>
          Add a result or Synapse version to the queue when it is ready for your publishing checklist.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="queue-workspace" data-testid="queue-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Neural Queue</p>
        <h1>Drafts awaiting a publishing decision.</h1>
        <p>Local statuses: Draft, Needs changes, Ready, Approved and Exported.</p>
      </header>
      <div className="approval-list">
        {queue.map((item) => (
          <ApprovalCard
            key={item.id}
            item={item}
            onOpen={onOpen}
            onApprove={onApprove}
            onReturn={onReturn}
            onExport={onExport}
          />
        ))}
      </div>
    </div>
  );
}
