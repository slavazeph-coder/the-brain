import React, { lazy, Suspense } from "react";
import ErrorBoundary from "../ErrorBoundary";
import PanelAnchor from "../PanelAnchor";
import SectionHeader from "../SectionHeader";
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
      <SectionHeader sectionId="tools" />

      <PanelAnchor id="l54" title="API Docs" collapsible>
      <ErrorBoundary name="API Docs">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ApiDocsPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l55" title="Custom Rules" collapsible>
      <ErrorBoundary name="Custom Rules">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CustomRulesPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l56" title="Badges" collapsible>
      <ErrorBoundary name="Badges">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <BadgesPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l57" title="Data Portability" collapsible>
      <ErrorBoundary name="Portability">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PortabilityPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l58" title="Image OCR" collapsible>
      <ErrorBoundary name="OCR">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <OcrPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l59" title="Audio Firewall" collapsible>
      <ErrorBoundary name="Audio">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <AudioPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l60" title="Macros" collapsible>
      <ErrorBoundary name="Macros">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <MacrosPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l61" title="Diagnostic" collapsible>
      <ErrorBoundary name="Diagnostic">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DiagnosticPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l62" title="Hypothesis Mode" collapsible>
      <ErrorBoundary name="Hypothesis">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <HypothesisPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l63" title="Context Memory" collapsible>
      <ErrorBoundary name="Context Memory">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ContextMemoryPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l64" title="Debate Mode" collapsible>
      <ErrorBoundary name="Debate">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DebatePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l65" title="Replay" collapsible>
      <ErrorBoundary name="Replay">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ReplayPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l66" title="Coverage Heatmap" collapsible>
      <ErrorBoundary name="Coverage">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CoveragePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l67" title="Calendar Heatmap" collapsible>
      <ErrorBoundary name="Calendar Heatmap">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CalendarHeatmapPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l68" title="Tone Shifter" collapsible>
      <ErrorBoundary name="Tone Shifter">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ToneShifterPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l69" title="Similarity Search" collapsible>
      <ErrorBoundary name="Similarity Search">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <SimilaritySearchPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l71" title="Neural Oscillations" collapsible>
      <ErrorBoundary name="Oscillations">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <OscillationsPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l72" title="Layer Explorer" collapsible>
      <ErrorBoundary name="Layer Explorer">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <LayerExplorerPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>
    </>
  );
}
