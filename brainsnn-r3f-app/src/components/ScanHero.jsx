import React, { useState, useEffect, useRef } from "react";
import { analyzeForBrain, activeBackendLabel } from "../utils/brainLLM";

// Each dimension names the brain region the scan drives (see mapTRIBEToRegions)
// so the result panel visibly connects to the 3D brain reacting above it.
const SCORES = [
  {
    key: "manipulationPressure",
    label: "Manipulation",
    accent: "var(--danger)",
    region: "basal ganglia ↑",
  },
  {
    key: "emotionalActivation",
    label: "Emotional",
    accent: "var(--gold)",
    region: "amygdala + thalamus ↑",
  },
  {
    key: "cognitiveSuppression",
    label: "Cognitive load",
    accent: "var(--primary)",
    region: "prefrontal cortex ↓",
  },
  {
    key: "trustErosion",
    label: "Trust erosion",
    accent: "#5591c7",
    region: "network-wide",
  },
];

// Per-category colour for the "why this score" breakdown — coercion + outrage
// read as red (trust attack), fear as gold, urgency/certainty as teal.
const SIGNAL_ACCENT = {
  coercion: "var(--danger)",
  outrage: "var(--danger)",
  fear: "var(--gold)",
  urgency: "var(--primary)",
  certainty: "var(--primary)",
};

const VERDICT = {
  High: { key: "high", label: "High manipulation risk" },
  Moderate: { key: "moderate", label: "Moderate pressure" },
  Low: { key: "low", label: "Low risk" },
};

const PLACEHOLDER = "Paste a headline, email, or post here…";

/**
 * The main-page centerpiece. Sends content through the swappable backend LLM
 * (analyzeForBrain) and hands the score to App, which maps it onto the 3D brain.
 */
export default function ScanHero({ onResult, seed }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [flash, setFlash] = useState(false);
  const resultRef = useRef(null);
  const pendingScrollRef = useRef(false);
  const backend = activeBackendLabel();

  // Adopt an externally-seeded scan (e.g. a tapped demo tile): fill the
  // textarea so it's transparent + editable, show the full scorecard, flash it,
  // and flag that we want to scroll to it once it's committed.
  useEffect(() => {
    if (!seed) return;
    setText(seed.text || "");
    setResult(seed.result || null);
    setFlash(true);
    pendingScrollRef.current = true;
    const unflash = setTimeout(() => setFlash(false), 1200);
    return () => clearTimeout(unflash);
    // Re-fire on every tap (nonce changes) even for the same tile.
  }, [seed?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll only AFTER the result has committed (this effect runs post-render,
  // so resultRef is attached — rAF/timeouts race React's commit under the heavy
  // 3D thread). Instant, not smooth: smooth animation stalls the WebGL loop.
  useEffect(() => {
    if (result && pendingScrollRef.current) {
      pendingScrollRef.current = false;
      resultRef.current?.scrollIntoView({
        behavior: "instant",
        block: "center",
      });
    }
  }, [result]);

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
          <div className="eyebrow">Feel what you read</div>
          <h2>See the hidden feelings in anything you read</h2>
          <p className="scan-subcopy">
            Paste a headline, email, or post — BrainSNN shows you the emotional
            pull behind the words, live.
          </p>
        </div>
        <span className="scan-backend" title="Active analysis backend">
          ● {backend}
        </span>
      </div>

      {!result && (
        <div className="scan-steps" aria-hidden="true">
          <span className="scan-step">
            <b>1</b> Paste
          </span>
          <span className="scan-step-arrow">→</span>
          <span className="scan-step">
            <b>2</b> Analyze
          </span>
          <span className="scan-step-arrow">→</span>
          <span className="scan-step">
            <b>3</b> Watch the brain react
          </span>
        </div>
      )}

      <textarea
        className="scan-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={PLACEHOLDER}
        aria-label="Content to analyze for emotional payload"
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

      {result &&
        (() => {
          const action = result.recommendedAction || "";
          const level = VERDICT[action.split(" ")[0]] || VERDICT.Low;
          const signals = Array.isArray(result.signals) ? result.signals : [];
          return (
            <div
              className={`scan-result${flash ? " scan-result-flash" : ""}`}
              ref={resultRef}
            >
              <div className={`scan-verdict scan-verdict-${level.key}`}>
                <span className="scan-verdict-dot" aria-hidden="true" />
                <div className="scan-verdict-text">
                  <strong>{level.label}</strong>
                  <span>{action}</span>
                </div>
              </div>

              <div className="scan-scores">
                {SCORES.map(({ key, label, accent, region }) => {
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
                      <span className="scan-score-region">{region}</span>
                    </div>
                  );
                })}
              </div>

              {signals.length > 0 && (
                <div className="scan-why">
                  <div className="scan-why-head">
                    Why this score
                    <span>the exact phrases that fired</span>
                  </div>
                  <div className="scan-signals">
                    {signals.map((s) => (
                      <div className="scan-signal" key={s.category}>
                        <div className="scan-signal-top">
                          <span
                            className="scan-signal-label"
                            style={{
                              color: SIGNAL_ACCENT[s.category] || "var(--text)",
                            }}
                          >
                            <span
                              className="scan-signal-dot"
                              style={{
                                background:
                                  SIGNAL_ACCENT[s.category] || "var(--muted)",
                              }}
                            />
                            {s.label}
                          </span>
                          <span className="scan-signal-count">{s.count}×</span>
                        </div>
                        <div className="scan-signal-phrases">
                          {s.phrases.map((p, i) => (
                            <span className="scan-phrase" key={i}>
                              “{p}”
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.confidenceReason && (
                <p className="scan-confidence">
                  <strong>Confidence: {result.confidence}</strong> —{" "}
                  {result.confidenceReason}
                </p>
              )}

              <div className="scan-meta">
                <span className="scan-tag">
                  engine: {result.source || "regex"}
                </span>
                <span className="scan-tag scan-tag-brain">
                  ↳ now driving the brain above
                </span>
              </div>
            </div>
          );
        })()}
    </section>
  );
}
