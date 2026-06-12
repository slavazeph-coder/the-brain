import React from "react";
import { GLOSSARY } from "../utils/glossary";

/**
 * Inline jargon helper: dotted underline + native tooltip with the
 * plain-English definition from the glossary. Keyboard-focusable so the
 * definition is reachable without a mouse.
 */
export default function Term({ k, children }) {
  const def = GLOSSARY[k];
  if (!def) return <>{children}</>;
  return (
    <span className="term" title={def} tabIndex={0} aria-label={def}>
      {children}
    </span>
  );
}
