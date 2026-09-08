import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, GitCompare, RotateCcw, Save, Send } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { EmptyState } from '../../components/ui/EmptyState.jsx';
import { track } from '../../lib/analytics.js';
import { applyPatch, applyPatches, buildPatchPlan, normalizeDraft, usablePatches } from '../../lib/draftPatch.js';
import { selectPatchesForGoal } from '../../lib/draftRewrite.js';
import { BeforeAfterDiff } from './BeforeAfterDiff.jsx';
import { FixList } from './FixList.jsx';
import { RecommendationCards } from './RecommendationCards.jsx';
import { RewriteControls } from './RewriteControls.jsx';
import { VersionComparison } from './VersionComparison.jsx';
import { analyzeRewrite } from './rewrite.js';

/**
 * The draft is derived state: original text + the ordered list of fixes the
 * user has accepted. Keeping it that way is what makes undo exact — we rebuild
 * from the source rather than trying to reverse an edit. The moment the user
 * types into the draft themselves we stop deriving (`manual`) and apply
 * further fixes directly to what they wrote, because their text is now the
 * source of truth and reconstructing it would throw their edit away.
 */
function useDraft(original) {
  const [applied, setApplied] = useState([]);
  const [manual, setManual] = useState(null);

  useEffect(() => { setApplied([]); setManual(null); }, [original]);

  const plan = useMemo(() => buildPatchPlan(original), [original]);
  const byId = useMemo(() => new Map(plan.patches.map((patch) => [patch.id, patch])), [plan]);

  const derived = useMemo(
    () => applyPatches(plan.draft, applied.map((id) => byId.get(id)).filter(Boolean)).text,
    [applied, byId, plan.draft],
  );
  const text = manual === null ? derived : manual;

  return {
    plan,
    text,
    applied,
    manual: manual !== null,
    apply(patch) {
      if (manual === null) { setApplied((ids) => [...ids, patch.id]); return; }
      const result = applyPatch(manual, patch);
      if (result.ok) { setManual(result.text); setApplied((ids) => [...ids, patch.id]); }
    },
    applyAll() {
      const pending = plan.patches.filter((patch) => !applied.includes(patch.id));
      if (manual === null) { setApplied((ids) => [...ids, ...pending.map((patch) => patch.id)]); return; }
      const run = applyPatches(manual, pending);
      setManual(run.text);
      setApplied((ids) => [...ids, ...run.outcomes.filter((outcome) => outcome.applied).map((outcome) => outcome.id)]);
    },
    undo(patch) { setApplied((ids) => ids.filter((id) => id !== patch.id)); },
    edit(value) { setManual(value); },
    reset() { setApplied([]); setManual(null); },
  };
}

