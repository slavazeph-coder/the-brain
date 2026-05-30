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
      <ErrorBoundary name="Immunity Score">
        <ImmunityPanel incomingCard={incomingImmunityCard} />
      </ErrorBoundary>

      <ErrorBoundary name="Embeddings">
        <EmbeddingsPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Red Team">
        <RedTeamPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Bypass Submit">
        <BypassSubmitPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Autopsy">
        <AutopsyPanel initialHash={incomingAutopsyHash} />
      </ErrorBoundary>

      <ErrorBoundary name="Time-Series">
        <TimeSeriesPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Inbox">
        <InboxPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Diff">
        <DiffPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Scan Anywhere">
        <ScanAnywherePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Weekly Recap">
        <WeeklyRecapPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Fingerprint">
        <FingerprintPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Echo">
        <EchoPanel />
      </ErrorBoundary>
    </>
  );
}
