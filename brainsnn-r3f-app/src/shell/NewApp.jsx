import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppShell from './AppShell';
import ToastContainer from '../components/ToastContainer';
import KeyboardHelp from '../components/KeyboardHelp';
import OnboardingWalkthrough from '../components/OnboardingWalkthrough';
import CommandPalette from '../components/CommandPalette';
import ErrorBoundary from '../components/ErrorBoundary';
import UpdateBanner from './UpdateBanner';

import { decodeStateFromHash } from '../components/SharePanel';
import { decodeReaction } from '../utils/reactionCard';
import {
  mapTRIBEToRegions,
  setActiveRules,
  resetActiveRules,
  deserializeRules
} from '../utils/cognitiveFirewall';
import { registerBridgeContext, logToolCall } from '../utils/mcpBridge';
import { recordEvent as recordImmunity, IMMUNITY_EVENTS } from '../utils/immunityScore';
import {
  applyScenario,
  createInitialState,
  resetState,
  simulateStep
} from '../utils/sim';
import {
  applyMockEEG,
  connectMuseEEG,
  connectSerialEEG,
  mapEEGToRegions,
  parseMusePacket
} from '../utils/eeg';
import { startCanvasRecording } from '../utils/recording';
import { listSnapshots, loadSnapshot, saveSnapshot } from '../utils/snapshots';
import {
  registerDreamProviders,
  startDreamMonitor,
  stopDreamMonitor,
  markActivity
} from '../utils/dreamMode';
import { mapRagToRegions } from '../utils/neuroRag';
import { mapMultimodalToRegions } from '../utils/multimodalRag';
import { mapFusedToRegions } from '../utils/vectorGraphFusion';
import { applyAffectsToBrainState } from '../utils/affectiveDecoder';
import { applyNTBath } from '../utils/neurochemistry';
import { registerShortcuts } from '../utils/shortcuts';
import { trendDirection } from '../utils/analytics';
import { toastSuccess, toastInfo, toastWarning } from '../utils/toastStore';
import { registerServiceWorker } from '../utils/pwa';
import { registerTheme } from '../utils/theme';

/**
 * NewApp — Claude-design AppShell wrapper.
 *
 * Mirrors all state, refs, effects, and onApply* callbacks from
 * legacy App.jsx so the new shell shares identical behavior. Both
 * shells must NEVER mount simultaneously (main.jsx picks one via
 * ?shell=new) — they'd double-register MCP bridge + dream monitor.
 */
