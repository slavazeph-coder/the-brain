import React from 'react';
import CognitiveFirewallPanel from './CognitiveFirewallPanel';
import CoveragePanel from './CoveragePanel';
import ToneShifterPanel from './ToneShifterPanel';
import ContextMemoryPanel from './ContextMemoryPanel';
import ScanArchivePanel from './ScanArchivePanel';
import ContentProvenancePanel from './ContentProvenancePanel';

/**
 * Layer 102.5 — Focused: Scan
 *
 * Renders just the scan-flow panels: paste, score, see coverage,
 * shift tone, archive, sign provenance. Same components as the
 * full surface — only one viewMode is mounted at a time, so this
 * doesn't double-render.
 */
export default function FocusedScanDeck({ firewallProps }) {
  return (
    <>
      <CognitiveFirewallPanel {...firewallProps} />
      <CoveragePanel />
      <ToneShifterPanel />
      <ContextMemoryPanel />
      <ScanArchivePanel />
      <ContentProvenancePanel />
    </>
  );
}
