import React, { lazy, Suspense } from "react";
import NeuroRagPanel from "../NeuroRagPanel";
import MultimodalRagPanel from "../MultimodalRagPanel";
import VectorGraphFusionPanel from "../VectorGraphFusionPanel";
import DirectInsertPanel from "../DirectInsertPanel";
import AffectiveDecoderPanel from "../AffectiveDecoderPanel";
import NeurochemistryPanel from "../NeurochemistryPanel";
import BrainEvolvePanel from "../BrainEvolvePanel";
import AttackEvolvePanel from "../AttackEvolvePanel";
import ErrorBoundary from "../ErrorBoundary";
import PanelAnchor from "../PanelAnchor";
import SectionHeader from "../SectionHeader";
import { markActivity } from "../../utils/dreamMode";
import { mapRagToRegions } from "../../utils/neuroRag";
import { mapMultimodalToRegions } from "../../utils/multimodalRag";
import { mapFusedToRegions } from "../../utils/vectorGraphFusion";
import { applyAffectsToBrainState } from "../../utils/affectiveDecoder";
import { applyNTBath } from "../../utils/neurochemistry";
import {
  setActiveRules,
  resetActiveRules,
  deserializeRules,
} from "../../utils/cognitiveFirewall";
import {
  recordEvent as recordImmunity,
  IMMUNITY_EVENTS,
} from "../../utils/immunityScore";
import { toastSuccess, toastInfo } from "../../utils/toastStore";

// SplitBrainView pulls in the three.js stack, so keep it lazy even within this
// already-lazy section — it only loads if/when the Neuro tab actually renders.
const SplitBrainView = lazy(() => import("../SplitBrainView"));

/**
 * "Neuro & RAG" section. Lazy-mounted on first activation, then kept alive via
 * the parent's `hidden` wrapper so retrieval state survives tab switches.
 */
export default function NeuroSection({
  state,
  setState,
  quality,
  lastAffectDecode,
  setAffectOverride,
  setLastAffectDecode,
}) {
  return (
    <>
      <SectionHeader sectionId="neuro" />

      <PanelAnchor id="l28" title="Neuro-RAG">
      <ErrorBoundary name="Neuro-RAG">
        <NeuroRagPanel
          onApplyToBrain={(ragResult) => {
            markActivity();
            setState((prev) => mapRagToRegions(prev, ragResult));
            recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
              name: `RAG: ${ragResult.results.length} hits · ${ragResult.mode}`,
            });
            toastSuccess(
              `Retrieved ${ragResult.results.length} chunks · ${ragResult.mode}`,
            );
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l33" title="Multimodal RAG">
      <ErrorBoundary name="Multimodal RAG">
        <MultimodalRagPanel
          onApplyToBrain={(mmResult) => {
            markActivity();
            setState((prev) => mapMultimodalToRegions(prev, mmResult));
            const histLabel = Object.entries(mmResult.byModality || {})
              .map(([k, v]) => `${k}:${v}`)
              .join(" ");
            recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
              name: `Multimodal RAG: ${mmResult.results.length} hits · ${histLabel}`,
            });
            toastSuccess(
              `Retrieved ${mmResult.results.length} items · ${mmResult.mode}`,
            );
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l34" title="Vector-Graph Fusion">
      <ErrorBoundary name="Vector-Graph Fusion">
        <VectorGraphFusionPanel
          onApplyToBrain={(fusedResult) => {
            markActivity();
            setState((prev) => mapFusedToRegions(prev, fusedResult));
            const stats = fusedResult.fusionStats || {};
            recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
              name: `Fused RAG: ${fusedResult.results.length} hits · ${stats.siblingPulls || 0} siblings`,
            });
            toastSuccess(
              `Fused ${fusedResult.results.length} items · ${fusedResult.mode}`,
            );
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l35" title="Direct Insert">
      <ErrorBoundary name="Direct Insert">
        <DirectInsertPanel />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l29" title="Affective Decoder">
      <ErrorBoundary name="Affective Decoder">
        <AffectiveDecoderPanel
          onApplyToBrain={(map) => {
            markActivity();
            setAffectOverride(map);
            if (map) {
              toastSuccess(
                `Affect colors applied to ${Object.keys(map).length} regions`,
              );
            } else {
              toastInfo("Affect colors cleared");
            }
          }}
          onApplyActivation={(decoded) => {
            markActivity();
            setLastAffectDecode(decoded);
            setState((prev) => applyAffectsToBrainState(prev, decoded));
            recordImmunity(IMMUNITY_EVENTS.AFFECT_DECODED, {
              name: `Affects: ${decoded.dominant.map((d) => d.label).join(", ") || "neutral"}`,
            });
            toastInfo("Affect activation nudged into brain state");
          }}
          onDecode={(decoded) => setLastAffectDecode(decoded)}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l30" title="Neurochemistry">
      <ErrorBoundary name="Neurochemistry">
        <NeurochemistryPanel
          lastAffectDecode={lastAffectDecode}
          onApplyBath={(levels, opts) => {
            markActivity();
            setState((prev) => applyNTBath(prev, levels, opts));
            toastSuccess(`Applied ${opts?.label ?? "NT bath"} to brain`);
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l31" title="Brain Evolve">
      <ErrorBoundary name="Brain Evolve">
        <BrainEvolvePanel
          onPromote={(node) => {
            markActivity();
            if (!node?.ruleSet) {
              resetActiveRules();
              toastInfo("Firewall reset to default rules");
              return;
            }
            const rules = deserializeRules(node.ruleSet);
            setActiveRules(rules);
            const f1 = node.results?.summary?.thresholds?.[0.3]?.f1 ?? 0;
            recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
              name: `Evolve promoted: F1 ${f1.toFixed(3)}`,
            });
            toastSuccess(`Evolved firewall promoted (F1 ${f1.toFixed(3)})`);
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l32" title="Attack Evolve">
      <ErrorBoundary name="Attack Evolve">
        <AttackEvolvePanel
          onAttackPromoted={(node, category) => {
            markActivity();
            if (!node) {
              toastInfo("Red team corpus reset to defaults");
              return;
            }
            const evasion = ((1 - (node.detection || 0)) * 100).toFixed(0);
            recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
              name: `Attack promoted (${category}): ${evasion}% evasion`,
            });
            toastSuccess(
              `Evolved attack added to "${category}" — ${evasion}% evasion`,
            );
          }}
        />
      </ErrorBoundary>
      </PanelAnchor>

      <PanelAnchor id="l13" title="Split Brain View">
      <ErrorBoundary name="Split Brain View">
        <Suspense fallback={null}>
          <SplitBrainView currentState={state} quality={quality} />
        </Suspense>
      </ErrorBoundary>
      </PanelAnchor>
    </>
  );
}
