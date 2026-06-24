import React from 'react';
import { Download, RotateCcw, ThumbsUp } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatDate } from '../../lib/formatters.js';

const toneByStatus = {
  Draft: 'purple',
  'Needs changes': 'warning',
  Ready: 'cyan',
  Approved: 'success',
  Exported: 'cyan',
};

export function ApprovalCard({ item, onOpen, onApprove, onReturn, onExport }) {
  return (
    <article className="approval-card">
      <div>
        <Badge tone={toneByStatus[item.status] || 'purple'}>{item.status || 'Draft'}</Badge>
        <h3>{item.title}</h3>
        <p>{item.excerpt}</p>
        <p className="bsn-mono">Version {item.currentVersion || 1} - Updated {formatDate(item.updatedAt)}</p>
      </div>
      <div className="approval-actions">
        <Button variant="primary" size="sm" onClick={() => onOpen(item)}>Open</Button>
        <Button variant="secondary" size="sm" onClick={() => onApprove(item)}><ThumbsUp size={15} aria-hidden="true" /> Approve</Button>
        <Button variant="ghost" size="sm" onClick={() => onReturn(item)}><RotateCcw size={15} aria-hidden="true" /> Return to Synapse</Button>
        <Button variant="ghost" size="sm" onClick={() => onExport(item)}><Download size={15} aria-hidden="true" /> Export</Button>
      </div>
    </article>
  );
}
