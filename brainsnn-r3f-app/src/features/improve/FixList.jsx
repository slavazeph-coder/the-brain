import React from 'react';
import { Check, Undo2, Wand2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';

const CATEGORY_LABEL = {
  structure: 'Order',
  urgency: 'Pressure',
  outrage: 'Outrage',
  certainty: 'Absolute claim',
  vague: 'Vague claim',
};

/**
 * The fixes available on the current draft, each one a button that performs
 * the edit rather than describing it.
 *
 * A fix is shown as spent, not hidden, once applied: the user needs to see
 * that the thing they clicked actually happened, and needs a way back. Hiding
 * it would leave them re-reading the draft to work out whether the click
 * landed.
 */
export function FixList({ patches, appliedIds, onApply, onUndo, onApplyAll, canUndo = true }) {
  if (!patches.length) {
    return (
      <section className="fix-list" aria-labelledby="fix-list-heading">
        <div className="bsn-section-head">
          <div>
            <p className="bsn-eyebrow">One-click fixes</p>
            <h2 id="fix-list-heading">Nothing mechanical left to fix</h2>
          </div>
        </div>
        <p className="bsn-note">
          This draft has no pressure phrasing or misplaced evidence that can be corrected
          automatically. The recommendations below are the judgement calls left — they need
          a fact only you have.
        </p>
      </section>
    );
  }

  const remaining = patches.filter((patch) => !appliedIds.includes(patch.id)).length;

  return (
    <section className="fix-list" aria-labelledby="fix-list-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">One-click fixes</p>
          <h2 id="fix-list-heading">{remaining} fix{remaining === 1 ? '' : 'es'} available</h2>
        </div>
        {remaining > 0 ? (
          <Button variant="primary" size="sm" onClick={onApplyAll}>
            <Wand2 size={15} aria-hidden="true" /> Apply all
          </Button>
        ) : null}
      </div>
      <ul className="fix-items">
        {patches.map((patch) => {
          const applied = appliedIds.includes(patch.id);
          return (
            <li key={patch.id} className={applied ? 'fix-item fix-item-applied' : 'fix-item'}>
              <div className="fix-item-body">
                <span className="fix-item-tag">{CATEGORY_LABEL[patch.category] || 'Edit'}</span>
                <strong>{patch.label}</strong>
                <p>{patch.detail}</p>
              </div>
              {applied && canUndo ? (
                <Button variant="ghost" size="sm" onClick={() => onUndo(patch)} aria-label={`Undo: ${patch.label}`}>
                  <Undo2 size={15} aria-hidden="true" /> Undo
                </Button>
              ) : applied ? (
                // Once the draft has been hand-edited we can no longer rebuild
                // it from the original, so undo would have to guess. Say the
                // fix is applied and leave the text alone.
                <span className="fix-item-done"><Check size={15} aria-hidden="true" /> Applied</span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => onApply(patch)} aria-label={`Apply: ${patch.label}`}>
                  <Check size={15} aria-hidden="true" /> Apply
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
