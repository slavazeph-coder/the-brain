import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrainScene from './components/BrainScene';
import ControlsBar from './components/ControlsBar';
import InspectorPanel from './components/InspectorPanel';
import ActivityCharts from './components/ActivityCharts';
import EEGPanel from './components/EEGPanel';
import TimelinePanel from './components/TimelinePanel';
import ExportPanel from './components/ExportPanel';
import TribePanel from './components/TribePanel';
import CognitiveFirewallPanel from './components/CognitiveFirewallPanel';
import GemmaAnalysisPanel from './components/GemmaAnalysisPanel';
import SnapshotPanel from './components/SnapshotPanel';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import NarrativePanel from './components/NarrativePanel';
import ToastContainer from './components/ToastContainer';
import KeyboardHelp from './components/KeyboardHelp';
import SharePanel from './components/SharePanel';
import OnboardingWalkthrough from './components/OnboardingWalkthrough';
import SplitBrainView from './components/SplitBrainView';
import VoiceControl from './components/VoiceControl';
import PluginPanel from './components/PluginPanel';
import LiveSyncPanel from './components/LiveSyncPanel';
import HeatmapTimeline from './components/HeatmapTimeline';
import KnowledgeBrainPanel from './components/KnowledgeBrainPanel';
import MCPBridgePanel from './components/MCPBridgePanel';
import CodeBrainPanel from './components/CodeBrainPanel';
import BrainStewardPanel from './components/BrainStewardPanel';
import ConversationBrainPanel from './components/ConversationBrainPanel';
import ImmunityPanel from './components/ImmunityPanel';
import EmbeddingsPanel from './components/EmbeddingsPanel';
import RedTeamPanel from './components/RedTeamPanel';
import DreamModePanel from './components/DreamModePanel';
import AdversarialTrainingPanel from './components/AdversarialTrainingPanel';
import NeuroRagPanel from './components/NeuroRagPanel';
import AffectiveDecoderPanel from './components/AffectiveDecoderPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { decodeStateFromHash } from './components/SharePanel';
import { REGION_INFO } from './data/network';
import { mapTRIBEToRegions } from './utils/cognitiveFirewall';
import { registerBridgeContext, logToolCall } from './utils/mcpBridge';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from './utils/immunityScore';
import { applyScenario, createInitialState, resetState, simulateStep } from './utils/sim';
import { applyMockEEG, connectMuseEEG, connectSerialEEG, mapEEGToRegions, parseMusePacket } from './utils/eeg';
import { startCanvasRecording } from './utils/recording';
import { listSnapshots, loadSnapshot, saveSnapshot } from './utils/snapshots';
import { registerDreamProviders, startDreamMonitor, stopDreamMonitor, markActivity } from './utils/dreamMode';
import { mapRagToRegions } from './utils/neuroRag';
import { applyAffectsToBrainState } from './utils/affectiveDecoder';
import { registerShortcuts } from './utils/shortcuts';
import { trendDirection } from './utils/analytics';
import { toastSuccess, toastInfo, toastWarning } from './utils/toastStore';

