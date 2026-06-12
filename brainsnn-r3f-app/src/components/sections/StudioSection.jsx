import React, { lazy, Suspense } from "react";
import ErrorBoundary from "../ErrorBoundary";
import PanelAnchor from "../PanelAnchor";
import SectionHeader from "../SectionHeader";
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
      <SectionHeader sectionId="studio" />

      <PanelAnchor id="l73" title="Text Adventure" collapsible>
      <ErrorBoundary name="Text Adventure">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <TextAdventurePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l74" title="Comparator" collapsible>
      <ErrorBoundary name="Comparator">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ComparatorPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l75" title="Region Drill-Down" collapsible>
      <ErrorBoundary name="Drill-Down">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DrillDownPanel regions={regions} />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l77" title="Session Rooms" collapsible>
      <ErrorBoundary name="Session Rooms">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <SessionRoomsPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l79" title="Compliment Detector" collapsible>
      <ErrorBoundary name="Compliment">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ComplimentPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l81" title="Browser Extension" collapsible>
      <ErrorBoundary name="Extension">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ExtensionPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l83" title="Rule Packs" collapsible>
      <ErrorBoundary name="Rule Packs">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <RulePacksPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l84" title="Scan Archive" collapsible>
      <ErrorBoundary name="Scan Archive">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ScanArchivePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l85" title="Journalism Bulk Mode" collapsible>
      <ErrorBoundary name="Journalism">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <JournalismPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l86" title="Privacy Budget" collapsible>
      <ErrorBoundary name="Privacy Budget">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PrivacyBudgetPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l87" title="Genre Classifier" collapsible>
      <ErrorBoundary name="Genre">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <GenrePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l88" title="Persona Simulator" collapsible>
      <ErrorBoundary name="Persona Simulator">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PersonaPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l89" title="Reply Composer" collapsible>
      <ErrorBoundary name="Reply Composer">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ComposerPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l90" title="Personal Dictionary" collapsible>
      <ErrorBoundary name="Personal Dictionary">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PersonalDictionaryPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l91" title="PWA Install" collapsible>
      <ErrorBoundary name="PWA Install">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <PwaInstallPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l93" title="Feedback Calibration" collapsible>
      <ErrorBoundary name="Feedback">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <FeedbackPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l94" title="Role Tour" collapsible>
      <ErrorBoundary name="Role Tour">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <RoleTourPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l96" title="Cross-device Sync" collapsible>
      <ErrorBoundary name="Sync">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <SyncPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l98" title="Theme & A11y" collapsible>
      <ErrorBoundary name="Theme">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <ThemePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l99" title="Community Pack" collapsible>
      <ErrorBoundary name="Community Pack">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <CommunityPackPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l100" title="Milestones" collapsible>
      <ErrorBoundary name="Milestone">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <MilestonePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l26" title="Dream Mode" collapsible>
      <ErrorBoundary name="Dream Mode">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <DreamModePanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l27" title="Adversarial Training" collapsible>
      <ErrorBoundary name="Adversarial Training">
        <LazyOnVisible>
          <Suspense fallback={<PanelFallback />}>
            <AdversarialTrainingPanel />
          </Suspense>
        </LazyOnVisible>
      </ErrorBoundary>
      </PanelAnchor>
    </>
  );
}
