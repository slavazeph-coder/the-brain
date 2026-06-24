import React from 'react';

function tokenize(text) {
  return String(text || '').split(/(\s+)/).filter(Boolean);
}

function renderDiff(before, after, mode) {
  const beforeWords = new Set(tokenize(before).map((word) => word.toLowerCase()));
  const afterWords = new Set(tokenize(after).map((word) => word.toLowerCase()));
  const words = tokenize(mode === 'before' ? before : after);
  return words.map((word, index) => {
    const key = word.toLowerCase();
    const changed = mode === 'before' ? !afterWords.has(key) : !beforeWords.has(key);
    if (!changed || /^\s+$/.test(word)) return <React.Fragment key={`${word}-${index}`}>{word}</React.Fragment>;
    return <mark key={`${word}-${index}`} className={mode === 'before' ? 'removed' : 'added'}>{word}</mark>;
  });
}

export function BeforeAfterDiff({ before, after }) {
  return (
    <section className="before-after-diff" aria-labelledby="diff-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Diff</p>
          <h2 id="diff-heading">What changed</h2>
        </div>
      </div>
      <div className="diff-columns">
        <article>
          <h3>Original</h3>
          <p>{renderDiff(before, after, 'before')}</p>
        </article>
        <article>
          <h3>Improved version</h3>
          <p>{renderDiff(before, after, 'after')}</p>
        </article>
      </div>
    </section>
  );
}
