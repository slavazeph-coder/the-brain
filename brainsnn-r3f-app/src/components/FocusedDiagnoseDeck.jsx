import React from 'react';
import HarnessDiagnosticPanel from './HarnessDiagnosticPanel';
import HarnessAlertsPanel from './HarnessAlertsPanel';
import AutoStewardPanel from './AutoStewardPanel';
import HarnessComparatorPanel from './HarnessComparatorPanel';
import DiagnosticSnapshotsPanel from './DiagnosticSnapshotsPanel';
import SpanDistributionPanel from './SpanDistributionPanel';
import TraceSearchPanel from './TraceSearchPanel';
import McpToolUsagePanel from './McpToolUsagePanel';
import SpanAnnotationPanel from './SpanAnnotationPanel';
import TraceReplayPanel from './TraceReplayPanel';
import OtlpExporterPanel from './OtlpExporterPanel';
import SanitizerPanel from './SanitizerPanel';

/**
 * Layer 102.5 — Focused: Diagnose
 *
 * The HALO observability stack rendered together: report, alerts,
 * auto-steward, comparator, scrubber, search, exporter, sanitizer.
 */
export default function FocusedDiagnoseDeck() {
  return (
    <>
      <HarnessDiagnosticPanel />
      <HarnessAlertsPanel />
      <AutoStewardPanel />
      <HarnessComparatorPanel />
      <DiagnosticSnapshotsPanel />
      <SpanDistributionPanel />
      <TraceSearchPanel />
      <McpToolUsagePanel />
      <SpanAnnotationPanel />
      <TraceReplayPanel />
      <OtlpExporterPanel />
      <SanitizerPanel />
    </>
  );
}
