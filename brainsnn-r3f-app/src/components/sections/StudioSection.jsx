import React, { lazy, Suspense } from "react";
import ErrorBoundary from "../ErrorBoundary";

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
        <Suspense fallback={<PanelFallback />}>
          <TextAdventurePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Comparator">
        <Suspense fallback={<PanelFallback />}>
          <ComparatorPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Drill-Down">
        <Suspense fallback={<PanelFallback />}>
          <DrillDownPanel regions={regions} />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Session Rooms">
        <Suspense fallback={<PanelFallback />}>
          <SessionRoomsPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Compliment">
        <Suspense fallback={<PanelFallback />}>
          <ComplimentPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Extension">
        <Suspense fallback={<PanelFallback />}>
          <ExtensionPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Rule Packs">
        <Suspense fallback={<PanelFallback />}>
          <RulePacksPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Scan Archive">
        <Suspense fallback={<PanelFallback />}>
          <ScanArchivePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Journalism">
        <Suspense fallback={<PanelFallback />}>
          <JournalismPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Privacy Budget">
        <Suspense fallback={<PanelFallback />}>
          <PrivacyBudgetPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Genre">
        <Suspense fallback={<PanelFallback />}>
          <GenrePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Persona Simulator">
        <Suspense fallback={<PanelFallback />}>
          <PersonaPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Reply Composer">
        <Suspense fallback={<PanelFallback />}>
          <ComposerPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Personal Dictionary">
        <Suspense fallback={<PanelFallback />}>
          <PersonalDictionaryPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="PWA Install">
        <Suspense fallback={<PanelFallback />}>
          <PwaInstallPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Feedback">
        <Suspense fallback={<PanelFallback />}>
          <FeedbackPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Role Tour">
        <Suspense fallback={<PanelFallback />}>
          <RoleTourPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Sync">
        <Suspense fallback={<PanelFallback />}>
          <SyncPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Theme">
        <Suspense fallback={<PanelFallback />}>
          <ThemePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Community Pack">
        <Suspense fallback={<PanelFallback />}>
          <CommunityPackPanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Milestone">
        <Suspense fallback={<PanelFallback />}>
          <MilestonePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Dream Mode">
        <Suspense fallback={<PanelFallback />}>
          <DreamModePanel />
        </Suspense>
      </ErrorBoundary>

      <ErrorBoundary name="Adversarial Training">
        <Suspense fallback={<PanelFallback />}>
          <AdversarialTrainingPanel />
        </Suspense>
      </ErrorBoundary>
    </>
  );
}
