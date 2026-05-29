import React from "react";

/**
 * Sticky section navigation for the main page. Switches which panel group is
 * visible (sections stay mounted, toggled via `hidden`, so no panel state or
 * the 3D canvas ever tears down). The Labs links jump to the standalone
 * showcase pages served as static files on the same domain.
 */
export default function SectionNav({ sections, active, onChange }) {
  return (
    <nav className="section-nav" aria-label="Sections">
      <div className="section-nav-tabs" role="tablist">
        {sections.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={active === s.id}
            className={`section-tab ${active === s.id ? "active" : ""}`}
            onClick={() => onChange(s.id)}
          >
            {s.label}
            {typeof s.count === "number" && (
              <span className="section-tab-count">{s.count}</span>
            )}
          </button>
        ))}
      </div>
      <div className="section-nav-labs">
        <a className="section-lab-link" href="/research">
          GaugeGap ↗
        </a>
        <a className="section-lab-link" href="/crumb-llm">
          Crumb LLM ↗
        </a>
      </div>
    </nav>
  );
}
