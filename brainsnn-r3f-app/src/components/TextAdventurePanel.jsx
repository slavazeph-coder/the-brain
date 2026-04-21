import React, { useState } from 'react';
import {
  SCENARIOS, startRun, chooseOption, currentNode, runSummary,
} from '../utils/textAdventure';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';

/**
 * Layer 73 — Text Adventure Training panel.
 */
export default function TextAdventurePanel() {
  const [run, setRun] = useState(null);
  const [recorded, setRecorded] = useState(false);

  const node = run ? currentNode(run) : null;
  const summary = run ? runSummary(run) : null;

  function start(scenarioId) {
    setRun(startRun(scenarioId));
    setRecorded(false);
  }
  function choose(i) {
    const next = chooseOption(run, i);
    setRun(next);
    const cNode = currentNode(next);
    if (cNode?.terminal && !recorded) {
      setRecorded(true);
      try {
        recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
          pressure: Math.max(0, 0.5 - next.score * 0.15),
          confidence: 'training',
        });
      } catch { /* noop */ }
    }
  }
  function restart() { setRun(null); setRecorded(false); }

  return (
    <section className="panel panel-pad text-adventure-panel">
      <div className="eyebrow">Layer 73 · text adventure training</div>
      <h2>Choose your reply</h2>
      <p className="muted">
        Short branching scenarios where you reply to manipulation tactics.
        Each choice moves the score up (resilient) or down (hooked). Finish
        to see your verdict — and walk away with specific lines to try next
        time.
      </p>

      {!run && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className="btn"
              onClick={() => start(s.id)}
              style={{ textAlign: 'left', padding: '10px 14px' }}
            >
              <strong>{s.title}</strong>
              <span className="muted small-note" style={{ marginLeft: 8 }}>
                {Object.keys(s.nodes).length - 2} choice nodes
              </span>
            </button>
          ))}
        </div>
      )}

      {run && node && !node.terminal && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              borderLeft: '3px solid #dd6974',
              background: 'rgba(221,105,116,0.06)',
            }}
          >
            <div className="muted small-note" style={{ marginBottom: 4 }}>from <strong>{node.from}</strong></div>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5 }}>{node.text}</p>
          </div>
          <div style={{ marginTop: 10 }}>
            {node.choices.map((c, i) => (
              <button
                key={i}
                className="btn"
                onClick={() => choose(i)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  marginTop: 6,
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="muted small-note" style={{ marginTop: 8 }}>
            Score: <strong>{run.score}</strong> · path length {run.path.length}
          </p>
        </div>
      )}

      {run && node?.terminal && (
        <div style={{ marginTop: 12 }}>
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 8,
              borderLeft: `3px solid ${summary.verdict.color}`,
              background: `${summary.verdict.color}14`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <strong>{node.win ? 'Resilient outcome' : 'Hooked outcome'}</strong>
              <strong style={{ color: summary.verdict.color }}>
                {summary.verdict.label} · score {run.score}
              </strong>
            </div>
            <p style={{ marginTop: 6, marginBottom: 0 }}>{node.text}</p>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="eyebrow">Move-by-move feedback</div>
            {run.feedbacks.map((f, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 12px',
                  borderLeft: '3px solid #5ad4ff',
                  background: 'rgba(90,212,255,0.04)',
                  borderRadius: 6,
                  marginTop: 6,
                }}
              >
                <strong>{f.label}</strong>
                <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{f.feedback}</p>
              </div>
            ))}
          </div>

          <div className="control-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={restart}>Try another</button>
          </div>
        </div>
      )}
    </section>
  );
}
