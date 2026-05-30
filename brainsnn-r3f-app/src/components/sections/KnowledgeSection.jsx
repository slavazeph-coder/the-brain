import React from "react";
import SnapshotPanel from "../SnapshotPanel";
import HeatmapTimeline from "../HeatmapTimeline";
import KnowledgeBrainPanel from "../KnowledgeBrainPanel";
import MCPBridgePanel from "../MCPBridgePanel";
import CodeBrainPanel from "../CodeBrainPanel";
import BrainStewardPanel from "../BrainStewardPanel";
import ConversationBrainPanel from "../ConversationBrainPanel";
import ErrorBoundary from "../ErrorBoundary";
import {
  recordEvent as recordImmunity,
  IMMUNITY_EVENTS,
} from "../../utils/immunityScore";
import { toastSuccess } from "../../utils/toastStore";

/**
 * "Knowledge" section. Lazy-mounted on first activation, then kept alive via
 * the parent's `hidden` wrapper.
 */
export default function KnowledgeSection({
  state,
  setState,
  setKnowledgeMode,
}) {
  return (
    <>
      <SnapshotPanel
        state={state}
        onRestoreSnapshot={(snap) => {
          setState((prev) => ({
            ...prev,
            regions: { ...prev.regions, ...snap.regions },
            weights: { ...prev.weights, ...snap.weights },
            selected: snap.selected || prev.selected,
            scenario: `Restored: ${snap.name}`,
            tick: prev.tick + 1,
          }));
          recordImmunity(IMMUNITY_EVENTS.SNAPSHOT_SAVED, {
            name: snap.name,
          });
          toastSuccess(`Restored: ${snap.name}`);
        }}
      />

      <HeatmapTimeline state={state} />

      <ErrorBoundary name="Knowledge Brain">
        <KnowledgeBrainPanel
          onApplyKnowledgeState={(kbState) => {
            setState((prev) => ({
              ...prev,
              regions: { ...prev.regions, ...kbState.regions },
              weights: { ...prev.weights, ...kbState.weights },
              scenario: kbState.scenario || "Knowledge Brain",
              tick: prev.tick + 1,
            }));
            setKnowledgeMode(true);
            recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {});
            toastSuccess(
              "Knowledge map applied — 3D brain now shows knowledge domains",
            );
          }}
        />
      </ErrorBoundary>

      <ErrorBoundary name="MCP Bridge">
        <MCPBridgePanel />
      </ErrorBoundary>

      <ErrorBoundary name="Code Brain">
        <CodeBrainPanel
          onApplyToNetwork={(payload) => {
            setState((prev) => ({
              ...prev,
              regions: { ...prev.regions, ...payload.regions },
              scenario: payload.scenario,
              tick: prev.tick + 1,
            }));
            recordImmunity(IMMUNITY_EVENTS.CODE_ANALYZED, {});
            toastSuccess("Code communities mapped onto brain");
          }}
        />
      </ErrorBoundary>

      <ErrorBoundary name="Brain Steward">
        <BrainStewardPanel />
      </ErrorBoundary>

      <ErrorBoundary name="Conversation Brain">
        <ConversationBrainPanel
          onApplyFinalState={(payload) => {
            setState((prev) => ({
              ...prev,
              regions: { ...prev.regions, ...payload.regions },
              scenario: payload.scenario,
              tick: prev.tick + 1,
            }));
            recordImmunity(IMMUNITY_EVENTS.CONVERSATION_ANALYZED, {
              pressureAvg: payload.pressureAvg,
              turns: payload.turns,
            });
            toastSuccess("Conversation final state applied to brain");
          }}
        />
      </ErrorBoundary>
    </>
  );
}
