import React from 'react';
import { Copy, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatDate } from '../../lib/formatters.js';

export function HistoryCard({ item, onOpen, onDuplicate, onDelete }) {
  return (
    <article className="history-card">
      <div className="history-card-head">
        <div>
          <Badge tone={item.status === 'Approved' ? 'success' : item.verdict?.includes('risk') ? 'warning' : 'cyan'}>{item.status || 'Draft'}</Badge>
          <h3>{item.title}</h3>
          <p>{item.excerpt}</p>
        </div>
        <span className="bsn-mono">{formatDate(item.updatedAt || item.savedAt)}</span>
      </div>
      <div className="history-score-row">
        <span>Hook {item.keyScores?.hookStrength ?? '-'}</span>
        <span>Trust {item.keyScores?.trust ?? '-'}</span>
        <span>Risk {item.keyScores?.manipulationRisk ?? '-'}</span>
        <span>{item.versions?.length || 1} version(s)</span>
      </div>
      <div className="history-actions">
        <Button variant="primary" size="sm" onClick={() => onOpen(item)}>Open</Button>
        <Button variant="secondary" size="sm" onClick={() => onDuplicate(item)}><RotateCw size={15} aria-hidden="true" /> Duplicate/rescan</Button>
        <Button variant="ghost" size="sm" onClick={() => navigator.clipboard?.writeText(item.result?.rawContent || item.excerpt)}><Copy size={15} aria-hidden="true" /> Copy</Button>
        <Button variant="ghost" size="sm" onClick={() => onDelete(item.id)}><Trash2 size={15} aria-hidden="true" /> Delete</Button>
      </div>
    </article>
  );
}
