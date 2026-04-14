import React, { useState } from 'react';
import { parseTranscript, analyzeConversation, classifyConversationDrift } from '../utils/conversation';

/**
 * Layer 22 — Conversation Brain Panel
 *
 * Paste a multi-turn transcript. Each turn runs through the Cognitive
 * Firewall and updates a simulated brain state. Shows per-turn scores,
 * a pressure timeline, peak turn, and final brain drift.
 */
export default function ConversationBrainPanel({ onApplyFinalState }) {
  const [raw, setRaw] = useState(EXAMPLE_TRANSCRIPT);
  const [analysis, setAnalysis] = useState(null);
  const [selectedTurn, setSelectedTurn] = useState(null);

  function analyze() {
    const turns = parseTranscript(raw);
    if (!turns.length) {
      setAnalysis({ error: 'No turns detected. Use "Speaker: message" or JSON format.' });
      return;
    }
    const result = analyzeConversation(turns);
    setAnalysis({ ...result, drift: classifyConversationDrift(result.summary) });
    setSelectedTurn(result.summary.peakTurn);
  }

  function applyFinalState() {
    if (!analysis?.summary?.finalRegions) return;
    onApplyFinalState?.({
      regions: analysis.summary.finalRegions,
      scenario: `Conversation · ${analysis.summary.totalTurns} turns · drift ${analysis.drift.level}`,
      pressureAvg: analysis.summary.averagePressure,
      turns: analysis.summary.totalTurns
    });
  }

  return (
    <section className="panel panel-pad convo-panel">
      <div className="eyebrow">Layer 22</div>
      <h2>Conversation Brain</h2>
      <p className="muted">
        Paste a chat transcript. Each turn runs through the Cognitive Firewall and drifts
        the simulated brain. See cognitive pressure over turns, peak manipulation point,
        and cumulative state drift.
      </p>

      <textarea
        className="convo-input"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        placeholder='user: your message\nassistant: the reply\n...'
      />

      <div className="convo-actions">
        <button className="primary" onClick={analyze}>Analyze conversation</button>
        {analysis?.summary?.finalRegions && (
          <button className="ghost" onClick={applyFinalState}>
            Apply final state to brain
          </button>
        )}
      </div>

      {analysis?.error && <p className="muted small-note">{analysis.error}</p>}

      {analysis?.timeline && (
        <>
          <div className="convo-summary-row">
            <div className="metric">
              <small>Turns</small>
              <strong>{analysis.summary.totalTurns}</strong>
            </div>
            <div className="metric">
              <small>Avg pressure</small>
              <strong>{(analysis.summary.averagePressure * 100).toFixed(0)}%</strong>
            </div>
            <div className="metric">
              <small>Peak turn</small>
              <strong>#{analysis.summary.peakTurn}</strong>
            </div>
            <div className="metric">
              <small>Drift</small>
              <strong className={`convo-drift-${analysis.drift.level}`}>
                {analysis.drift.level}
              </strong>
            </div>
          </div>

          <div className="convo-driftlabel muted small-note">
            {analysis.drift.label}
          </div>

          <div className="convo-timeline">
            <label className="muted small-note">Manipulation pressure over turns</label>
            <div className="convo-bars">
              {analysis.timeline.map((t, i) => {
                const p = t.scores?.manipulationPressure ?? 0;
                const isPeak = i === analysis.summary.peakTurn;
                const isSelected = i === selectedTurn;
                return (
                  <button
                    key={i}
                    className={`convo-bar ${isPeak ? 'peak' : ''} ${isSelected ? 'selected' : ''}`}
                    style={{ height: `${Math.max(4, p * 60 + 4)}px` }}
                    onClick={() => setSelectedTurn(i)}
                    aria-label={`Turn ${i} (${t.speaker}): ${(p * 100).toFixed(0)}% pressure`}
                    title={`Turn ${i} — ${t.speaker}: ${(p * 100).toFixed(0)}% pressure`}
                  />
                );
              })}
            </div>
          </div>

          {selectedTurn !== null && analysis.timeline[selectedTurn] && (
            <div className="convo-turn-detail">
              <div className="convo-turn-head">
                <strong>Turn #{selectedTurn} · {analysis.timeline[selectedTurn].speaker}</strong>
              </div>
              <blockquote className="convo-turn-text">
                {analysis.timeline[selectedTurn].text}
              </blockquote>
              {analysis.timeline[selectedTurn].scores ? (
                <div className="convo-turn-scores">
                  <span>Pressure {(analysis.timeline[selectedTurn].scores.manipulationPressure * 100).toFixed(0)}%</span>
                  <span>Emotional {(analysis.timeline[selectedTurn].scores.emotionalActivation * 100).toFixed(0)}%</span>
                  <span>Suppression {(analysis.timeline[selectedTurn].scores.cognitiveSuppression * 100).toFixed(0)}%</span>
                  <span>Trust erosion {(analysis.timeline[selectedTurn].scores.trustErosion * 100).toFixed(0)}%</span>
                </div>
              ) : (
                <p className="muted small-note">Turn too short to score.</p>
              )}
            </div>
          )}

          <div className="convo-drift-detail">
            <label className="muted small-note">Final region drift vs. baseline:</label>
            <div className="convo-drift-grid">
              {Object.entries(analysis.summary.drift).map(([region, delta]) => (
                <div key={region} className="convo-drift-row">
                  <span className="convo-drift-region">{region}</span>
                  <span className={`convo-drift-value ${delta > 0 ? 'up' : 'down'}`}>
                    {delta > 0 ? '+' : ''}{(delta * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const EXAMPLE_TRANSCRIPT = `user: Hey, can you help me understand this new policy?
assistant: Of course. What specifically would you like to know?
user: Everyone is saying it's a scandal and they don't want you to know the truth!
assistant: Let's look at the actual policy text together rather than rumors.
user: There's no time — we need to act NOW before it's too late!!! This is a CRISIS.
assistant: Take a breath. We have time to read the document and think carefully.
user: Okay, you're right. Let me share the link and we can review it.`;
