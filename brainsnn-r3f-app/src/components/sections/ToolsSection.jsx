import React from "react";
import ApiDocsPanel from "../ApiDocsPanel";
import CustomRulesPanel from "../CustomRulesPanel";
import BadgesPanel from "../BadgesPanel";
import PortabilityPanel from "../PortabilityPanel";
import OcrPanel from "../OcrPanel";
import AudioPanel from "../AudioPanel";
import MacrosPanel from "../MacrosPanel";
import DiagnosticPanel from "../DiagnosticPanel";
import HypothesisPanel from "../HypothesisPanel";
import ContextMemoryPanel from "../ContextMemoryPanel";
import DebatePanel from "../DebatePanel";
import ReplayPanel from "../ReplayPanel";
import CoveragePanel from "../CoveragePanel";
import CalendarHeatmapPanel from "../CalendarHeatmapPanel";
import ToneShifterPanel from "../ToneShifterPanel";
import SimilaritySearchPanel from "../SimilaritySearchPanel";
import OscillationsPanel from "../OscillationsPanel";
import LayerExplorerPanel from "../LayerExplorerPanel";
import ErrorBoundary from "../ErrorBoundary";

/**
 * "Tools" section. Lazy-mounted on first activation, then kept alive via the
 * parent's `hidden` wrapper.
 */
export default function ToolsSection() {
  return (
    <>
      <ErrorBoundary name="API Docs">
        <ApiDocsPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Custom Rules">
        <CustomRulesPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Badges">
        <BadgesPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Portability">
        <PortabilityPanel />
      </ErrorBoundary>

      <ErrorBoundary name="OCR">
        <OcrPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Audio">
        <AudioPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Macros">
        <MacrosPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Diagnostic">
        <DiagnosticPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Hypothesis">
        <HypothesisPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Context Memory">
        <ContextMemoryPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Debate">
        <DebatePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Replay">
        <ReplayPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Coverage">
        <CoveragePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Calendar Heatmap">
        <CalendarHeatmapPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Tone Shifter">
        <ToneShifterPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Similarity Search">
        <SimilaritySearchPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Oscillations">
        <OscillationsPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Layer Explorer">
        <LayerExplorerPanel />
      </ErrorBoundary>
    </>
  );
}
