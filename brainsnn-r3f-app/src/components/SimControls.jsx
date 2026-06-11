import React, { useCallback, useState } from "react";

const STORAGE_KEY = "brainsnn_sim_controls_open";

function initialOpen() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {
    /* storage unavailable — fall through to viewport default */
  }
  // Default: expanded on desktop, tucked away on phones.
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(min-width: 768px)").matches;
  }
  return true;
}

/**
 * Collapsible shell around the simulation controls. Keeps the full
 * scenario/record/quality control surface one tap away without making it
 * the first thing a new visitor has to parse.
 */
export default function SimControls({ children }) {
  const [open] = useState(initialOpen);

  const persist = useCallback((e) => {
    try {
      localStorage.setItem(STORAGE_KEY, e.currentTarget.open ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  return (
    <details className="sim-controls" open={open} onToggle={persist}>
      <summary>
        <strong>Simulation controls</strong>
        <span className="muted">
          pause · scenarios · record · quality · mode
        </span>
      </summary>
      <div className="sim-controls-body">{children}</div>
    </details>
  );
}
