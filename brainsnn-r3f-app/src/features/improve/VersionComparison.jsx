import React from 'react';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { signedDelta } from '../../lib/formatters.js';
import { compareResults } from '../../lib/scoreMapping.js';

export function VersionComparison({ originalResult, revisedResult }) {
  const rows = revisedResult ? compareResults(originalResult, revisedResult) : [];
  return (
    <section className="version-comparison" aria-labelledby="version-comparison-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Compare</p>
          <h2 id="version-comparison-heading">Version 1 vs Version 2</h2>
        </div>
      </div>
      {!rows.length ? <p className="bsn-note">Run comparison to see directional score changes.</p> : null}
      <div className="comparison-grid">
        {rows.map((row) => {
          const Icon = row.delta > 0 ? ArrowUp : row.delta < 0 ? ArrowDown : ArrowRight;
          return (
            <article key={row.id}>
              <span className="bsn-mono">{row.label}</span>
              <strong className={row.status}><Icon size={16} aria-hidden="true" /> {signedDelta(row.delta)}</strong>
              <p>{row.before} → {row.after}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
