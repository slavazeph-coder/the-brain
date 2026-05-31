import React, { lazy, Suspense } from "react";
import ErrorBoundary from "../ErrorBoundary";
import LazyOnVisible from "./LazyOnVisible";

const TextAdventurePanel = lazy(() => import("../TextAdventurePanel"));
const ComparatorPanel = lazy(() => import("../ComparatorPanel"));
const DrillDownPanel = lazy(() => import("../DrillDownPanel"));
const SessionRoomsPanel = lazy(() => import("../SessionRoomsPanel"));
const ComplimentPanel = lazy(() => import("../ComplimentPanel"));
const ExtensionPanel = lazy(() => import("../ExtensionPanel"));
const RulePacksPanel = lazy(() => import("../RulePacksPanel"));
const ScanArchivePanel = lazy(() => import("../ScanArchivePanel"));
const JournalismPanel = lazy(() => import("../JournalismPanel"));
const PrivacyBudgetPanel = lazy(() => import("../PrivacyBudgetPanel"));
const GenrePanel = lazy(() => import("../GenrePanel"));
const PersonaPanel = lazy(() => import("../PersonaPanel"));
const ComposerPanel = lazy(() => import("../ComposerPanel"));
const PersonalDictionaryPanel = lazy(
  () => import("../PersonalDictionaryPanel"),
);
const PwaInstallPanel = lazy(() => import("../PwaInstallPanel"));
const FeedbackPanel = lazy(() => import("../FeedbackPanel"));
const RoleTourPanel = lazy(() => import("../RoleTourPanel"));
const SyncPanel = lazy(() => import("../SyncPanel"));
const ThemePanel = lazy(() => import("../ThemePanel"));
const CommunityPackPanel = lazy(() => import("../CommunityPackPanel"));
const MilestonePanel = lazy(() => import("../MilestonePanel"));
const DreamModePanel = lazy(() => import("../DreamModePanel"));
const AdversarialTrainingPanel = lazy(
  () => import("../AdversarialTrainingPanel"),
);

function PanelFallback() {
  return (
    <div className="viewer-loading" role="status">
      <span className="viewer-loading-dot" />
    </div>
  );
}

/**
 * "Studio" section. Lazy-mounted on first activation, then kept alive via the
 * parent's `hidden` wrapper. The single largest panel group.
 */
export default function StudioSection({ regions }) {
  return (
    <>
      <ErrorBoundary name="Text Adventure">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <TextAdventurePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Comparator">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ComparatorPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Drill-Down">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DrillDownPanel regions={regions} />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Session Rooms">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <SessionRoomsPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Compliment">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ComplimentPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Extension">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ExtensionPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Rule Packs">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <RulePacksPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Scan Archive">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ScanArchivePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Journalism">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <JournalismPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Privacy Budget">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PrivacyBudgetPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Genre">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <GenrePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Persona Simulator">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PersonaPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Reply Composer">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ComposerPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Personal Dictionary">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PersonalDictionaryPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="PWA Install">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PwaInstallPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Feedback">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <FeedbackPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Role Tour">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <RoleTourPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Sync">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <SyncPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Theme">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ThemePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Community Pack">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CommunityPackPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Milestone">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <MilestonePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Dream Mode">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DreamModePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>

      <ErrorBoundary name="Adversarial Training">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <AdversarialTrainingPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
    </>
  );
}
