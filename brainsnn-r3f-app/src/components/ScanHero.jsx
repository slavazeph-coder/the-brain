import React, { useState } from "react";
import { analyzeForBrain, activeBackendLabel } from "../utils/brainLLM";

const SCORES = [
  {
    key: "manipulationPressure",
    label: "Manipulation",
    accent: "var(--danger)",
  },
  { key: "emotionalActivation", label: "Emotional", accent: "var(--gold)" },
  {
    key: "cognitiveSuppression",
    label: "Cognitive load",
    accent: "var(--primary)",
  },
  { key: "trustErosion", label: "Trust erosion", accent: "var(--danger)" },
];

const PLACEHOLDER =
  "Paste a headline, email, post, or message — the brain reads its emotional payload and reacts in real time.";

/**
 * The main-page centerpiece. Sends content through the swappable backend LLM
 * (analyzeForBrain) and hands the score to App, which maps it onto the 3D brain.
 */
export default function ScanHero({ onResult }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const backend = activeBackendLabel();

  const run = async () => {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const score = await analyzeForBrain(content);
      setResult(score);
      onResult?.(score, content);
    } catch (_err) {
      // analyzeForBrain never throws, but guard anyway.
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
  };

  return (
    <section className="panel panel-pad scan-hero">
      <div className="scan-hero-head">
        <div>
          <div className="eyebrow">Affective scan</div>
          <h2>Read the emotional payload of any content</h2>
        </div>
        <span className="scan-backend" title="Active analysis backend">
          ● {backend}
        </span>
      </div>

      <textarea
        className="scan-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={PLACEHOLDER}
        rows={4}
      />

      <div className="scan-actions">
        <button
          className="btn primary"
          onClick={run}
          disabled={busy || !text.trim()}
        >
          {busy ? "Analyzing…" : "Analyze → watch the brain react"}
        </button>
        <span className="scan-hint">⌘/Ctrl + Enter</span>
        {text && (
          <button
            className="btn"
            onClick={() => {
              setText("");
              setResult(null);
            }}
            disabled={busy}
          >
            Clear
          </button>
        )}
      </div>

      {result && (
        <div className="scan-result">
          <div className="scan-scores">
            {SCORES.map(({ key, label, accent }) => {
              const pct = Math.round((result[key] || 0) * 100);
              return (
                <div className="scan-score" key={key}>
                  <div className="scan-score-top">
                    <span>{label}</span>
                    <strong>{pct}%</strong>
                  </div>
                  <div className="scan-bar">
                    <div
                      className="scan-bar-fill"
                      style={{ width: `${pct}%`, background: accent }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {result.recommendedAction && (
            <p className="scan-action">
              <strong>Read:</strong> {result.recommendedAction}
            </p>
          )}

          <div className="scan-meta">
            <span className="scan-tag">engine: {result.source || "regex"}</span>
            {result.confidence && (
              <span className="scan-tag">confidence: {result.confidence}</span>
            )}
            {Array.isArray(result.evidence) && result.evidence.length > 0 && (
              <span className="scan-tag">{result.evidence.length} signals</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
