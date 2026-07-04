import React from 'react';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { ApprovalCard } from './ApprovalCard.jsx';

export function ApprovalQueue({ queue, onGoToCortex, onOpen, onApprove, onReturn, onExport }) {
  if (!queue.length) {
    return (
      <div className="queue-workspace">
        <header className="workspace-heading">
          <p className="bsn-kicker">Approvals</p>
          <h1>Drafts waiting for a decision.</h1>
          <p>Keep drafts that need changes, approval or export. This stays in your browser until team workflows are implemented.</p>
        </header>
        <EmptyState title="Nothing waiting for review" actionLabel="Scan a draft to get started" onAction={onGoToCortex}>
          Add a scan result or an improved version here when it is ready for your publishing checklist.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="queue-workspace" data-testid="queue-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Approvals</p>
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
