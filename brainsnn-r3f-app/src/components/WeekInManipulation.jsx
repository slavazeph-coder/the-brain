import React, { useMemo } from "react";
import { weekInManipulation } from "../utils/manipulationLog";

/**
 * Layer 49b — "Your week in manipulation" card.
 *
 * The retention hook: turns one-off scans into a compounding personal profile.
 * Reads the local manipulation log (signal counts + pressure, never the text)
 * and shows which manipulation types hit you most this week, the week-over-week
 * pressure trend, and a 7-day sparkline. Re-reads whenever `refreshKey` changes.
 */

const CAT_COLORS = {
  urgency: "#fdab43",
  outrage: "#dd6974",
  certainty: "#a86fdf",
  fear: "#5591c7",
};

function Sparkline({ values = [] }) {
  const max = Math.max(0.0001, ...values);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 3,
        height: 28,
        marginTop: 2,
      }}
      title="Mean manipulation pressure per day (last 7 days)"
    >
      {values.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${Math.max(6, Math.round((v / max) * 100))}%`,
            background:
              v > 0.5
                ? "#dd6974"
                : v > 0.25
                  ? "#fdab43"
                  : "rgba(111,210,226,0.55)",
            borderRadius: 2,
            transition: "height .2s",
          }}
        />
      ))}
    </div>
  );
}

export default function WeekInManipulation({ refreshKey = 0 }) {
  const data = useMemo(() => weekInManipulation(), [refreshKey]);

  const hasData = data.scans > 0;
  const deltaPct = data.priorMean
    ? Math.round((data.pressureDelta / data.priorMean) * 100)
    : 0;
  const trendUp = data.pressureDelta > 0.005;
  const trendDown = data.pressureDelta < -0.005;

  return (
    <div
      className="week-in-manipulation"
      style={{
        marginTop: 14,
        padding: "14px 16px",
        borderRadius: 10,
        border: "1px solid rgba(111,210,226,0.18)",
        background:
          "linear-gradient(180deg, rgba(111,210,226,0.05), rgba(255,255,255,0.02))",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span className="eyebrow">Your week in manipulation</span>
        <span className="muted small-note">
          {data.scans} scan{data.scans === 1 ? "" : "s"} · 7 days
        </span>
      </div>

      {!hasData ? (
        <p className="muted small-note" style={{ margin: 0 }}>
          Scan anything (or use the bookmarklet on any page) and your
          manipulation profile builds here — which tactics hit you most, and
          whether the pressure you're exposed to is trending up or down.
        </p>
      ) : (
        <>
          {data.top && (
            <div style={{ marginBottom: 10, fontSize: 13 }}>
              Most common hit this week:{" "}
              <strong style={{ color: CAT_COLORS[data.top.category] }}>
                {data.top.label}
              </strong>{" "}
              <span className="muted">· {data.top.count}×</span>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.signals.map((s) => (
              <div
                key={s.category}
                style={{ display: "flex", alignItems: "center", gap: 10 }}
              >
                <span
                  className="muted"
                  style={{ width: 116, fontSize: 12, flexShrink: 0 }}
                >
                  {s.label}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 8,
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${data.maxCount ? Math.round((s.count / data.maxCount) * 100) : 0}%`,
                      height: "100%",
                      background: CAT_COLORS[s.category],
                      borderRadius: 4,
                      transition: "width .25s",
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 28,
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: s.count ? "#e9eef4" : "var(--muted, #8b97a8)",
                  }}
                >
                  {s.count}
                </span>
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 14,
              marginTop: 12,
            }}
          >
            <div style={{ fontSize: 13 }}>
              <span className="muted small-note">Mean pressure</span>
              <div style={{ fontSize: 18, fontFamily: "monospace" }}>
                {Math.round(data.meanPressure * 100)}%
                {data.priorScans > 0 && (trendUp || trendDown) && (
                  <span
                    style={{
                      fontSize: 12,
                      marginLeft: 8,
                      color: trendUp ? "#dd6974" : "#7fd6a2",
                    }}
                    title={`vs ${Math.round(data.priorMean * 100)}% last week`}
                  >
                    {trendUp ? "↑" : "↓"} {Math.abs(deltaPct)}%
                  </span>
                )}
                {data.priorScans > 0 && !trendUp && !trendDown && (
                  <span className="muted small-note" style={{ marginLeft: 8 }}>
                    flat vs last week
                  </span>
                )}
              </div>
            </div>
            <div style={{ flex: 1, maxWidth: 160 }}>
              <Sparkline values={data.spark} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
