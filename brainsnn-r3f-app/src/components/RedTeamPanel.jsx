import React, { useState } from 'react';
import { runRedTeam, verdict, corpusSize, ATTACK_CATEGORIES } from '../utils/redTeam';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';

/**
 * Layer 25 — Red Team Simulator Panel
 *
 * Runs a synthetic attack corpus through the Cognitive Firewall and
 * reports detection rate + false-positive rate at 3 thresholds. Shows
 * a grade verdict, per-category matrix, and the top missed attacks +
 * false positives so the firewall can be debugged.
 */
export default function RedTeamPanel() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState(null);
  const [selectedThreshold, setSelectedThreshold] = useState(0.3);

  const total = corpusSize();

  async function runAll() {
    setRunning(true);
    setReport(null);
    setProgress(0);
    // Yield to the browser so the button re-renders before the sync work
    await new Promise((r) => setTimeout(r, 20));
    const result = runRedTeam({
      onProgress: (done) => setProgress(done)
    });
    setReport(result);
    setRunning(false);
    setProgress(total);

    // Record immunity — strong awareness event if detection is solid
    const main = result.summary.thresholds[0.3];
    recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
      pressure: 1 - (main?.detectionRate ?? 0.5),
      name: `Red team: ${total} samples · DR ${(main?.detectionRate * 100).toFixed(0)}%`
    });
  }

  const t = selectedThreshold;
  const summary = report?.summary?.thresholds?.[t];
  const v = report ? verdict(report.summary) : null;

  // Gather missed attacks + false positives at the selected threshold
  const missed = report
    ? report.perAttack
        .filter((a) => a.isAttack && a.pressure <= t)
        .sort((a, b) => a.pressure - b.pressure)
        .slice(0, 5)
    : [];
  const falsePos = report
    ? report.perAttack
        .filter((a) => !a.isAttack && a.pressure > t)
        .sort((a, b) => b.pressure - a.pressure)
        .slice(0, 5)
    : [];

  return (
    <section className="panel panel-pad redteam-panel">
      <div className="eyebrow">Layer 25</div>
      <h2>Red Team · Firewall Stress Test</h2>
      <p className="muted">
        Synthetic attack corpus ({total} samples across 5 manipulation categories +
        benign controls) runs through the Cognitive Firewall. Measures detection
        rate + false-positive rate at multiple thresholds. Final grade shows
        whether the firewall actually works.
      </p>

      <div className="redteam-actions">
        <button className="primary" onClick={runAll} disabled={running}>
          {running ? `Running… ${progress}/${total}` : `Run red team (${total} samples)`}
        </button>
        {report && (
          <div className="redteam-threshold-picker">
            <label className="muted small-note">Threshold:</label>
            {report.summary.thresholds && Object.keys(report.summary.thresholds).map((key) => (
              <button
                key={key}
                className={`ghost small ${Number(key) === t ? 'active' : ''}`}
                onClick={() => setSelectedThreshold(Number(key))}
              >
                {key}
              </button>
            ))}
          </div>
        )}
      </div>

      {report && v && (
        <>
          <div className="redteam-verdict" style={{ borderColor: v.color }}>
            <div className="redteam-grade" style={{ background: v.color }}>
              {v.grade}
            </div>
            <div className="redteam-verdict-body">
              <strong>{v.text}</strong>
              <div className="muted small-note">
                Grade computed at threshold 0.3 (detection rate + FPR)
              </div>
            </div>
          </div>

          <div className="redteam-summary-row">
            <div className="metric">
              <small>Detection rate</small>
              <strong>{(summary.detectionRate * 100).toFixed(0)}%</strong>
            </div>
            <div className="metric">
              <small>False-positive rate</small>
              <strong>{(summary.falsePositiveRate * 100).toFixed(0)}%</strong>
            </div>
            <div className="metric">
              <small>F1 score</small>
              <strong>{summary.f1.toFixed(2)}</strong>
            </div>
            <div className="metric">
              <small>TP / FN / FP / TN</small>
              <strong style={{ fontSize: '0.9em' }}>
                {summary.truePositive} / {summary.falseNegative} / {summary.falsePositive} / {summary.trueNegative}
              </strong>
            </div>
          </div>

          <div className="redteam-matrix">
            <label className="muted small-note">Per-category detection @ threshold {t}</label>
            <div className="redteam-matrix-grid">
              {ATTACK_CATEGORIES.map((cat) => {
                const c = report.perCategory[cat];
                const det = c.detection[t];
                const rate = det.rate;
                const isBenign = cat === 'benign';
                // For benign we want LOW detection; color based on that
                const good = isBenign ? rate <= 0.2 : rate >= 0.7;
                const mid = isBenign ? rate <= 0.4 : rate >= 0.4;
                const color = good ? '#7dd87f' : mid ? '#f5c888' : '#ff8090';
                return (
                  <div key={cat} className="redteam-cat-row">
                    <span className="redteam-cat-name">{cat}</span>
                    <span className="redteam-cat-count muted small-note">
                      {det.count}/{c.samples}
                    </span>
                    <div className="redteam-cat-bar">
                      <div
                        className="redteam-cat-fill"
                        style={{ width: `${rate * 100}%`, background: color }}
                      />
                    </div>
                    <span className="redteam-cat-val" style={{ color }}>
                      {(rate * 100).toFixed(0)}%
                    </span>
                    <span className="redteam-cat-avg muted small-note">
                      avg {(c.avgPressure * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="redteam-failures">
            <div className="redteam-failure-col">
              <label className="muted small-note">
                Missed attacks (false negatives, lowest pressure)
              </label>
              {missed.length === 0 && (
                <p className="muted small-note">None — firewall caught every attack.</p>
              )}
              {missed.map((m, i) => (
                <div key={i} className="redteam-failure-row">
                  <span className={`redteam-tag tag-${m.category}`}>{m.category}</span>
                  <span className="redteam-pressure">
                    {(m.pressure * 100).toFixed(0)}%
                  </span>
                  <span className="redteam-text muted small-note">
                    {m.text.slice(0, 70)}
                    {m.text.length > 70 ? '…' : ''}
                  </span>
                </div>
              ))}
            </div>

            <div className="redteam-failure-col">
              <label className="muted small-note">
                False positives (benign flagged as attack)
              </label>
              {falsePos.length === 0 && (
                <p className="muted small-note">None — all benign text passed.</p>
              )}
              {falsePos.map((m, i) => (
                <div key={i} className="redteam-failure-row">
                  <span className="redteam-tag tag-benign">benign</span>
                  <span className="redteam-pressure">
                    {(m.pressure * 100).toFixed(0)}%
                  </span>
                  <span className="redteam-text muted small-note">
                    {m.text.slice(0, 70)}
                    {m.text.length > 70 ? '…' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <p className="muted small-note">
            Thresholds tested: {Object.keys(report.summary.thresholds).join(', ')}.
            Lower = more sensitive (more detections + more false positives).
          </p>
        </>
      )}
    </section>
  );
}
