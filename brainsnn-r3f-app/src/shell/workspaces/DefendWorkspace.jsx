import React, { Suspense, lazy } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import CognitiveFirewallPanel from '../../components/CognitiveFirewallPanel';

const GeminiAnalysisPanel = lazy(() => import('../../components/GeminiAnalysisPanel'));
const GemmaAnalysisPanel = lazy(() => import('../../components/GemmaAnalysisPanel'));
const ImmunityPanel = lazy(() => import('../../components/ImmunityPanel'));
const RedTeamPanel = lazy(() => import('../../components/RedTeamPanel'));
const AdversarialTrainingPanel = lazy(() => import('../../components/AdversarialTrainingPanel'));
const BrainEvolvePanel = lazy(() => import('../../components/BrainEvolvePanel'));
const AttackEvolvePanel = lazy(() => import('../../components/AttackEvolvePanel'));
const CustomRulesPanel = lazy(() => import('../../components/CustomRulesPanel'));
const RulePacksPanel = lazy(() => import('../../components/RulePacksPanel'));
const EmbeddingsPanel = lazy(() => import('../../components/EmbeddingsPanel'));
const BypassSubmitPanel = lazy(() => import('../../components/BypassSubmitPanel'));
const AutopsyPanel = lazy(() => import('../../components/AutopsyPanel'));
const DiagnosticPanel = lazy(() => import('../../components/DiagnosticPanel'));
const CoveragePanel = lazy(() => import('../../components/CoveragePanel'));
const HypothesisPanel = lazy(() => import('../../components/HypothesisPanel'));
const FeedbackPanel = lazy(() => import('../../components/FeedbackPanel'));

export default function DefendWorkspace({ session }) {
  const { initialFirewallScan, onApplyFirewall, onApplyGemma, onApplyGemini, incomingImmunity, incomingAutopsy, onPromoteEvolve, onPromoteAttack } = session;

  return (
    <div className="shell-workspace">
      <header className="shell-workspace-header">
        <div className="eyebrow">Defend</div>
        <h1>Catch the payload.</h1>
        <p className="muted">Score manipulation pressure, evolve the firewall, and rehearse against the red team.</p>
      </header>

      <CognitiveFirewallPanel initialScan={initialFirewallScan} onApplyToNetwork={onApplyFirewall} />

      <Suspense fallback={<div className="muted small-note">Loading…</div>}>
        <ErrorBoundary name="Gemini Analysis"><GeminiAnalysisPanel onApplyToNetwork={onApplyGemini} /></ErrorBoundary>
        <ErrorBoundary name="Gemma Analysis"><GemmaAnalysisPanel onApplyToNetwork={onApplyGemma} /></ErrorBoundary>
        <ErrorBoundary name="Immunity Score"><ImmunityPanel incomingCard={incomingImmunity} /></ErrorBoundary>

        <details className="shell-drawer" open>
          <summary>Rule editor</summary>
          <ErrorBoundary name="Custom Rules"><CustomRulesPanel /></ErrorBoundary>
          <ErrorBoundary name="Rule Packs"><RulePacksPanel /></ErrorBoundary>
          <ErrorBoundary name="Coverage"><CoveragePanel /></ErrorBoundary>
          <ErrorBoundary name="Diagnostic"><DiagnosticPanel /></ErrorBoundary>
          <ErrorBoundary name="Feedback"><FeedbackPanel /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>Red team & evolve</summary>
          <ErrorBoundary name="Red Team"><RedTeamPanel /></ErrorBoundary>
          <ErrorBoundary name="Adversarial Training"><AdversarialTrainingPanel /></ErrorBoundary>
          <ErrorBoundary name="Brain Evolve"><BrainEvolvePanel onPromote={onPromoteEvolve} /></ErrorBoundary>
          <ErrorBoundary name="Attack Evolve"><AttackEvolvePanel onAttackPromoted={onPromoteAttack} /></ErrorBoundary>
          <ErrorBoundary name="Bypass Submit"><BypassSubmitPanel /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>Investigations</summary>
          <ErrorBoundary name="Autopsy"><AutopsyPanel initialHash={incomingAutopsy} /></ErrorBoundary>
          <ErrorBoundary name="Hypothesis"><HypothesisPanel /></ErrorBoundary>
          <ErrorBoundary name="Embeddings"><EmbeddingsPanel /></ErrorBoundary>
        </details>
      </Suspense>
    </div>
  );
}
