import React, { useState } from "react";
import { openCommandPalette } from "../utils/panelNav";

const STORAGE_KEY = "brainsnn_intro_dismissed";

/**
 * First-visit orientation card at the top of the default section.
 * Three steps, one dismiss — gone forever once the user knows the way.
 */
export default function IntroCard() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* noop */
    }
  }

  return (
    <section className="panel panel-pad intro-card">
      <div className="eyebrow">New here? Three steps</div>
      <ol>
        <li>
          <strong>Paste anything</strong> — a headline, email, or post — into
          the scan box above and hit Analyze.
        </li>
        <li>
          <strong>Read the verdict</strong>: which feelings the text installs,
          the evidence phrases, and which brain regions light up.
        </li>
        <li>
          <strong>Explore 100+ layers</strong> through the tabs below, or{" "}
          <button type="button" className="intro-palette-link" onClick={openCommandPalette}>
            search them all (⌘K)
          </button>
          .
        </li>
      </ol>
      <button type="button" className="btn-sm intro-dismiss" onClick={dismiss}>
        Got it — don&apos;t show again
      </button>
    </section>
  );
}
