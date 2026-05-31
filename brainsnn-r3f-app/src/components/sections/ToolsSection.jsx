import React, { lazy, Suspense } from "react";
import ErrorBoundary from "../ErrorBoundary";
import LazyOnVisible from "./LazyOnVisible";

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
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ApiDocsPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Custom Rules">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CustomRulesPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Badges">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <BadgesPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Portability">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PortabilityPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="OCR">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <OcrPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Audio">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <AudioPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Macros">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <MacrosPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Diagnostic">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DiagnosticPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Hypothesis">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <HypothesisPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Context Memory">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ContextMemoryPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Debate">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DebatePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Replay">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ReplayPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Coverage">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CoveragePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Calendar Heatmap">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CalendarHeatmapPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Tone Shifter">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ToneShifterPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Similarity Search">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <SimilaritySearchPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Oscillations">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <OscillationsPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Layer Explorer">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <LayerExplorerPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
    </>
  );
}