export default function App() {
  const [state, setState] = useState(() => {
    // Check for shared state in URL hash
    const shared = decodeStateFromHash();
    if (shared) {
      const initial = createInitialState();
      return {
        ...initial,
        regions: { ...initial.regions, ...shared.regions },
        weights: { ...initial.weights, ...(shared.weights || {}) },
        scenario: shared.scenario || initial.scenario,
        selected: shared.selected || initial.selected,
        tick: shared.tick || 0
      };
    }
    return createInitialState();
  });
  const [mode, setMode] = useState('simulation');
  const [eegStatus, setEegStatus] = useState({ connected: false, label: 'No device connected' });
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [exportStatus, setExportStatus] = useState('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [quality, setQuality] = useState('high');
  const [gifOptions, setGifOptions] = useState({ trimStart: 0, trimDuration: 2.5, fps: 12, width: 720 });
  const [showKbHelp, setShowKbHelp] = useState(false);
  const [firewallResult, setFirewallResult] = useState(null);
  const [knowledgeMode, setKnowledgeMode] = useState(false);
  const [affectOverride, setAffectOverride] = useState(null);
  const recorderRef = useRef(null);
  const historyRef = useRef([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track per-region history for analytics trends
  useEffect(() => {
    historyRef.current.push({ regions: { ...state.regions } });
    if (historyRef.current.length > 60) historyRef.current.shift();
  }, [state.tick]);

  // Layer 19 — register MCP bridge context once
  useEffect(() => {
    registerBridgeContext({
      getState: () => stateRef.current,
      setState,
      getHistory: () => historyRef.current,
      applyScenarioKey: (key) => setState((s) => applyScenario(s, key)),
      triggerBurst: () => setState((s) => ({ ...s, burst: 20, scenario: 'MCP Sensory Burst' })),
      resetBrain: () => setState(resetState()),
      onToolCall: (entry) => logToolCall(entry)
    });
  }, []);

  // Layer 26 — register dream providers + start monitor
  useEffect(() => {
    registerDreamProviders({
      getSnapshots: () =>
        listSnapshots()
          .slice(0, 10)
          .map((s) => loadSnapshot(s.id))
          .filter(Boolean),
      setState,
      narrate: (text) => toastInfo(text)
    });
    startDreamMonitor();
    return () => stopDreamMonitor();
  }, []);

  const trends = useMemo(() => {
    const t = {};
    for (const key of Object.keys(state.regions)) {
      const values = historyRef.current.map((h) => h.regions?.[key] ?? 0);
      t[key] = trendDirection(values);
    }
    return t;
  }, [state.tick, state.regions]);

  // Keyboard shortcuts
  useEffect(() => {
    const QUALITY_CYCLE = ['low', 'high', 'ultra'];
    return registerShortcuts({
      toggleRun: () => setState((s) => ({ ...s, running: !s.running })),
      burst: () => { setState((s) => ({ ...s, burst: 20, scenario: 'Sensory Burst' })); toastInfo('Sensory burst triggered'); },
      reset: () => { setState(resetState()); setMode('simulation'); toastInfo('Brain state reset'); },
      modeSimulation: () => { setMode('simulation'); toastInfo('Switched to Simulation mode'); },
      modeTribe: () => { setMode('tribe'); toastInfo('Switched to TRIBE v2 mode'); },
      modeEeg: () => { setMode('eeg'); toastInfo('Switched to EEG mode'); },
      snapshot: () => { saveSnapshot(state); toastSuccess('Snapshot saved'); },
      record: () => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return;
        if (!isRecording) {
          try {
            recorderRef.current = startCanvasRecording(canvas, { onStatus: setExportStatus, onProgress: setExportProgress });
            setIsRecording(true);
            toastInfo('Recording started');
          } catch (err) { setExportStatus(err.message); }
        } else if (recorderRef.current) {
          recorderRef.current.stop();
          recorderRef.current = null;
          setIsRecording(false);
          setExportStatus('WebM ready');
          setExportProgress(100);
          toastSuccess('Recording saved');
        }
      },
      cycleQuality: () => {
        setQuality((prev) => {
          const idx = QUALITY_CYCLE.indexOf(prev);
          const next = QUALITY_CYCLE[(idx + 1) % QUALITY_CYCLE.length];
          toastInfo(`Quality: ${next}`);
          return next;
        });
      },
      showHelp: () => setShowKbHelp(true)
    });
  }, [state, isRecording]);

  // Simulation loop — only active in simulation mode
  useEffect(() => {
    if (mode !== 'simulation') return;
    const id = setInterval(() => {
      setState((prev) => simulateStep(prev));
    }, 180);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    setTimelineIndex(Math.max(0, state.history.length - 1));
  }, [state.history.length]);

  const stats = useMemo(() => ({
    mean: state.mean ?? Object.values(state.regions).reduce((a, v) => a + v, 0) / Object.keys(state.regions).length,
    plasticity: state.plasticity ?? Object.values(state.weights).reduce((a, v) => a + v, 0) / Object.keys(state.weights).length
  }), [state]);

  const timelineFrame = state.history[timelineIndex] ?? state.history[state.history.length - 1];

  // Apply a TRIBE v2 prediction frame to state
  const applyTribeFrame = useCallback((frame) => {
    if (!frame?.regions) return;
    setState((prev) => {
      const regions = { ...prev.regions, ...frame.regions };
      const mean = Object.values(regions).reduce((a, v) => a + v, 0) / Object.keys(regions).length;
      const plasticity = Object.values(prev.weights).reduce((a, v) => a + v, 0) / Object.keys(prev.weights).length;
      return {
        ...prev,
        regions,
        tick: prev.tick + 1,
        scenario: frame.scenario || 'TRIBE v2',
        history: [...prev.history.slice(-39), { mean, plasticity }],
        mean,
        plasticity
      };
    });
  }, []);

  const modeLabel = mode === 'tribe' ? 'TRIBE v2' : mode === 'eeg' ? 'Live EEG' : 'Simulation';

  return (
    <div className="app-shell">
      <div className="backdrop" />

      {/* Global overlays */}
      <ToastContainer />
      <KeyboardHelp open={showKbHelp} onClose={() => setShowKbHelp(false)} />
      <OnboardingWalkthrough />

      <main className="app-layout">
        <section className="main-column">
          <ControlsBar
            state={state}
            isRecording={isRecording}
            exportStatus={exportStatus}
            quality={quality}
            mode={mode}
            onSetMode={setMode}
            onSetQuality={setQuality}
            onToggleRun={() => { markActivity(); setState((s) => ({ ...s, running: !s.running })); }}
            onBurst={() => { markActivity(); setState((s) => ({ ...s, burst: 20, scenario: 'Sensory Burst' })); }}
            onReset={() => { markActivity(); setState(resetState()); setMode('simulation'); }}
            onScenario={(key) => { markActivity(); setState((s) => applyScenario(s, key)); setMode('simulation'); }}
            onToggleRecording={() => {
              const canvas = document.querySelector('canvas');
              if (!canvas) return;
              if (!isRecording) {
                try {
                  recorderRef.current = startCanvasRecording(canvas, {
                    onStatus: setExportStatus,
                    onProgress: setExportProgress
                  });
                  setIsRecording(true);
                } catch (err) {
                  setExportStatus(err.message);
                }
              } else if (recorderRef.current) {
                recorderRef.current.stop();
                recorderRef.current = null;
                setIsRecording(false);
                setExportStatus('WebM ready');
                setExportProgress(100);
              }
            }}
            onExportGif={async () => {
              const canvas = document.querySelector('canvas');
              if (!canvas) return;
              try {
                if (!recorderRef.current) {
                  recorderRef.current = startCanvasRecording(canvas, {
                    onStatus: setExportStatus,
                    onProgress: setExportProgress
                  });
                  setIsRecording(true);
                  setTimeout(async () => {
                    if (recorderRef.current) {
                      await recorderRef.current.convertToGif(gifOptions);
                      recorderRef.current = null;
                      setIsRecording(false);
                    }
                  }, Math.max(1200, gifOptions.trimDuration * 1000));
                } else {
                  await recorderRef.current.convertToGif(gifOptions);
                  recorderRef.current = null;
                  setIsRecording(false);
                }
              } catch (err) {
                setExportStatus(err.message);
              }
            }}
          />

          <section className="viewer-panel panel">
            <div className="viewer-overlay">
              <span className="viewer-chip">Tick {state.tick}</span>
              <span className="viewer-chip">Mean firing {stats.mean.toFixed(3)}</span>
              <span className="viewer-chip">Plasticity {stats.plasticity.toFixed(3)}</span>
              <span className="viewer-chip">Selected {state.selected}</span>
              <span className="viewer-chip">Quality {quality}</span>
              <span className="viewer-chip">Mode {modeLabel}</span>
            </div>

            <div className="viewer-canvas-wrap">
              <BrainScene
                regions={state.regions}
                weights={state.weights}
                selected={state.selected}
                quality={quality}
                knowledgeMode={knowledgeMode}
                affectOverride={affectOverride}
                onQualityChange={setQuality}
                onSelect={(id) => setState((s) => ({ ...s, selected: id || s.selected }))}
              />
            </div>
          </section>

          <section className="lower-grid wide-grid">
            <div className="panel panel-pad metric-grid">
              <div className="metric"><small>Regions</small><strong>7</strong></div>
              <div className="metric"><small>Connections</small><strong>10</strong></div>
              <div className="metric"><small>Scenario</small><strong>{state.scenario}</strong></div>
              <div className="metric"><small>Lead region</small><strong>{Object.entries(state.regions).sort((a, b) => b[1] - a[1])[0][0]}</strong></div>
            </div>

            <div className="panel panel-pad explainer">
              <div className="eyebrow">Selected region</div>
              <h2>{state.selected} · {REGION_INFO[state.selected].name}</h2>
              <p className="muted">{REGION_INFO[state.selected].role}</p>
              <p className="muted small-note">
                Data source: {modeLabel}. Switch modes to toggle between synthetic simulation, TRIBE v2 neural predictions, and live EEG input.
                Press <strong>?</strong> for keyboard shortcuts.
              </p>
            </div>
          </section>

          <ActivityCharts state={state} />

          <ErrorBoundary name="Analytics Dashboard">
            <AnalyticsDashboard state={state} />
          </ErrorBoundary>

          <NarrativePanel state={state} trends={trends} firewallResult={firewallResult} />

          <TribePanel
            mode={mode}
            onApplyFrame={applyTribeFrame}
            onSetMode={setMode}
          />

          <CognitiveFirewallPanel
            onApplyToNetwork={(result) => {
              setFirewallResult(result);
              setState((s) => mapTRIBEToRegions(s, result));
              recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
                pressure: result.manipulationPressure,
                confidence: result.confidence
              });
              toastWarning(`Firewall: ${result.recommendedAction.slice(0, 60)}...`);
            }}
          />

          <ErrorBoundary name="Gemma Analysis">
            <GemmaAnalysisPanel
              onApplyToNetwork={(gemmaResult) => {
                setFirewallResult(gemmaResult);
                setState((s) => mapTRIBEToRegions(s, gemmaResult));
                recordImmunity(IMMUNITY_EVENTS.GEMMA_SCAN, {
                  pressure: gemmaResult.manipulationPressure
                });
                toastInfo('Gemma 4 analysis applied to brain');
              }}
            />
          </ErrorBoundary>

          <SnapshotPanel
            state={state}
            onRestoreSnapshot={(snap) => {
              setState((prev) => ({
                ...prev,
                regions: { ...prev.regions, ...snap.regions },
                weights: { ...prev.weights, ...snap.weights },
                selected: snap.selected || prev.selected,
                scenario: `Restored: ${snap.name}`,
                tick: prev.tick + 1
              }));
              recordImmunity(IMMUNITY_EVENTS.SNAPSHOT_SAVED, { name: snap.name });
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
                  scenario: kbState.scenario || 'Knowledge Brain',
                  tick: prev.tick + 1
                }));
                setKnowledgeMode(true);
                recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {});
                toastSuccess('Knowledge map applied — 3D brain now shows knowledge domains');
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
                  tick: prev.tick + 1
                }));
                recordImmunity(IMMUNITY_EVENTS.CODE_ANALYZED, {});
                toastSuccess('Code communities mapped onto brain');
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
                  tick: prev.tick + 1
                }));
                recordImmunity(IMMUNITY_EVENTS.CONVERSATION_ANALYZED, {
                  pressureAvg: payload.pressureAvg,
                  turns: payload.turns
                });
                toastSuccess('Conversation final state applied to brain');
              }}
            />
          </ErrorBoundary>

          <ErrorBoundary name="Immunity Score">
            <ImmunityPanel />
          </ErrorBoundary>

          <ErrorBoundary name="Embeddings">
            <EmbeddingsPanel />
          </ErrorBoundary>

          <ErrorBoundary name="Red Team">
            <RedTeamPanel />
          </ErrorBoundary>

          <ErrorBoundary name="Dream Mode">
            <DreamModePanel />
          </ErrorBoundary>

          <ErrorBoundary name="Adversarial Training">
            <AdversarialTrainingPanel />
          </ErrorBoundary>

          <ErrorBoundary name="Neuro-RAG">
            <NeuroRagPanel
              onApplyToBrain={(ragResult) => {
                markActivity();
                setState((prev) => mapRagToRegions(prev, ragResult));
                recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
                  name: `RAG: ${ragResult.results.length} hits · ${ragResult.mode}`
                });
                toastSuccess(`Retrieved ${ragResult.results.length} chunks · ${ragResult.mode}`);
              }}
            />
          </ErrorBoundary>

          <ErrorBoundary name="Affective Decoder">
            <AffectiveDecoderPanel
              onApplyToBrain={(map) => {
                markActivity();
                setAffectOverride(map);
                if (map) {
                  toastSuccess(`Affect colors applied to ${Object.keys(map).length} regions`);
                } else {
                  toastInfo('Affect colors cleared');
                }
              }}
              onApplyActivation={(decoded) => {
                markActivity();
                setState((prev) => applyAffectsToBrainState(prev, decoded));
                recordImmunity(IMMUNITY_EVENTS.AFFECT_DECODED, {
                  name: `Affects: ${decoded.dominant.map((d) => d.label).join(', ') || 'neutral'}`
                });
                toastInfo('Affect activation nudged into brain state');
              }}
            />
          </ErrorBoundary>

          <ErrorBoundary name="Split Brain View">
            <SplitBrainView currentState={state} quality={quality} />
          </ErrorBoundary>

          <VoiceControl state={state} trends={trends} firewallResult={firewallResult} />

          <PluginPanel
            onApplyResults={(combined) => {
              // Map plugin scores to firewall-compatible format if available
              const mapped = {
                emotionalActivation: combined.negativity ?? combined.emotionalActivation ?? 0,
                cognitiveSuppression: combined.complexity ?? combined.cognitiveSuppression ?? 0,
                manipulationPressure: 1 - (combined.credibility ?? 0.5),
                trustErosion: combined.negativity ?? combined.trustErosion ?? 0
              };
              setState((s) => mapTRIBEToRegions(s, mapped));
              toastInfo('Plugin analysis applied to brain');
            }}
          />

          <LiveSyncPanel
            state={state}
            onRemoteState={(remote) => {
              if (remote?.regions) {
                setState((prev) => ({
                  ...prev,
                  regions: { ...prev.regions, ...remote.regions },
                  scenario: remote.scenario || 'Remote Sync',
                  tick: prev.tick + 1
                }));
              }
            }}
          />

          <SharePanel state={state} />

          <ExportPanel
            {...gifOptions}
            exportProgress={exportProgress}
            exportStatus={exportStatus}
            onChange={(key, value) => setGifOptions((prev) => ({ ...prev, [key]: value }))}
          />

          <TimelinePanel
            history={state.history}
            timelineIndex={timelineIndex}
            onScrub={setTimelineIndex}
            onReplay={() => setState((s) => ({ ...s, burst: 20, tick: 0, scenario: 'Replay Burst' }))}
          />

          <EEGPanel
            eegStatus={eegStatus}
            onConnectMuse={async () => {
              try {
                const result = await connectMuseEEG();
                setEegStatus({ connected: true, label: `Connected via Bluetooth: ${result.deviceName}` });
                setMode('eeg');
                const mockPacket = new DataView(new Uint8Array([1, 20, 0, 120, 0, 90, 0, 60]).buffer);
                const parsed = parseMusePacket(mockPacket);
                setState((s) => mapEEGToRegions(s, parsed));
                toastSuccess('Muse EEG connected');
              } catch (err) {
                setEegStatus({ connected: false, label: err.message });
                toastWarning('EEG connection failed');
              }
            }}
            onConnectSerial={async () => {
              try {
                await connectSerialEEG();
                setEegStatus({ connected: true, label: 'Serial EEG bridge connected' });
                setMode('eeg');
                toastSuccess('Serial EEG connected');
              } catch (err) {
                setEegStatus({ connected: false, label: err.message });
              }
            }}
            onInjectMock={() => {
              setState((s) => applyMockEEG(s));
              setEegStatus({ connected: true, label: 'Mock EEG injected into THL/PFC/HPC' });
              setMode('eeg');
              toastInfo('Mock EEG data injected');
            }}
          />

          <section className="panel panel-pad deploy-panel">
            <div className="eyebrow">Deployment</div>
            <h2>Ready for GitHub Pages and Vercel</h2>
            <p className="muted">This project includes deployment configs plus browser-side export helpers for shareable demos.</p>
          </section>
        </section>

        <InspectorPanel
          state={state}
          onSelect={(id) => setState((s) => ({ ...s, selected: id }))}
          timelineFrame={timelineFrame}
        />
      </main>
    </div>
  );
}
