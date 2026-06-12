import React from "react";
import {
  SECTION_REGISTRY,
  sectionPanels,
} from "../utils/sectionRegistry";
import { openCommandPalette, scrollToLayerPanel } from "../utils/panelNav";

/**
 * Lightweight header card at the top of every section: what lives here,
 * how many panels, and a chip-row table of contents so nobody has to
 * scroll blind through a 3,000px stack to find one panel.
 */
export default function SectionHeader({ sectionId }) {
  const section = SECTION_REGISTRY[sectionId];
  if (!section) return null;
  const panels = sectionPanels(sectionId);

  return (
    <section className="panel panel-pad section-header">
      <div className="eyebrow">
        {section.label} · {panels.length} panels
      </div>
      <p className="muted">{section.blurb}</p>
      <div className="section-toc" role="navigation" aria-label={`${section.label} panels`}>
        {panels.map((p) => (
          <button
            key={p.key}
            type="button"
            className="chip-btn"
            onClick={() => scrollToLayerPanel(p.layerId)}
          >
            {p.title}
          </button>
        ))}
        {section.searchCta && (
          <button
            type="button"
            className="chip-btn palette-cta"
            onClick={openCommandPalette}
            title="Open the command palette"
          >
            Search all 100+ layers <kbd>⌘K</kbd>
          </button>
        )}
      </div>
    </section>
  );
}
