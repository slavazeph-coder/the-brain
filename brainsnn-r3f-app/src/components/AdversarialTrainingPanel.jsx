import React, { useState } from 'react';
import {
  getLearnedPatterns, saveLearnedPatterns, clearLearnedPatterns,
  trainFromRedTeam, evaluateWithLearned
} from '../utils/adversarialTraining';
import { runRedTeam } from '../utils/redTeam';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';

/**
 * Layer 27 — Adversarial Training Panel
 *
 * Closes the loop on Layer 25. "Train" runs the red team, mines
 * discriminative n-grams from missed attacks, adds them as learned
 * patterns, then re-evaluates. Shows before/after detection delta.
 */
export default function AdversarialTrainingPanel() {
  const [learned, setLearned] = useState(getLearnedPatterns());
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState(null);

  async function handleTrain() {
    setTraining(true);
    setResult(null);
    await new Promise((r) => setTimeout(r, 20)); // let UI update
    const baseline = runRedTeam();
    const { learned: newLearned, stats } = trainFromRedTeam(baseline);
    saveLearnedPatterns(newLearned);
    setLearned(newLearned);
    const after = evaluateWithLearned();

    const before = baseline.summary.thresholds[0.3];
    const afterT = after.summary.thresholds[0.3];
    setResult({
      stats,
      before: {
        detection: before.detectionRate,
        fpr: before.falsePositiveRate,
        f1: before.f1
      },
      after: {
        detection: afterT.detectionRate,
        fpr: afterT.falsePositiveRate,
        f1: afterT.f1
      }
    });
    setTraining(false);

    recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
      pressure: 1 - afterT.detectionRate,
      name: `Trained: +${((afterT.detectionRate - before.detectionRate) * 100).toFixed(0)}% detection`
    });
  }

  function handleClear() {
    clearLearnedPatterns();
    setLearned([]);
    setResult(null);
  }

  const detectionDelta = result
    ? (result.after.detection - result.before.detection) * 100
    : 0;
  const fprDelta = result ? (result.after.fpr - result.before.fpr) * 100 : 0;

  return (
    <section className="panel panel-pad adv-panel">
      <div className="eyebrow">Layer 27</div>
      <h2>Adversarial Training · Self-Improving Firewall</h2>
      <p className="muted">
        Closes the loop on Layer 25. Trains on missed attacks: mines
        discriminative bigrams/trigrams that appear in attacks but rarely
        in benign text. Learned patterns augment future scoring so the
        firewall gets stronger with each red team run.
      </p>

      <div className="adv-actions">
        <button className="primary" onClick={handleTrain} disabled={training}>
          {training ? 'Training…' : 'Train on red team'}
        </button>
        {learned.length > 0 && (
          <button className="ghost small" onClick={handleClear}>
            Clear learned patterns
          </button>
        )}
      </div>

      {result && (
        <div className="adv-delta-row">
          <div className="adv-delta-card">
            <small>Detection rate</small>
            <div className="adv-delta-numbers">
              <span className="adv-before">{(result.before.detection * 100).toFixed(0)}%</span>
              <span className="adv-arrow">→</span>
              <span className="adv-after">{(result.after.detection * 100).toFixed(0)}%</span>
            </div>
            <strong
              className={`adv-delta ${detectionDelta > 0 ? 'up' : detectionDelta < 0 ? 'down' : 'flat'}`}
            >
              {detectionDelta >= 0 ? '+' : ''}{detectionDelta.toFixed(1)}%
            </strong>
          </div>
          <div className="adv-delta-card">
            <small>False-positive rate</small>
            <div className="adv-delta-numbers">
              <span className="adv-before">{(result.before.fpr * 100).toFixed(0)}%</span>
              <span className="adv-arrow">→</span>
              <span className="adv-after">{(result.after.fpr * 100).toFixed(0)}%</span>
            </div>
            <strong
              className={`adv-delta ${fprDelta < 0 ? 'up' : fprDelta > 0 ? 'down' : 'flat'}`}
            >
              {fprDelta >= 0 ? '+' : ''}{fprDelta.toFixed(1)}%
            </strong>
          </div>
          <div className="adv-delta-card">
            <small>F1 score</small>
            <div className="adv-delta-numbers">
              <span className="adv-before">{result.before.f1.toFixed(2)}</span>
              <span className="adv-arrow">→</span>
              <span className="adv-after">{result.after.f1.toFixed(2)}</span>
            </div>
            <strong
              className={`adv-delta ${result.after.f1 > result.before.f1 ? 'up' : result.after.f1 < result.before.f1 ? 'down' : 'flat'}`}
            >
              {result.after.f1 > result.before.f1 ? '+' : ''}
              {(result.after.f1 - result.before.f1).toFixed(2)}
            </strong>
          </div>
        </div>
      )}

      {result?.stats && (
        <div className="adv-training-stats muted small-note">
          Trained on {result.stats.missed} missed attack{result.stats.missed === 1 ? '' : 's'} vs{' '}
          {result.stats.benign} benign samples · {result.stats.candidates} candidate n-grams ·{' '}
          {result.stats.newPatterns} new pattern{result.stats.newPatterns === 1 ? '' : 's'} added
        </div>
      )}

      <div className="adv-learned">
        <label className="muted small-note">
          Learned patterns ({learned.length}) · sorted by lift
        </label>
        {learned.length === 0 && (
          <p className="muted small-note">
            No learned patterns yet. Click "Train on red team" to mine discriminative n-grams from missed attacks.
          </p>
        )}
        <div className="adv-pattern-grid">
          {learned.slice(0, 24).map((p) => (
            <div key={p.ngram} className="adv-pattern-chip" title={`lift ${p.lift} · ${p.attackCount} in attacks / ${p.benignCount} in benign`}>
              <span className="adv-pattern-ngram">{p.ngram}</span>
              <span className="adv-pattern-lift">×{p.lift}</span>
            </div>
          ))}
          {learned.length > 24 && (
            <span className="muted small-note">+ {learned.length - 24} more</span>
          )}
        </div>
      </div>

      <p className="muted small-note">
        Lift = P(n-gram in missed attacks) / P(n-gram in benign text). Higher lift = stronger discriminator.
        Patterns persist in localStorage and augment scoring in future sessions.
      </p>
    </section>
  );
}
