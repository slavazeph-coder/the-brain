import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, GitCompare, Save, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { track } from '../../lib/analytics.js';
import { BeforeAfterDiff } from './BeforeAfterDiff.jsx';
import { RecommendationCards } from './RecommendationCards.jsx';
import { RewriteControls } from './RewriteControls.jsx';
import { VersionComparison } from './VersionComparison.jsx';
import { analyzeRewrite, createRewrite } from './rewrite.js';

export function ImprovementWorkspace({ result, onGoToCortex, onSaveVersion, onQueue, onApprove }) {
  const [goal, setGoal] = useState('trust');
  const [rewrite, setRewrite] = useState('');
  const [comparison, setComparison] = useState(null);

  useEffect(() => {
    if (result && !rewrite) setRewrite(createRewrite(result.rawContent, goal));
  }, [goal, result, rewrite]);

  const original = result?.rawContent || '';
  const changes = useMemo(() => [
    'Reframed the message around a reader outcome.',
    'Softened pressure language where it was unsupported.',
    'Added a prompt to include proof before the ask.',
  ], []);

  if (!result) {
    return (
      <div className="synapse-workspace">
        <EmptyState title="Run a Brain Scan first" actionLabel="Go to Cortex" onAction={onGoToCortex}>
          Synapse needs a completed scan before it can generate rewrites and compare versions.
        </EmptyState>
      </div>
    );
  }

  function generate() {
    track('rewrite_goal_selected', { goal });
    track('improve_started', { goal });
    setRewrite(createRewrite(original, goal));
    setComparison(null);
  }

  function compare() {
    const revised = analyzeRewrite(result, rewrite);
    setComparison(revised);
    track('version_compared', { goal });
  }

  async function copyRewrite() {
    await navigator.clipboard?.writeText(rewrite);
  }

  return (
    <div className="synapse-workspace" data-testid="synapse-workspace">
      <header className="synapse-header">
        <p className="bsn-kicker">Synapse</p>
        <h1>Turn the diagnosis into a better draft.</h1>
        <p>Edit the rewrite, compare versions, then save, approve or export only when the scores move in the right direction.</p>
      </header>
      <RewriteControls goal={goal} onGoalChange={(value) => { setGoal(value); track('rewrite_goal_selected', { goal: value }); }} onGenerate={generate} />
      <section className="rewrite-controls">
        <div className="rewrite-workbench">
          <label className="rewrite-pane">
            <span>Original</span>
            <textarea value={original} readOnly />
          </label>
          <label className="rewrite-pane">
            <span>Improved version</span>
            <textarea value={rewrite} onChange={(event) => { setRewrite(event.target.value); setComparison(null); }} />
          </label>
        </div>
        <div className="synapse-actions" style={{ marginTop: 14 }}>
          <Button variant="primary" onClick={compare}><GitCompare size={16} aria-hidden="true" /> Run comparison</Button>
          <Button variant="secondary" onClick={copyRewrite}><Clipboard size={16} aria-hidden="true" /> Copy improved version</Button>
          <Button variant="ghost" onClick={() => onSaveVersion(result, rewrite, comparison)}><Save size={16} aria-hidden="true" /> Save as version</Button>
          <Button variant="ghost" onClick={() => onQueue(result, rewrite, comparison)}><Send size={16} aria-hidden="true" /> Mark for approval</Button>
          <Button variant="ghost" onClick={() => onApprove(result, rewrite, comparison)}><CheckCircle2 size={16} aria-hidden="true" /> Approve</Button>
        </div>
        <div className="recommendation-list">
          {changes.map((change) => <article key={change}><span>Change made</span><p>{change}</p></article>)}
        </div>
      </section>
      <VersionComparison originalResult={result} revisedResult={comparison} />
      <BeforeAfterDiff before={original} after={rewrite} />
      <RecommendationCards result={result} />
    </div>
  );
}
