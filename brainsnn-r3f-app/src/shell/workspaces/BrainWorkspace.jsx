import React, { Suspense, lazy } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';

const SplitBrainView = lazy(() => import('../../components/SplitBrainView'));
const AffectiveDecoderPanel = lazy(() => import('../../components/AffectiveDecoderPanel'));
const DreamModePanel = lazy(() => import('../../components/DreamModePanel'));
const OscillationsPanel = lazy(() => import('../../components/OscillationsPanel'));
const ConversationBrainPanel = lazy(() => import('../../components/ConversationBrainPanel'));
const NeurochemistryPanel = lazy(() => import('../../components/NeurochemistryPanel'));
const ToneShifterPanel = lazy(() => import('../../components/ToneShifterPanel'));
const MCPBridgePanel = lazy(() => import('../../components/MCPBridgePanel'));
const BrainStewardPanel = lazy(() => import('../../components/BrainStewardPanel'));
const TribePanel = lazy(() => import('../../components/TribePanel'));
const EEGPanel = lazy(() => import('../../components/EEGPanel'));
const SnapshotPanel = lazy(() => import('../../components/SnapshotPanel'));

export default function BrainWorkspace({ session }) {
  const {
    state, quality, lastAffectDecode,
    onApplyAffect, onApplyAffectActivation, onDecodeAffect,
    onApplyNT, onApplyTribeFrame, onSetMode, mode,
    onConnectMuse, onConnectSerial, onInjectMockEeg, eegStatus,
    onRestoreSnapshot
  } = session;

  return (
    <div className="shell-workspace shell-workspace-brain">
      <header className="shell-workspace-header">
        <div className="eyebrow">Brain</div>
        <h1>Shape what fires.</h1>
        <p className="muted">Snapshots, affects, neurochemistry, dreams — and the agent surfaces that drive the brain from outside the browser.</p>
      </header>

      <Suspense fallback={<div className="muted small-note">Loading…</div>}>
        <ErrorBoundary name="Affective Decoder">
          <AffectiveDecoderPanel
            onApplyToBrain={onApplyAffect}
            onApplyActivation={onApplyAffectActivation}
            onDecode={onDecodeAffect}
          />
        </ErrorBoundary>
        <ErrorBoundary name="Neurochemistry">
          <NeurochemistryPanel lastAffectDecode={lastAffectDecode} onApplyBath={onApplyNT} />
        </ErrorBoundary>

        <details className="shell-drawer" open>
          <summary>Mind state</summary>
          <ErrorBoundary name="Dream Mode"><DreamModePanel /></ErrorBoundary>
          <ErrorBoundary name="Oscillations"><OscillationsPanel /></ErrorBoundary>
          <ErrorBoundary name="Conversation Brain"><ConversationBrainPanel onApplyFinalState={session.onApplyConversation} /></ErrorBoundary>
          <ErrorBoundary name="Tone Shifter"><ToneShifterPanel /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>Snapshots & comparisons</summary>
          <ErrorBoundary name="Snapshots"><SnapshotPanel state={state} onRestoreSnapshot={onRestoreSnapshot} /></ErrorBoundary>
          <ErrorBoundary name="Split Brain"><SplitBrainView currentState={state} quality={quality} /></ErrorBoundary>
        </details>

        <details className="shell-drawer">
          <summary>External drivers</summary>
          <ErrorBoundary name="TRIBE v2">
            <TribePanel mode={mode} onApplyFrame={onApplyTribeFrame} onSetMode={onSetMode} />
          </ErrorBoundary>
          <ErrorBoundary name="EEG">
            <EEGPanel
              eegStatus={eegStatus}
              onConnectMuse={onConnectMuse}
              onConnectSerial={onConnectSerial}
              onInjectMock={onInjectMockEeg}
            />
          </ErrorBoundary>
          <ErrorBoundary name="MCP Bridge"><MCPBridgePanel /></ErrorBoundary>
          <ErrorBoundary name="Brain Steward"><BrainStewardPanel /></ErrorBoundary>
        </details>
      </Suspense>
    </div>
  );
}