export function ImprovementWorkspace({ result, onGoToCortex, onSaveVersion, onQueue, onApprove }) {
  const [goal, setGoal] = useState('trust');
  const [comparison, setComparison] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const original = useMemo(() => normalizeDraft(result?.rawContent || ''), [result?.rawContent]);
  const draft = useDraft(original);

  // The funnel this instrumentation exists for is scan_completed →
  // improve_started → fix_applied → draft_copied. This is the step that says
  // how many people who got a diagnosis came here to act on it at all.
  const reached = Boolean(result);
  const fixesOffered = draft.plan.patches.length;
  useEffect(() => {
    if (reached) track('improve_started', { fixesOffered });
  }, [reached, fixesOffered]);

  // Only offer fixes that belong to the selected goal AND still apply to the
  // draft as it stands, so a button never promises an edit that would fail.
  const offered = useMemo(() => {
    const forGoal = selectPatchesForGoal(draft.plan.patches, goal);
    const stillUsable = usablePatches(draft.text, forGoal).map((patch) => patch.id);
    return forGoal.filter((patch) => stillUsable.includes(patch.id) || draft.applied.includes(patch.id));
  }, [draft.applied, draft.plan.patches, draft.text, goal]);

  const changed = draft.text !== original;

  if (!result) {
    return (
      <div className="synapse-workspace">
        <EmptyState title="Run a Brain Scan first" actionLabel="Go to Analyze" onAction={onGoToCortex}>
          Improve needs a completed scan before it can suggest fixes and compare versions.
        </EmptyState>
      </div>
    );
  }

  function applyOne(patch) {
    draft.apply(patch);
    // Per-fix, so the funnel can say which fixes people accept and which they
    // scroll past — the question the whole analytics store exists to answer.
    track('fix_applied', { goal, kind: patch.kind, category: patch.category || 'structure' });
    setComparison(null);
    setMessage(`Applied: ${patch.label}`);
  }

  function applyEverything() {
    const pending = offered.filter((patch) => !draft.applied.includes(patch.id)).length;
    draft.applyAll();
    track('fix_applied_all', { goal, count: pending });
    setComparison(null);
    setMessage('Applied every available fix. Read it through before you send it.');
  }

  function undoOne(patch) {
    // An undo is the clearest signal a fix was wrong. Tracked separately so a
    // bad substitution shows up as a rejection rate rather than as silence.
    track('fix_undone', { goal, kind: patch.kind, category: patch.category || 'structure' });
    draft.undo(patch);
    setComparison(null);
    setMessage(`Reverted: ${patch.label}`);
  }

  function resetDraft() {
    draft.reset();
    setComparison(null);
    setMessage('Back to your original text.');
  }

  async function compare() {
    if (draft.text.trim().length < 12) return;
    setBusy('compare');
    setMessage('');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft.text, contentType: result.contentType || 'text', type: result.contentType || 'text' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.id) throw new Error(body.error || 'Comparison scan unavailable.');
      setComparison(body);
      setMessage(body.isFallback ? 'Scored with the local engine.' : 'Scored with the configured model path.');
    } catch (error) {
      setComparison(analyzeRewrite(result, draft.text));
      setMessage(`${error.message || 'Comparison service unavailable.'} Scored locally instead.`);
    } finally {
      setBusy('');
      track('version_compared', { goal });
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard?.writeText(draft.text);
      track('draft_copied', { goal, applied: draft.applied.length, edited: draft.manual });
      setMessage('Copied. This is your text only — no notes from us in it.');
    } catch {
      setMessage('Clipboard unavailable. Select the draft text manually.');
    }
  }

  return (
    <div className="synapse-workspace" data-testid="synapse-workspace">
      <header className="synapse-header">
        <p className="bsn-kicker">Improve</p>
        <h1>Fix the draft, then take it with you.</h1>
        <p>
          Each fix below edits your text where the scan found the problem. Nothing is added
          that you did not write, so the finished draft is safe to paste straight into a send field.
        </p>
      </header>

      <RewriteControls
        goal={goal}
        onGoalChange={(value) => { setGoal(value); track('rewrite_goal_selected', { goal: value }); }}
      />

      <FixList
        patches={offered}
        appliedIds={draft.applied}
        canUndo={!draft.manual}
        onApply={applyOne}
        onUndo={undoOne}
        onApplyAll={applyEverything}
      />

      <section className="rewrite-controls">
        <div className="rewrite-workbench">
          <label className="rewrite-pane">
            <span>Original</span>
            <textarea value={original} readOnly />
          </label>
          <label className="rewrite-pane">
            <span>Your draft{changed ? ` — ${draft.applied.length} fix${draft.applied.length === 1 ? '' : 'es'} applied` : ' — unchanged'}</span>
            <textarea
              value={draft.text}
              onChange={(event) => { draft.edit(event.target.value); setComparison(null); }}
            />
          </label>
        </div>
        {/* Three actions, not six. Someone sending an email in ten minutes needs
            to take the draft, check it got better, or start over. Save / approval
            / approve are a review workflow for a different person on a different
            day, so they move into a disclosure rather than competing with the
            one action this screen exists for. */}
        <div className="synapse-actions" style={{ marginTop: 14 }}>
          <Button variant="primary" onClick={copyDraft}><Clipboard size={16} aria-hidden="true" /> Copy final draft</Button>
          <Button variant="secondary" onClick={compare} disabled={busy === 'compare' || draft.text.trim().length < 12}>
            <GitCompare size={16} aria-hidden="true" /> {busy === 'compare' ? 'Scoring…' : 'Score both versions'}
          </Button>
          <Button variant="ghost" onClick={resetDraft} disabled={!changed}><RotateCcw size={16} aria-hidden="true" /> Reset</Button>
        </div>
        <details className="workflow-actions">
          <summary>Send this through review</summary>
          <div className="synapse-actions">
            <Button variant="ghost" onClick={() => onSaveVersion(result, draft.text, comparison)}><Save size={16} aria-hidden="true" /> Save as version</Button>
            <Button variant="ghost" onClick={() => onQueue(result, draft.text, comparison)}><Send size={16} aria-hidden="true" /> Mark for approval</Button>
            <Button variant="ghost" onClick={() => onApprove(result, draft.text, comparison)}><CheckCircle2 size={16} aria-hidden="true" /> Approve</Button>
          </div>
        </details>
        {message ? <p role="status" className="bsn-note synapse-message">{message}</p> : null}
      </section>

      <VersionComparison originalResult={result} revisedResult={comparison} />
      {changed ? <BeforeAfterDiff before={original} after={draft.text} /> : null}
      <RecommendationCards result={result} />
    </div>
  );
}
