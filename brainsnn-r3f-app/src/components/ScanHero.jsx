import React, { useState, useEffect, useRef } from "react";
import { analyzeForBrain, activeBackendLabel } from "../utils/brainLLM";

import { flashPanel } from "../utils/panelNav";

// Each dimension names the brain region the scan drives (see mapTRIBEToRegions)
// so the result panel visibly connects to the 3D brain reacting above it.
const SCORES = [
  {
    key: "manipulationPressure",
    label: "Manipulation",
    accent: "var(--danger)",
    region: "basal ganglia ↑",
    regionId: "BG",
  },
  {
    key: "emotionalActivation",
    label: "Emotional",
    accent: "var(--gold)",
    region: "amygdala + thalamus ↑",
    regionId: "AMY",
  },
  {
    key: "cognitiveSuppression",
    label: "Cognitive load",
    accent: "var(--primary)",
    region: "prefrontal cortex ↓",
    regionId: "PFC",
  },
  {
    key: "trustErosion",
    label: "Trust erosion",
    accent: "#5591c7",
    region: "network-wide",
    regionId: null,
  },
];

// Per-category colour for the "why this score" breakdown — coercion + outrage
// read as red (trust attack), fear as gold, urgency/certainty as teal.
const SIGNAL_ACCENT = {
  coercion: "var(--danger)",
  scarcity: "var(--gold)",
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

const PLACEHOLDER = "Paste a link, or a headline, email, or post here…";

// Keep provenance titles to a glanceable length.
const truncate = (s, n = 70) =>
  s && s.length > n ? `${s.slice(0, n - 1)}…` : s || "";

/**
 * The main-page centerpiece. Sends content through the swappable backend LLM
 * (analyzeForBrain) and hands the score to App, which maps it onto the 3D brain.
 */
export default function ScanHero({ onResult, seed, onSelectRegion }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(null); // { phase: "reading"|"scoring", domain? }
  const [result, setResult] = useState(null);
  const [fetchErr, setFetchErr] = useState(null); // { domain, message }
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
    setFetchErr(null);
    setStage(null);
    try {
      const score = await analyzeForBrain(content, { onStage: setStage });
      if (score.source === "url_error") {
        // Link couldn't be read — show a helpful message, not a fake score.
        setResult(null);
        setFetchErr({
          domain: score.fetchedFrom?.domain,
          message: score.fetchError,
        });
        return;
      }
      setResult(score);
      // Score the page text (not the URL) so the brain + share reflect content.
      onResult?.(score, score.scannedText || content);
    } catch (_err) {
      // analyzeForBrain never throws, but guard anyway.
    } finally {
      setBusy(false);
      setStage(null);
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
            Paste a link or any text — BrainSNN reads the page and shows you the
            emotional pull behind the words, live.
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
        onChange={(e) => {
          setText(e.target.value);
          if (fetchErr) setFetchErr(null);
        }}
        onKeyDown={onKeyDown}
        placeholder={PLACEHOLDER}
        aria-label="Link or content to analyze for emotional payload"
        rows={4}
      />

      <div className="scan-actions">
        <button
          className="btn primary"
          onClick={run}
          disabled={busy || !text.trim()}
        >
          {busy
            ? stage?.phase === "reading"
              ? `Reading ${stage.domain || "the link"}…`
              : "Analyzing…"
            : "Analyze → watch the brain react"}
        </button>
        <span className="scan-hint">⌘/Ctrl + Enter</span>
        {text && (
          <button
            className="btn"
            onClick={() => {
              setText("");
              setResult(null);
              setFetchErr(null);
            }}
            disabled={busy}
          >
            Clear
          </button>
        )}
      </div>

      {fetchErr && !result && (
        <div className="scan-fetch-error" role="status">
          <strong>Couldn't read {fetchErr.domain || "that link"}.</strong>
          <span>
            {fetchErr.message}. Some sites block readers or sit behind a paywall
            — paste the text itself and BrainSNN will scan it.
          </span>
        </div>
      )}

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
              {result.fetchedFrom?.words ? (
                <a
                  className="scan-provenance"
                  href={result.fetchedFrom.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={result.fetchedFrom.url}
                >
                  <span className="scan-provenance-icon" aria-hidden="true">
                    🔗
                  </span>
                  <span>
                    Read {result.fetchedFrom.words.toLocaleString()} words from{" "}
                    <strong>{result.fetchedFrom.domain}</strong>
                    {result.fetchedFrom.title
                      ? ` — “${truncate(result.fetchedFrom.title)}”`
                      : ""}
                  </span>
                </a>
              ) : null}

              <div className={`scan-verdict scan-verdict-${level.key}`}>
                <span className="scan-verdict-dot" aria-hidden="true" />
                <div className="scan-verdict-text">
                  <strong>{level.label}</strong>
                  <span>{action}</span>
                </div>
              </div>

              <div className="scan-scores">
                {SCORES.map(({ key, label, accent, region, regionId }) => {
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
                      {regionId ? (
                        <button
                          type="button"
                          className="scan-score-region region-link"
                          title="Select this region in the 3D brain"
                          onClick={() => {
                            onSelectRegion?.(regionId);
                            const viewer =
                              document.querySelector(".viewer-panel");
                            if (viewer) {
                              viewer.scrollIntoView({
                                behavior: "smooth",
                                block: "center",
                              });
                              flashPanel(viewer);
                            }
                          }}
                        >
                          {region}
                        </button>
                      ) : (
                        <span className="scan-score-region">{region}</span>
                      )}
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
                  ↳ now driving the brain below
                </span>
              </div>
            </div>
          );
        })()}
    </section>
  );
}
