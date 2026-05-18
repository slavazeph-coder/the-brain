import React, { Suspense, lazy } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';

const KnowledgeBrainPanel = lazy(() => import('../../components/KnowledgeBrainPanel'));
const NeuroRagPanel = lazy(() => import('../../components/NeuroRagPanel'));
const ContextMemoryPanel = lazy(() => import('../../components/ContextMemoryPanel'));
const CodeBrainPanel = lazy(() => import('../../components/CodeBrainPanel'));
const MultimodalRagPanel = lazy(() => import('../../components/MultimodalRagPanel'));
const VectorGraphFusionPanel = lazy(() => import('../../components/VectorGraphFusionPanel'));
const SimilaritySearchPanel = lazy(() => import('../../components/SimilaritySearchPanel'));
const DirectInsertPanel = lazy(() => import('../../components/DirectInsertPanel'));
const EchoPanel = lazy(() => import('../../components/EchoPanel'));
const FingerprintPanel = lazy(() => import('../../components/FingerprintPanel'));
const ScanArchivePanel = lazy(() => import('../../components/ScanArchivePanel'));
const PersonalDictionaryPanel = lazy(() => import('../../components/PersonalDictionaryPanel'));

export default function KnowledgeWorkspace({ session }) {
  const { onApplyKnowledge, onApplyRag, onApplyMultimodalRag, onApplyFusedRag, onApplyCodeBrain } = session;

  return (
    <div className="shell-workspace">
      <header className="shell-workspace-header">
        <div className="eyebrow">Knowledge</div>
        <h1>Feed the cortex.</h1>
        <p className="muted">Docs, code, retrieval, and the long memory of what you've already scanned.</p>
      </header>

      <Suspense fallback={<div className="muted small-note">Loading…</div>}>
        <ErrorBoundary name="Knowledge Brain"><KnowledgeBrainPanel onApplyKnowledgeState={onApplyKnowledge} /></ErrorBoundary>
        <ErrorBoundary name="Neuro-RAG"><NeuroRagPanel onApplyToBrain={onApplyRag} /></ErrorBoundary>
        <ErrorBoundary name="Context Memory"><ContextMemoryPanel /></ErrorBoundary>

        <details className="shell-drawer">
          <summary>Code & multimodal</summary>
          <ErrorBoundary name="Code Brain"><CodeBrainPanel onApplyToNetwork={onApplyCodeBrain} /></ErrorBoundary>
          <ErrorBoundary name="Multimodal RAG"><MultimodalRagPanel onApplyToBrain={onApplyMultimodalRag} /></ErrorBoundary>
          <ErrorBoundary name="Vector-Graph Fusion"><VectorGraphFusionPanel onApplyToBrain={onApplyFusedRag} /></ErrorBoundary>
          <ErrorBoundary name="Direct Insert"><DirectInsertPanel /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>Memory & patterns</summary>
          <ErrorBoundary name="Similarity Search"><SimilaritySearchPanel /></ErrorBoundary>
          <ErrorBoundary name="Echo"><EchoPanel /></ErrorBoundary>
          <ErrorBoundary name="Fingerprint"><FingerprintPanel /></ErrorBoundary>
          <ErrorBoundary name="Scan Archive"><ScanArchivePanel /></ErrorBoundary>
          <ErrorBoundary name="Personal Dictionary"><PersonalDictionaryPanel /></ErrorBoundary>
        </details>
      </Suspense>
    </div>
  );
}
