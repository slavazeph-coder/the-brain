import React from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.jsx';
import { REWRITE_GOALS } from './rewrite.js';

export function RewriteControls({ goal, onGoalChange, onGenerate, generating = false }) {
  return (
    <section className="rewrite-controls" aria-labelledby="rewrite-controls-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Rewrite goal</p>
          <h2 id="rewrite-controls-heading">What should this pass fix?</h2>
        </div>
        {/* The fixes below apply live, so there is nothing to "generate" when
            no handler is supplied. Rendering a dead button would imply the
            draft is waiting on a step the user has not taken. */}
        {onGenerate ? (
          <Button variant="primary" onClick={onGenerate} disabled={generating}><Wand2 size={16} aria-hidden="true" /> {generating ? 'Generating...' : 'Generate rewrite'}</Button>
        ) : null}
      </div>
      <SegmentedControl
        label=""
        value={goal}
        onChange={onGoalChange}
        options={REWRITE_GOALS.map((item) => ({ value: item.id, label: item.label }))}
      />
      <p className="bsn-note">{REWRITE_GOALS.find((item) => item.id === goal)?.description}</p>
    </section>
  );
}
