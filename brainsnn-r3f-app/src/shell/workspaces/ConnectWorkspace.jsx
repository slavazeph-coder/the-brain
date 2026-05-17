import React, { Suspense, lazy, useState } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';

const SharePanel = lazy(() => import('../../components/SharePanel'));
const SessionRoomsPanel = lazy(() => import('../../components/SessionRoomsPanel'));
const ExportPanel = lazy(() => import('../../components/ExportPanel'));
const LiveSyncPanel = lazy(() => import('../../components/LiveSyncPanel'));
const SyncPanel = lazy(() => import('../../components/SyncPanel'));
const PluginPanel = lazy(() => import('../../components/PluginPanel'));
const VoiceControl = lazy(() => import('../../components/VoiceControl'));
const DiffPanel = lazy(() => import('../../components/DiffPanel'));
const InboxPanel = lazy(() => import('../../components/InboxPanel'));
const JournalismPanel = lazy(() => import('../../components/JournalismPanel'));
const PortabilityPanel = lazy(() => import('../../components/PortabilityPanel'));
const PrivacyBudgetPanel = lazy(() => import('../../components/PrivacyBudgetPanel'));
const ExtensionPanel = lazy(() => import('../../components/ExtensionPanel'));
const ScanAnywherePanel = lazy(() => import('../../components/ScanAnywherePanel'));
const OcrPanel = lazy(() => import('../../components/OcrPanel'));
const AudioPanel = lazy(() => import('../../components/AudioPanel'));
const ApiDocsPanel = lazy(() => import('../../components/ApiDocsPanel'));
const LobsterTrapPanel = lazy(() => import('../../components/LobsterTrapPanel'));
const CommunityPackPanel = lazy(() => import('../../components/CommunityPackPanel'));
const PwaInstallPanel = lazy(() => import('../../components/PwaInstallPanel'));
const TimelinePanel = lazy(() => import('../../components/TimelinePanel'));
const ThemePanel = lazy(() => import('../../components/ThemePanel'));
const RoleTourPanel = lazy(() => import('../../components/RoleTourPanel'));
const MilestonePanel = lazy(() => import('../../components/MilestonePanel'));

const SUB_TABS = [
  { id: 'share',    label: 'Share' },
  { id: 'external', label: 'External' },
  { id: 'system',   label: 'System' },
  { id: 'discover', label: 'Discover' }
];

export default function ConnectWorkspace({ session }) {
  const [tab, setTab] = useState('share');
  const { state, isRecording, exportStatus, exportProgress, gifOptions, onGifChange, onRemoteState, timelineFrame, timelineIndex, onScrubTimeline, onReplayBurst, onApplyPluginResults, firewallResult, trends } = session;

  return (
    <div className="shell-workspace">
      <header className="shell-workspace-header">
        <div className="eyebrow">Connect</div>
        <h1>Outside the box.</h1>
        <p className="muted">Share, export, integrate, and the long-running system surfaces.</p>
        <div className="shell-subtabs">
          {SUB_TABS.map((s) => (
            <button
              key={s.id}
              className={`shell-subtab ${tab === s.id ? 'is-active' : ''}`}
              onClick={() => setTab(s.id)}
            >{s.label}</button>
          ))}
        </div>
      </header>

      <Suspense fallback={<div className="muted small-note">Loading…</div>}>
        {tab === 'share' && (
          <>
            <ErrorBoundary name="Share"><SharePanel state={state} /></ErrorBoundary>
            <ErrorBoundary name="Session Rooms"><SessionRoomsPanel /></ErrorBoundary>
            <ErrorBoundary name="Live Sync"><LiveSyncPanel state={state} onRemoteState={onRemoteState} /></ErrorBoundary>
            <ErrorBoundary name="Sync"><SyncPanel /></ErrorBoundary>
            <ErrorBoundary name="Scan Anywhere"><ScanAnywherePanel /></ErrorBoundary>
            <ErrorBoundary name="Diff"><DiffPanel /></ErrorBoundary>
            <ErrorBoundary name="Inbox"><InboxPanel /></ErrorBoundary>
          </>
        )}

        {tab === 'external' && (
          <>
            <ErrorBoundary name="API Docs"><ApiDocsPanel /></ErrorBoundary>
            <ErrorBoundary name="Lobster Trap"><LobsterTrapPanel /></ErrorBoundary>
            <ErrorBoundary name="Plugins"><PluginPanel onApplyResults={onApplyPluginResults} /></ErrorBoundary>
            <ErrorBoundary name="OCR"><OcrPanel /></ErrorBoundary>
            <ErrorBoundary name="Audio"><AudioPanel /></ErrorBoundary>
            <ErrorBoundary name="Voice"><VoiceControl state={state} trends={trends} firewallResult={firewallResult} /></ErrorBoundary>
            <ErrorBoundary name="Journalism"><JournalismPanel /></ErrorBoundary>
            <ErrorBoundary name="Extension"><ExtensionPanel /></ErrorBoundary>
            <ErrorBoundary name="Community Pack"><CommunityPackPanel /></ErrorBoundary>
          </>
        )}

        {tab === 'system' && (
          <>
            <ErrorBoundary name="Export">
              <ExportPanel
                {...gifOptions}
                exportProgress={exportProgress}
                exportStatus={exportStatus}
                onChange={onGifChange}
              />
            </ErrorBoundary>
            <ErrorBoundary name="Timeline">
              <TimelinePanel
                history={state.history}
                timelineIndex={timelineIndex}
                onScrub={onScrubTimeline}
                onReplay={onReplayBurst}
              />
            </ErrorBoundary>
            <ErrorBoundary name="Portability"><PortabilityPanel /></ErrorBoundary>
            <ErrorBoundary name="Privacy Budget"><PrivacyBudgetPanel /></ErrorBoundary>
            <ErrorBoundary name="PWA Install"><PwaInstallPanel /></ErrorBoundary>
            <ErrorBoundary name="Theme"><ThemePanel /></ErrorBoundary>
          </>
        )}

        {tab === 'discover' && (
          <>
            <ErrorBoundary name="Role Tour"><RoleTourPanel /></ErrorBoundary>
            <ErrorBoundary name="Milestone"><MilestonePanel /></ErrorBoundary>
          </>
        )}
      </Suspense>
    </div>
  );
}
