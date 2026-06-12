import React from "react";

/**
 * Addressable wrapper for one panel: gives it a `data-panel-id` anchor so
 * the TOC chips / ⌘K palette can scroll to it (the anchor exists before
 * the lazy chunk loads). With `collapsible`, the wrapper is a default-open
 * <details> — open-by-default keeps lazy-mount behavior identical, and
 * closing just hides the panel without unmounting it.
 */
export default function PanelAnchor({ id, title, collapsible = false, children }) {
  if (!collapsible) {
    return (
      <div className="panel-anchor" data-panel-id={id}>
        {children}
      </div>
    );
  }
  return (
    <details className="panel-collapse" open data-panel-id={id}>
      <summary>{title}</summary>
      <div className="panel-collapse-body">{children}</div>
    </details>
  );
}
