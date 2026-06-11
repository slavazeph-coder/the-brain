import React from "react";
import ImmunityPanel from "../ImmunityPanel";
import EmbeddingsPanel from "../EmbeddingsPanel";
import RedTeamPanel from "../RedTeamPanel";
import BypassSubmitPanel from "../BypassSubmitPanel";
import AutopsyPanel from "../AutopsyPanel";
import TimeSeriesPanel from "../TimeSeriesPanel";
import InboxPanel from "../InboxPanel";
import DiffPanel from "../DiffPanel";
import ScanAnywherePanel from "../ScanAnywherePanel";
import WeeklyRecapPanel from "../WeeklyRecapPanel";
import FingerprintPanel from "../FingerprintPanel";
import EchoPanel from "../EchoPanel";
import ErrorBoundary from "../ErrorBoundary";
import PanelAnchor from "../PanelAnchor";
import SectionHeader from "../SectionHeader";

/**
 * "Defense" section. Lazy-mounted on first activation, then kept alive via the
 * parent's `hidden` wrapper.
 */
export default function DefenseSection({
  incomingImmunityCard,
  incomingAutopsyHash,
}) {
  return (
    <>
      <SectionHeader sectionId="defense" />

      <PanelAnchor id="l23" title="Immunity Score" collapsible>
      <ErrorBoundary name="Immunity Score">
        <ImmunityPanel incomingCard={incomingImmunityCard} />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l24" title="Real Embeddings" collapsible>
      <ErrorBoundary name="Embeddings">
        <EmbeddingsPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l25" title="Red Team Simulator" collapsible>
      <ErrorBoundary name="Red Team">
        <RedTeamPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="bypass-submit" title="Bypass Submit" collapsible>
      <ErrorBoundary name="Bypass Submit">
        <BypassSubmitPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l36" title="Autopsy Mode" collapsible>
      <ErrorBoundary name="Autopsy">
        <AutopsyPanel initialHash={incomingAutopsyHash} />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l43" title="Time-Series Autopsy" collapsible>
      <ErrorBoundary name="Time-Series">
        <TimeSeriesPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l44" title="Inbox Mode" collapsible>
      <ErrorBoundary name="Inbox">
        <InboxPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l47" title="Diff Mode" collapsible>
      <ErrorBoundary name="Diff">
        <DiffPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l49" title="Scan Anywhere" collapsible>
      <ErrorBoundary name="Scan Anywhere">
        <ScanAnywherePanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l50" title="Weekly Recap" collapsible>
      <ErrorBoundary name="Weekly Recap">
        <WeeklyRecapPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l51" title="Style Fingerprint" collapsible>
      <ErrorBoundary name="Fingerprint">
        <FingerprintPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l53" title="Echo Detector" collapsible>
      <ErrorBoundary name="Echo">
        <EchoPanel />
      </ErrorBoundary>
      </PanelAnchor>
    </>
  );
}