export default function NewApp() {
  const [state, setState] = useState(() => {
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
  const [lastAffectDecode, setLastAffectDecode] = useState(null);

  const [incomingImmunity] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('i') || null; } catch { return null; }
  });
  const [incomingAutopsy] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('a') || null; } catch { return null; }
  });
  const [incomingDaily] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('d') || null; } catch { return null; }
  });
  const [initialFirewallScan] = useState(() => {
    try {
      const hash = new URLSearchParams(window.location.search).get('r');
      if (!hash) return null;
      const reaction = decodeReaction(hash);
      if (!reaction || !reaction.text) return null;
      return {
        text: reaction.text,
        result: {
          emotionalActivation: reaction.emotionalActivation,
          cognitiveSuppression: reaction.cognitiveSuppression,
          manipulationPressure: reaction.manipulationPressure,
          trustErosion: reaction.trustErosion,
          evidence: [],
          confidence: 'shared',
          recommendedAction: 'Rehydrated from shared reaction link.',
          source: 'shared-link'
        },
        autoApply: true
      };
    } catch { return null; }
  });

  const recorderRef = useRef(null);
  const historyRef = useRef([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  // History tracking for analytics trends.
  useEffect(() => {
    historyRef.current.push({ regions: { ...state.regions } });
    if (historyRef.current.length > 60) historyRef.current.shift();
  }, [state.tick]);

  // PWA + theme on mount.
  useEffect(() => { registerServiceWorker(); registerTheme(); }, []);

  // MCP bridge context.
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

  // Dream mode.
  useEffect(() => {
    registerDreamProviders({
      getSnapshots: () => listSnapshots().slice(0, 10).map((s) => loadSnapshot(s.id)).filter(Boolean),
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

  // Simulation tick.
  useEffect(() => {
    if (mode !== 'simulation') return;
    const id = setInterval(() => setState((prev) => simulateStep(prev)), 180);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    setTimelineIndex(Math.max(0, state.history.length - 1));
  }, [state.history.length]);

  const timelineFrame = state.history[timelineIndex] ?? state.history[state.history.length - 1];

  // Keyboard shortcuts.
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

  // ---------- handlers ----------
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

  const onSelectRegion = useCallback((id) => {
    setState((s) => ({ ...s, selected: id || s.selected }));
  }, []);

  const onApplyFirewall = useCallback((result) => {
    setFirewallResult(result);
    setState((s) => mapTRIBEToRegions(s, result));
    recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
      pressure: result.manipulationPressure,
      confidence: result.confidence
    });
    toastWarning(`Firewall: ${result.recommendedAction.slice(0, 60)}...`);
  }, []);

  const onApplyGemma = useCallback((result) => {
    setFirewallResult(result);
    setState((s) => mapTRIBEToRegions(s, result));
    recordImmunity(IMMUNITY_EVENTS.GEMMA_SCAN, { pressure: result.manipulationPressure });
    toastInfo('Gemma 4 analysis applied to brain');
  }, []);

  const onApplyGemini = useCallback((result) => {
    setFirewallResult(result);
    setState((s) => mapTRIBEToRegions(s, result));
    recordImmunity(IMMUNITY_EVENTS.GEMMA_SCAN, { pressure: result.manipulationPressure });
    toastInfo('Gemini analysis applied to brain');
  }, []);

  const onRestoreSnapshot = useCallback((snap) => {
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
  }, []);

  const onApplyKnowledge = useCallback((kbState) => {
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
  }, []);

  const onApplyCodeBrain = useCallback((payload) => {
    setState((prev) => ({
      ...prev,
      regions: { ...prev.regions, ...payload.regions },
      scenario: payload.scenario,
      tick: prev.tick + 1
    }));
    recordImmunity(IMMUNITY_EVENTS.CODE_ANALYZED, {});
    toastSuccess('Code communities mapped onto brain');
  }, []);

  const onApplyConversation = useCallback((payload) => {
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
  }, []);

  const onApplyRag = useCallback((ragResult) => {
    markActivity();
    setState((prev) => mapRagToRegions(prev, ragResult));
    recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
      name: `RAG: ${ragResult.results.length} hits · ${ragResult.mode}`
    });
    toastSuccess(`Retrieved ${ragResult.results.length} chunks · ${ragResult.mode}`);
  }, []);

  const onApplyMultimodalRag = useCallback((mmResult) => {
    markActivity();
    setState((prev) => mapMultimodalToRegions(prev, mmResult));
    const histLabel = Object.entries(mmResult.byModality || {}).map(([k, v]) => `${k}:${v}`).join(' ');
    recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
      name: `Multimodal RAG: ${mmResult.results.length} hits · ${histLabel}`
    });
    toastSuccess(`Retrieved ${mmResult.results.length} items · ${mmResult.mode}`);
  }, []);

  const onApplyFusedRag = useCallback((fusedResult) => {
    markActivity();
    setState((prev) => mapFusedToRegions(prev, fusedResult));
    const stats = fusedResult.fusionStats || {};
    recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, {
      name: `Fused RAG: ${fusedResult.results.length} hits · ${stats.siblingPulls || 0} siblings`
    });
    toastSuccess(`Fused ${fusedResult.results.length} items · ${fusedResult.mode}`);
  }, []);

  const onApplyAffect = useCallback((map) => {
    markActivity();
    setAffectOverride(map);
    if (map) toastSuccess(`Affect colors applied to ${Object.keys(map).length} regions`);
    else toastInfo('Affect colors cleared');
  }, []);

  const onApplyAffectActivation = useCallback((decoded) => {
    markActivity();
    setLastAffectDecode(decoded);
    setState((prev) => applyAffectsToBrainState(prev, decoded));
    recordImmunity(IMMUNITY_EVENTS.AFFECT_DECODED, {
      name: `Affects: ${decoded.dominant.map((d) => d.label).join(', ') || 'neutral'}`
    });
    toastInfo('Affect activation nudged into brain state');
  }, []);

  const onApplyNT = useCallback((levels, opts) => {
    markActivity();
    setState((prev) => applyNTBath(prev, levels, opts));
    toastSuccess(`Applied ${opts?.label ?? 'NT bath'} to brain`);
  }, []);

  const onPromoteEvolve = useCallback((node) => {
    markActivity();
    if (!node?.ruleSet) {
      resetActiveRules();
      toastInfo('Firewall reset to default rules');
      return;
    }
    const rules = deserializeRules(node.ruleSet);
    setActiveRules(rules);
    const f1 = node.results?.summary?.thresholds?.[0.3]?.f1 ?? 0;
    recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, { name: `Evolve promoted: F1 ${f1.toFixed(3)}` });
    toastSuccess(`Evolved firewall promoted (F1 ${f1.toFixed(3)})`);
  }, []);

  const onPromoteAttack = useCallback((node, category) => {
    markActivity();
    if (!node) {
      toastInfo('Red team corpus reset to defaults');
      return;
    }
    const evasion = ((1 - (node.detection || 0)) * 100).toFixed(0);
    recordImmunity(IMMUNITY_EVENTS.KNOWLEDGE_SCANNED, { name: `Attack promoted (${category}): ${evasion}% evasion` });
    toastSuccess(`Evolved attack added to "${category}" — ${evasion}% evasion`);
  }, []);

  const onApplyPluginResults = useCallback((combined) => {
    const mapped = {
      emotionalActivation: combined.negativity ?? combined.emotionalActivation ?? 0,
      cognitiveSuppression: combined.complexity ?? combined.cognitiveSuppression ?? 0,
      manipulationPressure: 1 - (combined.credibility ?? 0.5),
      trustErosion: combined.negativity ?? combined.trustErosion ?? 0
    };
    setState((s) => mapTRIBEToRegions(s, mapped));
    toastInfo('Plugin analysis applied to brain');
  }, []);

  const onRemoteState = useCallback((remote) => {
    if (remote?.regions) {
      setState((prev) => ({
        ...prev,
        regions: { ...prev.regions, ...remote.regions },
        scenario: remote.scenario || 'Remote Sync',
        tick: prev.tick + 1
      }));
    }
  }, []);

  // Controls bar callbacks bundle.
  const controls = useMemo(() => ({
    onSetMode: setMode,
    onSetQuality: setQuality,
    onToggleRun: () => { markActivity(); setState((s) => ({ ...s, running: !s.running })); },
    onBurst: () => { markActivity(); setState((s) => ({ ...s, burst: 20, scenario: 'Sensory Burst' })); },
    onReset: () => { markActivity(); setState(resetState()); setMode('simulation'); },
    onScenario: (key) => { markActivity(); setState((s) => applyScenario(s, key)); setMode('simulation'); },
    onToggleRecording: () => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      if (!isRecording) {
        try {
          recorderRef.current = startCanvasRecording(canvas, { onStatus: setExportStatus, onProgress: setExportProgress });
          setIsRecording(true);
        } catch (err) { setExportStatus(err.message); }
      } else if (recorderRef.current) {
        recorderRef.current.stop();
        recorderRef.current = null;
        setIsRecording(false);
        setExportStatus('WebM ready');
        setExportProgress(100);
      }
    },
    onExportGif: async () => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      try {
        if (!recorderRef.current) {
          recorderRef.current = startCanvasRecording(canvas, { onStatus: setExportStatus, onProgress: setExportProgress });
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
      } catch (err) { setExportStatus(err.message); }
    }
  }), [isRecording, gifOptions]);

  // Demo tiles play-through.
  const onDemo = useCallback(({ text, result }) => {
    setFirewallResult(result);
    setState((s) => mapTRIBEToRegions(s, result));
    recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
      pressure: result.manipulationPressure,
      confidence: result.confidence
    });
    toastInfo('Demo scan applied — watch the brain react');
  }, []);

  // EEG handlers.
  const onConnectMuse = useCallback(async () => {
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
  }, []);

  const onConnectSerial = useCallback(async () => {
    try {
      await connectSerialEEG();
      setEegStatus({ connected: true, label: 'Serial EEG bridge connected' });
      setMode('eeg');
      toastSuccess('Serial EEG connected');
    } catch (err) {
      setEegStatus({ connected: false, label: err.message });
    }
  }, []);

  const onInjectMockEeg = useCallback(() => {
    setState((s) => applyMockEEG(s));
    setEegStatus({ connected: true, label: 'Mock EEG injected into THL/PFC/HPC' });
    setMode('eeg');
    toastInfo('Mock EEG data injected');
  }, []);

  const onGifChange = useCallback((key, value) => {
    setGifOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onReplayBurst = useCallback(() => {
    setState((s) => ({ ...s, burst: 20, tick: 0, scenario: 'Replay Burst' }));
  }, []);

  const modeLabel = mode === 'tribe' ? 'TRIBE v2' : mode === 'eeg' ? 'Live EEG' : 'Simulation';

  const session = {
    // state
    state, mode, quality, knowledgeMode, affectOverride, lastAffectDecode,
    firewallResult, trends, timelineFrame, timelineIndex,
    isRecording, exportStatus, exportProgress, gifOptions, eegStatus,
    // url rehydration
    initialFirewallScan, incomingImmunity, incomingAutopsy, incomingDaily,
    // setters used directly
    onScrubTimeline: setTimelineIndex,
    onSelectRegion,
    onShowHelp: () => setShowKbHelp(true),
    onGifChange,
    onReplayBurst,
    // bundles
    onControls: controls,
    onDemo,
    // brain mutations
    onApplyFirewall, onApplyGemma, onApplyGemini,
    onApplyKnowledge, onApplyCodeBrain, onApplyConversation,
    onApplyRag, onApplyMultimodalRag, onApplyFusedRag,
    onApplyAffect, onApplyAffectActivation, onDecodeAffect: setLastAffectDecode,
    onApplyNT, onApplyTribeFrame: applyTribeFrame, onApplyPluginResults,
    onPromoteEvolve, onPromoteAttack,
    onRestoreSnapshot, onRemoteState,
    // mode wiring
    onSetMode: setMode,
    // EEG
    onConnectMuse, onConnectSerial, onInjectMockEeg
  };

  return (
    <div className="app-shell shell-host">
      <div className="backdrop" />
      <ToastContainer />
      <KeyboardHelp open={showKbHelp} onClose={() => setShowKbHelp(false)} />
      <OnboardingWalkthrough />
      <ErrorBoundary name="Command Palette"><CommandPalette /></ErrorBoundary>
      <UpdateBanner />

      <AppShell session={session} modeLabel={modeLabel} />
    </div>
  );
}
