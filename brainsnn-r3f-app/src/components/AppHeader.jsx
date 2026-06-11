import React from "react";

/**
 * The slim page header: name, one-breath pitch, and showcase links.
 * Extracted from ControlsBar so the first thing a visitor reads is what
 * BrainSNN is — the simulation controls now live with the 3D viewer.
 */
export default function AppHeader() {
  return (
    <section className="panel panel-pad app-header">
      <div className="eyebrow">Affective intelligence</div>
      <h1>BrainSNN</h1>
      <p className="muted">
        BrainSNN reads the feelings hidden in everyday content — headlines,
        emails, posts — and shows you, live, how they light up a brain. Paste
        something below to see it work.
      </p>
      <div className="showcase-links">
        <a href="/research">GaugeGap Research ↗</a>
        <a href="/crumb-llm">Crumb LLM ↗</a>
      </div>
    </section>
  );
}
