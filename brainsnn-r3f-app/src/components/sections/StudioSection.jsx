import React from "react";
import TextAdventurePanel from "../TextAdventurePanel";
import ComparatorPanel from "../ComparatorPanel";
import DrillDownPanel from "../DrillDownPanel";
import SessionRoomsPanel from "../SessionRoomsPanel";
import ComplimentPanel from "../ComplimentPanel";
import ExtensionPanel from "../ExtensionPanel";
import RulePacksPanel from "../RulePacksPanel";
import ScanArchivePanel from "../ScanArchivePanel";
import JournalismPanel from "../JournalismPanel";
import PrivacyBudgetPanel from "../PrivacyBudgetPanel";
import GenrePanel from "../GenrePanel";
import PersonaPanel from "../PersonaPanel";
import ComposerPanel from "../ComposerPanel";
import PersonalDictionaryPanel from "../PersonalDictionaryPanel";
import PwaInstallPanel from "../PwaInstallPanel";
import FeedbackPanel from "../FeedbackPanel";
import RoleTourPanel from "../RoleTourPanel";
import SyncPanel from "../SyncPanel";
import ThemePanel from "../ThemePanel";
import CommunityPackPanel from "../CommunityPackPanel";
import MilestonePanel from "../MilestonePanel";
import DreamModePanel from "../DreamModePanel";
import AdversarialTrainingPanel from "../AdversarialTrainingPanel";
import ErrorBoundary from "../ErrorBoundary";

/**
 * "Studio" section. Lazy-mounted on first activation, then kept alive via the
 * parent's `hidden` wrapper. The single largest panel group.
 */
export default function StudioSection({ regions }) {
  return (
    <>
      <ErrorBoundary name="Text Adventure">
        <TextAdventurePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Comparator">
        <ComparatorPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Drill-Down">
        <DrillDownPanel regions={regions} />
      </ErrorBoundary>

      <ErrorBoundary name="Session Rooms">
        <SessionRoomsPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Compliment">
        <ComplimentPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Extension">
        <ExtensionPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Rule Packs">
        <RulePacksPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Scan Archive">
        <ScanArchivePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Journalism">
        <JournalismPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Privacy Budget">
        <PrivacyBudgetPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Genre">
        <GenrePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Persona Simulator">
        <PersonaPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Reply Composer">
        <ComposerPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Personal Dictionary">
        <PersonalDictionaryPanel />
      </ErrorBoundary>

      <ErrorBoundary name="PWA Install">
        <PwaInstallPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Feedback">
        <FeedbackPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Role Tour">
        <RoleTourPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Sync">
        <SyncPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Theme">
        <ThemePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Community Pack">
        <CommunityPackPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Milestone">
        <MilestonePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Dream Mode">
        <DreamModePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Adversarial Training">
        <AdversarialTrainingPanel />
      </ErrorBoundary>
    </>
  );
}
