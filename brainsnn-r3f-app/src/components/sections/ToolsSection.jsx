import React, { lazy, Suspense } from "react";
import ErrorBoundary from "../ErrorBoundary";

const ApiDocsPanel = lazy(() => import("../ApiDocsPanel"));
const CustomRulesPanel = lazy(() => import("../CustomRulesPanel"));
const BadgesPanel = lazy(() => import("../BadgesPanel"));
const PortabilityPanel = lazy(() => import("../PortabilityPanel"));
const OcrPanel = lazy(() => import("../OcrPanel"));
const AudioPanel = lazy(() => import("../AudioPanel"));
const MacrosPanel = lazy(() => import("../MacrosPanel"));
const DiagnosticPanel = lazy(() => import("../DiagnosticPanel"));
const HypothesisPanel = lazy(() => import("../HypothesisPanel"));
const ContextMemoryPanel = lazy(() => import("../ContextMemoryPanel"));
const DebatePanel = lazy(() => import("../DebatePanel"));
const ReplayPanel = lazy(() => import("../ReplayPanel"));
const CoveragePanel = lazy(() => import("../CoveragePanel"));
const CalendarHeatmapPanel = lazy(() => import("../CalendarHeatmapPanel"));
const ToneShifterPanel = lazy(() => import("../ToneShifterPanel"));
const SimilaritySearchPanel = lazy(() => import("../SimilaritySearchPanel"));
const OscillationsPanel = lazy(() => import("../OscillationsPanel"));
const LayerExplorerPanel = lazy(() => import("../LayerExplorerPanel"));

function PanelFallback() {
  return (
    <div className="viewer-loading" role="status">
      <span className="viewer-loading-dot" />
    </div>
  );
}

/**
 * "Tools" section. Lazy-mounted on first activation, then kept alive via the
 * parent's `hidden` wrapper.
 */
export default function ToolsSection() {
  return (
    <>
      <ErrorBoundary name="API Docs">
        <Suspense fallback={<PanelFallback />}>
          <ApiDocsPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Custom Rules">
        <Suspense fallback={<PanelFallback />}>
          <CustomRulesPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Badges">
        <Suspense fallback={<PanelFallback />}>
          <BadgesPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Portability">
        <Suspense fallback={<PanelFallback />}>
          <PortabilityPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="OCR">
        <Suspense fallback={<PanelFallback />}>
          <OcrPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Audio">
        <Suspense fallback={<PanelFallback />}>
          <AudioPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Macros">
        <Suspense fallback={<PanelFallback />}>
          <MacrosPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Diagnostic">
        <Suspense fallback={<PanelFallback />}>
          <DiagnosticPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Hypothesis">
        <Suspense fallback={<PanelFallback />}>
          <HypothesisPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Context Memory">
        <Suspense fallback={<PanelFallback />}>
          <ContextMemoryPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Debate">
        <Suspense fallback={<PanelFallback />}>
          <DebatePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Replay">
        <Suspense fallback={<PanelFallback />}>
          <ReplayPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Coverage">
        <Suspense fallback={<PanelFallback />}>
          <CoveragePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Calendar Heatmap">
        <Suspense fallback={<PanelFallback />}>
          <CalendarHeatmapPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Tone Shifter">
        <Suspense fallback={<PanelFallback />}>
          <ToneShifterPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Similarity Search">
        <Suspense fallback={<PanelFallback />}>
          <SimilaritySearchPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Oscillations">
        <Suspense fallback={<PanelFallback />}>
          <OscillationsPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Layer Explorer">
        <Suspense fallback={<PanelFallback />}>
          <LayerExplorerPanel />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
