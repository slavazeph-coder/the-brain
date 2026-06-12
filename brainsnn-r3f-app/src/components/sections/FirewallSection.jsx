import React, { useCallback } from "react";
import TribePanel from "../TribePanel";
import DailyChallengePanel from "../DailyChallengePanel";
import QuizPanel from "../QuizPanel";
import CognitiveFirewallPanel from "../CognitiveFirewallPanel";
import GemmaAnalysisPanel from "../GemmaAnalysisPanel";
import GeminiAnalysisPanel from "../GeminiAnalysisPanel";
import LobsterTrapPanel from "../LobsterTrapPanel";
import ErrorBoundary from "../ErrorBoundary";
import PanelAnchor from "../PanelAnchor";
import SectionHeader from "../SectionHeader";
import { mapTRIBEToRegions } from "../../utils/cognitiveFirewall";
import {
  recordEvent as recordImmunity,
  IMMUNITY_EVENTS,
} from "../../utils/immunityScore";
import { toastInfo, toastWarning } from "../../utils/toastStore";

/**
 * "Scan & Firewall" section. Lazy-mounted on first activation, then kept alive
 * (toggled via the parent's `hidden` wrapper) so panel state + any in-flight
 * analyses survive tab switches.
 */
export default function FirewallSection({
  mode,
  setMode,
  setState,
  setFirewallResult,
  initialFirewallScan,
  incomingDailyHash,
}) {
  // Apply a TRIBE v2 prediction frame to state (only consumed by TribePanel).
  const applyTribeFrame = useCallback(
    (frame) => {
      if (!frame?.regions) return;
      setState((prev) => {
        const regions = { ...prev.regions, ...frame.regions };
        const mean =
          Object.values(regions).reduce((a, v) => a + v, 0) /
          Object.keys(regions).length;
        const plasticity =
          Object.values(prev.weights).reduce((a, v) => a + v, 0) /
          Object.keys(prev.weights).length;
        return {
          ...prev,
          regions,
          tick: prev.tick + 1,
          scenario: frame.scenario || "TRIBE v2",
          history: [...prev.history.slice(-39), { mean, plasticity }],
          mean,
          plasticity,
        };
      });
    },
    [setState],
  );

  return (
    <>
      <SectionHeader sectionId="firewall" />

      <PanelAnchor id="l3" title="TRIBE v2">
      <TribePanel
        mode={mode}
        onApplyFrame={applyTribeFrame}
        onSetMode={setMode}
      />
      </PanelAnchor>

      <PanelAnchor id="l38" title="Daily Challenge">
      <DailyChallengePanel initialHash={incomingDailyHash} />
      </PanelAnchor>

      <PanelAnchor id="quiz" title="Manipulation Quiz">
      <QuizPanel />
      </PanelAnchor>

      <PanelAnchor id="l4" title="Cognitive Firewall">
      <CognitiveFirewallPanel
        initialScan={initialFirewallScan}
        onApplyToNetwork={(result) => {
          setFirewallResult(result);
          setState((s) => mapTRIBEToRegions(s, result));
          recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
            pressure: result.manipulationPressure,
            confidence: result.confidence,
          });
          toastWarning(`Firewall: ${result.recommendedAction.slice(0, 60)}...`);
        }}
      />
      </PanelAnchor>

      <PanelAnchor id="l5" title="Gemma Analysis">
      <ErrorBoundary name="Gemma Analysis">
        <GemmaAnalysisPanel
          onApplyToNetwork={(gemmaResult) => {
            setFirewallResult(gemmaResult);
            setState((s) => mapTRIBEToRegions(s, gemmaResult));
            recordImmunity(IMMUNITY_EVENTS.GEMMA_SCAN, {
              pressure: gemmaResult.manipulationPressure,
            });
            toastInfo("Gemma 4 analysis applied to brain");
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l101" title="Gemini Analysis">
      <ErrorBoundary name="Gemini Analysis">
        <GeminiAnalysisPanel
          onApplyToNetwork={(geminiResult) => {
            setFirewallResult(geminiResult);
            setState((s) => mapTRIBEToRegions(s, geminiResult));
            recordImmunity(IMMUNITY_EVENTS.GEMMA_SCAN, {
              pressure: geminiResult.manipulationPressure,
            });
            toastInfo("Gemini analysis applied to brain");
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l102" title="Lobster Trap">
      <ErrorBoundary name="Lobster Trap">
        <LobsterTrapPanel />
      </ErrorBoundary>
      </PanelAnchor>
    </>
  );
}
