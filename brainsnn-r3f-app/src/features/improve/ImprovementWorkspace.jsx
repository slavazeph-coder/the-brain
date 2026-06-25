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
  const [changes, setChanges] = useState([
    'Reframed the message around a reader outcome.',
    'Softened pressure language where it was unsupported.',
    'Added a prompt to include proof before the ask.',
  ]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (result && !rewrite) setRewrite(createRewrite(result.rawContent, goal));
  }, [goal, result, rewrite]);

  const original = result?.rawContent || '';
  const canCompare = useMemo(() => rewrite.trim().length >= 12 && busy !== 'compare', [busy, rewrite]);

  if (!result) {
    return (
      <div className="synapse-workspace">
        <EmptyState title="Run a Brain Scan first" actionLabel="Go to Cortex" onAction={onGoToCortex}>
          Synapse needs a completed scan before it can generate rewrites and compare versions.
        </EmptyState>
      </div>
    );
  }

  async function generate() {
    track('rewrite_goal_selected', { goal });
    track('improve_started', { goal });
    setBusy('generate');
    setMessage('');
    try {
      const response = await fetch('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: original, goal }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.content) throw new Error(body.error || 'Rewrite layer stack unavailable.');
      setRewrite(body.content);
      setChanges(Array.isArray(body.changes) && body.changes.length ? body.changes : changes);
      setComparison(body.comparison || null);
      setMessage('Rewrite generated through the BrainSNN layer stack.');
    } catch (error) {
      setRewrite(createRewrite(original, goal));
      setComparison(null);
      setMessage(`${error.message || 'Rewrite service unavailable.'} Local rewrite rules were used instead.`);
    } finally {
      setBusy('');
    }
  }

  async function compare() {
    if (!canCompare) return;
    setBusy('compare');
    setMessage('');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: rewrite, contentType: result.contentType || 'text', type: result.contentType || 'text' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) throw new Error(body.error || 'Comparison scan unavailable.');
      setComparison(body);
      setMessage(body.isFallback ? 'Comparison completed with the demo model layer stack.' : 'Comparison completed with the configured model path.');
    } catch (error) {
      const revised = analyzeRewrite(result, rewrite);
      setComparison(revised);
      setMessage(`${error.message || 'Comparison service unavailable.'} Local comparison was used instead.`);
    } finally {
      setBusy('');
      track('version_compared', { goal });
    }
  }

  async function copyRewrite() {
    try {
      await navigator.clipboard?.writeText(rewrite);
      setMessage('Improved version copied.');
    } catch {
      setMessage('Clipboard unavailable. Select the improved version text manually.');
    }
  }

  return (
    <div className="synapse-workspace" data-testid="synapse-workspace">
      <header className="synapse-header">
        <p className="bsn-kicker">Synapse</p>
        <h1>Turn the diagnosis into a better draft.</h1>
        <p>Edit the rewrite, compare versions, then save, approve or export only when the scores move in the right direction.</p>
      </header>
      <RewriteControls goal={goal} onGoalChange={(value) => { setGoal(value); track('rewrite_goal_selected', { goal: value }); }} onGenerate={generate} generating={busy === 'generate'} />
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
          <Button variant="primary" onClick={compare} disabled={!canCompare}><GitCompare size={16} aria-hidden="true" /> {busy === 'compare' ? 'Comparing...' : 'Run comparison'}</Button>
          <Button variant="secondary" onClick={copyRewrite}><Clipboard size={16} aria-hidden="true" /> Copy improved version</Button>
          <Button variant="ghost" onClick={() => onSaveVersion(result, rewrite, comparison)}><Save size={16} aria-hidden="true" /> Save as version</Button>
          <Button variant="ghost" onClick={() => onQueue(result, rewrite, comparison)}><Send size={16} aria-hidden="true" /> Mark for approval</Button>
          <Button variant="ghost" onClick={() => onApprove(result, rewrite, comparison)}><CheckCircle2 size={16} aria-hidden="true" /> Approve</Button>
        </div>
        {message ? <p role="status" className="bsn-note synapse-message">{message}</p> : null}
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
