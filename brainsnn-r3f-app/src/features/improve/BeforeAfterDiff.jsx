import React, { useMemo } from 'react';
import { diffDrafts, summarizeDiff } from '../../lib/draftDiff.js';

const STATUS_LABEL = {
  moved: 'moved',
  edited: 'reworded',
  added: 'added',
  removed: 'removed',
};

function Sentence({ row }) {
  if (row.status === 'same') return <span className="diff-sentence">{row.text} </span>;
  return (
    <span className={`diff-sentence diff-${row.status}`}>
      <span className="diff-flag" aria-hidden="true">{STATUS_LABEL[row.status]}</span>
      {row.tokens
        ? row.tokens.map((token, index) => (token.changed
          ? <mark key={`${token.text}-${index}`}>{token.text}</mark>
          : <React.Fragment key={`${token.text}-${index}`}>{token.text}</React.Fragment>))
        : row.text}{' '}
    </span>
  );
}

/**
 * What changed, at sentence level.
 *
 * The status flag matters as much as the highlight: a moved sentence is
 * identical text in a new place, so colour alone cannot say what happened to
 * it — and colour alone is not available to everyone anyway.
 */
export function BeforeAfterDiff({ before, after }) {
  const diff = useMemo(() => diffDrafts(before, after), [before, after]);

  return (
    <section className="before-after-diff" aria-labelledby="diff-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Diff</p>
          <h2 id="diff-heading">What changed</h2>
        </div>
        <span className="diff-summary">{summarizeDiff(diff)}</span>
      </div>
      <div className="diff-columns">
        <article>
          <h3>Original</h3>
          <p>{diff.before.map((row, index) => <Sentence key={`b-${index}`} row={row} />)}</p>
        </article>
        <article>
          <h3>Your draft</h3>
          <p>{diff.after.map((row, index) => <Sentence key={`a-${index}`} row={row} />)}</p>
        </article>
      </div>
    </section>
  );
}
