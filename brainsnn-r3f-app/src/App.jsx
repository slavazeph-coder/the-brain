import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
// Code-split the WebGL scene: lazy-loading BrainScene keeps the ~300KB-gzip
// three.js stack out of the initial bundle, so the hero + controls paint
// immediately. (SplitBrainView, which also pulls in three.js, is lazy-loaded
// within NeuroSection.)
const BrainScene = lazy(() => import("./components/BrainScene"));

// Persistent chrome + the default "insights" section ship in the entry chunk.
import ControlsBar from "./components/ControlsBar";
import AppHeader from "./components/AppHeader";
import SimControls from "./components/SimControls";
import InspectorPanel from "./components/InspectorPanel";
import ActivityCharts from "./components/ActivityCharts";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import NarrativePanel from "./components/NarrativePanel";
import ToastContainer from "./components/ToastContainer";
import KeyboardHelp from "./components/KeyboardHelp";
import OnboardingWalkthrough from "./components/OnboardingWalkthrough";
import CommandPalette from "./components/CommandPalette";
import HotkeyMap from "./components/HotkeyMap";
import ErrorBoundary from "./components/ErrorBoundary";
import DemoTiles from "./components/DemoTiles";
import ScanHero from "./components/ScanHero";
import SectionNav from "./components/SectionNav";

// The seven non-default sections each become their own chunk, fetched on first
// activation (see the "visited" latch in App). React.lazy fires the dynamic
// import the moment its element RENDERS — so the latch, not just `hidden`
// (which is only display:none), is what keeps these out of the initial load.
const FirewallSection = lazy(
  () => import("./components/sections/FirewallSection"),
);
const KnowledgeSection = lazy(
  () => import("./components/sections/KnowledgeSection"),
);
const DefenseSection = lazy(
  () => import("./components/sections/DefenseSection"),
);
const ToolsSection = lazy(() => import("./components/sections/ToolsSection"));
const StudioSection = lazy(() => import("./components/sections/StudioSection"));
const NeuroSection = lazy(() => import("./components/sections/NeuroSection"));
const IoSection = lazy(() => import("./components/sections/IoSection"));

import { registerServiceWorker } from "./utils/pwa";
import { isWebGLAvailable } from "./utils/webgl";
import { registerTheme } from "./utils/theme";
import { decodeStateFromHash } from "./utils/shareState";
import { decodeReaction } from "./utils/reactionCard";
import { REGION_INFO } from "./data/network";
import { mapTRIBEToRegions } from "./utils/cognitiveFirewall";
import { registerBridgeContext, logToolCall } from "./utils/mcpBridge";
import {
  recordEvent as recordImmunity,
  IMMUNITY_EVENTS,
} from "./utils/immunityScore";
import {
  applyScenario,
  createInitialState,
  resetState,
  simulateStep,
} from "./utils/sim";
import {
  registerDreamProviders,
  startDreamMonitor,
  stopDreamMonitor,
  markActivity,
} from "./utils/dreamMode";
import { startCanvasRecording } from "./utils/recording";
import { listSnapshots, loadSnapshot, saveSnapshot } from "./utils/snapshots";
import { registerShortcuts } from "./utils/shortcuts";
import { trendDirection } from "./utils/analytics";
import { toastSuccess, toastInfo } from "./utils/toastStore";
import {
  NAVIGATE_LAYER_EVENT,
  pollForPanel,
  scrollToLayerPanel,
} from "./utils/panelNav";
import { sectionForLayer } from "./utils/sectionRegistry";

/**
 * Fallback shown while a section's chunk is in flight. Reuses the existing
 * `.viewer-loading` styling from the 3D viewer's Suspense fallback.
 */
function SectionLoading() {
  return (
    <div className="viewer-loading" role="status">
      <span className="viewer-loading-dot" />
      Loading section…
    </div>
  );
}

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
        tick: shared.tick || 0,
      };
    }
    return createInitialState();
  });
  const [mode, setMode] = useState("simulation");
  const [activeSection, setActiveSection] = useState("insights");
  // "Visited" latch: which sections have been activated at least once. A
  // section is only rendered once it has been visited, so its lazy chunk loads
  // on first activation — never on initial page load. Once rendered it stays
  // mounted (toggled via `hidden`), so panel state + sockets survive tab
  // switches. See the gated <Suspense> blocks in the render below.
  const [visited, setVisited] = useState(() => new Set([activeSection]));
  const [eegStatus, setEegStatus] = useState({
    connected: false,
    label: "No device connected",
  });
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [exportStatus, setExportStatus] = useState("idle");
  const [exportProgress, setExportProgress] = useState(0);
  const [quality, setQuality] = useState("high");
  // One-time probe — WebGL support can't change without a page reload. A lazy
  // useState initializer keeps the DOM query out of re-renders without the
  // extra commit a useEffect-based probe would cost.
  const [webglOk] = useState(isWebGLAvailable);
  const [gifOptions, setGifOptions] = useState({
    trimStart: 0,
    trimDuration: 2.5,
    fps: 12,
    width: 720,
  });
  const [showKbHelp, setShowKbHelp] = useState(false);
  const [firewallResult, setFirewallResult] = useState(null);
  // Seeds the ScanHero scorecard from a tapped demo tile (nonce re-fires the
  // reveal even when the same tile is tapped twice).
  const [scanSeed, setScanSeed] = useState(null);
  const [incomingImmunityCard] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("i") || null;
    } catch {
      return null;
    }
  });
  const [incomingAutopsyHash] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("a") || null;
    } catch {
      return null;
    }
  });
  const [incomingDailyHash] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("d") || null;
    } catch {
      return null;
    }
  });
  const [initialFirewallScan, setInitialFirewallScan] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const hash = params.get("r");
      if (!hash) return null;
      const reaction = decodeReaction(hash);
      if (!reaction || !reaction.text) return null;
      const score = {
        emotionalActivation: reaction.emotionalActivation,
        cognitiveSuppression: reaction.cognitiveSuppression,
        manipulationPressure: reaction.manipulationPressure,
        trustErosion: reaction.trustErosion,
        evidence: [],
        confidence: "shared",
        recommendedAction: "Rehydrated from shared reaction link.",
        source: "shared-link",
      };
      return { text: reaction.text, result: score, autoApply: true };
    } catch {
      return null;
    }
  });
  const [knowledgeMode, setKnowledgeMode] = useState(false);
  const [affectOverride, setAffectOverride] = useState(null);
  const [lastAffectDecode, setLastAffectDecode] = useState(null);
  const recorderRef = useRef(null);
  const historyRef = useRef([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track per-region history for analytics trends
  useEffect(() => {
    historyRef.current.push({ regions: { ...state.regions } });
    if (historyRef.current.length > 60) historyRef.current.shift();
  }, [state.tick]);

  // Layer 91 — register service worker once on mount
  // Layer 98 — apply theme + a11y prefs
  useEffect(() => {
    registerServiceWorker();
    registerTheme();
  }, []);

  // Layer 19 — register MCP bridge context once
  useEffect(() => {
    registerBridgeContext({
      getState: () => stateRef.current,
      setState,
      getHistory: () => historyRef.current,
      applyScenarioKey: (key) => setState((s) => applyScenario(s, key)),
      triggerBurst: () =>
        setState((s) => ({ ...s, burst: 20, scenario: "MCP Sensory Burst" })),
      resetBrain: () => setState(resetState()),
      onToolCall: (entry) => logToolCall(entry),
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
      narrate: (text) => toastInfo(text),
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
    const QUALITY_CYCLE = ["low", "high", "ultra"];
    return registerShortcuts({
      toggleRun: () => setState((s) => ({ ...s, running: !s.running })),
      burst: () => {
        setState((s) => ({ ...s, burst: 20, scenario: "Sensory Burst" }));
        toastInfo("Sensory burst triggered");
      },
      reset: () => {
        setState(resetState());
        setMode("simulation");
        toastInfo("Brain state reset");
      },
      modeSimulation: () => {
        setMode("simulation");
        toastInfo("Switched to Simulation mode");
      },
      modeTribe: () => {
        setMode("tribe");
        toastInfo("Switched to TRIBE v2 mode");
      },
      modeEeg: () => {
        setMode("eeg");
        toastInfo("Switched to EEG mode");
      },
      snapshot: () => {
        saveSnapshot(state);
        toastSuccess("Snapshot saved");
      },
      record: () => {
        const canvas = document.querySelector("canvas");
        if (!canvas) return;
        if (!isRecording) {
          try {
            recorderRef.current = startCanvasRecording(canvas, {
              onStatus: setExportStatus,
              onProgress: setExportProgress,
            });
            setIsRecording(true);
            toastInfo("Recording started");
          } catch (err) {
            setExportStatus(err.message);
          }
        } else if (recorderRef.current) {
          recorderRef.current.stop();
          recorderRef.current = null;
          setIsRecording(false);
          setExportStatus("WebM ready");
          setExportProgress(100);
          toastSuccess("Recording saved");
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
      showHelp: () => setShowKbHelp(true),
    });
  }, [state, isRecording]);

  // Simulation loop — only active in simulation mode
  useEffect(() => {
    if (mode !== "simulation") return;
    const id = setInterval(() => {
      setState((prev) => simulateStep(prev));
    }, 180);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    setTimelineIndex(Math.max(0, state.history.length - 1));
  }, [state.history.length]);

  // Latch the active section as "visited" the first time it's shown, so its
  // lazy chunk mounts now and stays mounted thereafter.
  useEffect(() => {
    setVisited((prev) => {
      if (prev.has(activeSection)) return prev;
      const next = new Set(prev);
      next.add(activeSection);
      return next;
    });
  }, [activeSection]);

  // Cross-section layer navigation (⌘K palette, TOC chips). Switch to the
  // owning section first, then poll: the section chunk and any per-panel
  // lazy placeholders need a beat to mount before the scroll can land.
  useEffect(() => {
    function onNavigate(e) {
      const layerId = e.detail?.layerId;
      if (layerId == null) return;
      const section = sectionForLayer(layerId);
      if (section) setActiveSection(section);
      // Poll after the state change commits — never scroll synchronously,
      // the target section is display:none until React re-renders.
      pollForPanel(layerId).then((el) => {
        if (el) {
          scrollToLayerPanel(layerId);
        } else if (section) {
          toastInfo("Section opened — that panel is still loading");
        }
      });
    }
    window.addEventListener(NAVIGATE_LAYER_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_LAYER_EVENT, onNavigate);
  }, []);

  const stats = useMemo(
    () => ({
      mean:
        state.mean ??
        Object.values(state.regions).reduce((a, v) => a + v, 0) /
          Object.keys(state.regions).length,
      plasticity:
        state.plasticity ??
        Object.values(state.weights).reduce((a, v) => a + v, 0) /
          Object.keys(state.weights).length,
    }),
    [state],
  );

  const timelineFrame =
    state.history[timelineIndex] ?? state.history[state.history.length - 1];

  const modeLabel =
    mode === "tribe" ? "TRIBE v2" : mode === "eeg" ? "Live EEG" : "Simulation";

  return (
    <div className="app-shell">
      <div className="backdrop" />

      {/* Global overlays */}
      <ToastContainer />
      <KeyboardHelp open={showKbHelp} onClose={() => setShowKbHelp(false)} />
      <OnboardingWalkthrough />
      <CommandPalette />
      <HotkeyMap />

      <main className="app-layout">
        <section className="main-column">
          <AppHeader />

          <ScanHero
            seed={scanSeed}
            onResult={(score, content) => {
              markActivity();
              setFirewallResult(score);
              setState((s) => mapTRIBEToRegions(s, score));
              setInitialFirewallScan({
                text: content,
                result: score,
                autoApply: false,
              });
              recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
                pressure: score.manipulationPressure,
                confidence: score.confidence,
              });
              toastInfo(
                `Scanned via ${score.source || "regex"} — brain updated`,
              );
            }}
          />

          <DemoTiles
            onPlay={({ text, result }) => {
              markActivity();
              setFirewallResult(result);
              setState((s) => mapTRIBEToRegions(s, result));
              setInitialFirewallScan({ text, result, autoApply: false });
              // Fill the ScanHero scorecard too, so a tap reveals the full
              // verdict + evidence (not just the brain reaction).
              setScanSeed({ text, result, nonce: Date.now() });
              recordImmunity(IMMUNITY_EVENTS.FIREWALL_SCAN, {
                pressure: result.manipulationPressure,
                confidence: result.confidence,
              });
              toastSuccess("Example loaded — here's what BrainSNN found ↑");
            }}
          />

          <section className="viewer-panel panel">
            <div className="viewer-overlay">
              <span className="viewer-chip">Tick {state.tick}</span>
              <span className="viewer-chip">
                Mean firing {stats.mean.toFixed(3)}
              </span>
              <span className="viewer-chip">
                Plasticity {stats.plasticity.toFixed(3)}
              </span>
              <span className="viewer-chip">Selected {state.selected}</span>
              <span className="viewer-chip">Quality {quality}</span>
              <span className="viewer-chip">Mode {modeLabel}</span>
            </div>

            <div className="viewer-canvas-wrap">
              {!webglOk ? (
                <div className="viewer-loading" role="status">
                  Your browser couldn&apos;t start WebGL, so the 3D brain
                  can&apos;t render here — every scan, firewall, and analysis
                  panel below still works. Enabling hardware acceleration (or
                  switching to a recent Chrome / Firefox / Safari) brings the
                  brain back.
                </div>
              ) : (
              <ErrorBoundary name="3D Brain">
              <Suspense
                fallback={
                  <div className="viewer-loading" role="status">
                    <span className="viewer-loading-dot" />
                    Loading the brain…
                  </div>
                }
              >
                <BrainScene
                  regions={state.regions}
                  weights={state.weights}
                  selected={state.selected}
                  quality={quality}
                  knowledgeMode={knowledgeMode}
                  affectOverride={affectOverride}
                  onQualityChange={setQuality}
                  onSelect={(id) =>
                    setState((s) => ({ ...s, selected: id || s.selected }))
                  }
                />
              </Suspense>
              </ErrorBoundary>
              )}
            </div>

            <SimControls>
              <ControlsBar
                state={state}
                isRecording={isRecording}
                exportStatus={exportStatus}
                quality={quality}
                mode={mode}
                onSetMode={setMode}
                onSetQuality={setQuality}
                onToggleRun={() => {
                  markActivity();
                  setState((s) => ({ ...s, running: !s.running }));
                }}
                onBurst={() => {
                  markActivity();
                  setState((s) => ({
                    ...s,
                    burst: 20,
                    scenario: "Sensory Burst",
                  }));
                }}
                onReset={() => {
                  markActivity();
                  setState(resetState());
                  setMode("simulation");
                }}
                onScenario={(key) => {
                  markActivity();
                  setState((s) => applyScenario(s, key));
                  setMode("simulation");
                }}
                onToggleRecording={() => {
                  const canvas = document.querySelector("canvas");
                  if (!canvas) return;
                  if (!isRecording) {
                    try {
                      recorderRef.current = startCanvasRecording(canvas, {
                        onStatus: setExportStatus,
                        onProgress: setExportProgress,
                      });
                      setIsRecording(true);
                    } catch (err) {
                      setExportStatus(err.message);
                    }
                  } else if (recorderRef.current) {
                    recorderRef.current.stop();
                    recorderRef.current = null;
                    setIsRecording(false);
                    setExportStatus("WebM ready");
                    setExportProgress(100);
                  }
                }}
                onExportGif={async () => {
                  const canvas = document.querySelector("canvas");
                  if (!canvas) return;
                  try {
                    if (!recorderRef.current) {
                      recorderRef.current = startCanvasRecording(canvas, {
                        onStatus: setExportStatus,
                        onProgress: setExportProgress,
                      });
                      setIsRecording(true);
                      setTimeout(
                        async () => {
                          if (recorderRef.current) {
                            await recorderRef.current.convertToGif(gifOptions);
                            recorderRef.current = null;
                            setIsRecording(false);
                          }
                        },
                        Math.max(1200, gifOptions.trimDuration * 1000),
                      );
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
            </SimControls>
          </section>

          <section className="lower-grid wide-grid">
            <div className="panel panel-pad metric-grid">
              <div className="metric">
                <small>Regions</small>
                <strong>7</strong>
              </div>
              <div className="metric">
                <small>Connections</small>
                <strong>10</strong>
              </div>
              <div className="metric">
                <small>Scenario</small>
                <strong>{state.scenario}</strong>
              </div>
              <div className="metric">
                <small>Lead region</small>
                <strong>
                  {
                    Object.entries(state.regions).sort(
                      (a, b) => b[1] - a[1],
                    )[0][0]
                  }
                </strong>
              </div>
            </div>

            <div className="panel panel-pad explainer">
              <div className="eyebrow">Selected region</div>
              <h2>
                {state.selected} · {REGION_INFO[state.selected].name}
              </h2>
              <p className="muted">{REGION_INFO[state.selected].role}</p>
              <p className="muted small-note">
                Data source: {modeLabel}. Switch modes to toggle between
                synthetic simulation, TRIBE v2 neural predictions, and live EEG
                input. Press <strong>?</strong> for keyboard shortcuts.
              </p>
            </div>
          </section>

          <SectionNav
            sections={[
              { id: "insights", label: "Insights" },
              { id: "firewall", label: "Scan & Firewall" },
              { id: "knowledge", label: "Knowledge" },
              { id: "defense", label: "Defense" },
              { id: "tools", label: "Tools" },
              { id: "studio", label: "Studio" },
              { id: "neuro", label: "Neuro & RAG" },
              { id: "io", label: "Share & I/O" },
            ]}
            active={activeSection}
            onChange={setActiveSection}
          />

          {/* Default section — ships in the entry chunk, always mounted. */}
          <div className="app-section" hidden={activeSection !== "insights"}>
            <ActivityCharts state={state} />

            <ErrorBoundary name="Analytics Dashboard">
              <AnalyticsDashboard state={state} />
            </ErrorBoundary>

            <NarrativePanel
              state={state}
              trends={trends}
              firewallResult={firewallResult}
            />
          </div>

          {/* Lazy sections — each gated on the "visited" latch so its chunk is
              fetched on first activation, then kept mounted (hidden) so panel
              state/sockets survive tab switches. The outer ErrorBoundary also
              catches chunk-load failures (which Suspense alone does not). */}
          <div className="app-section" hidden={activeSection !== "firewall"}>
            {visited.has("firewall") && (
              <ErrorBoundary name="Scan & Firewall">
                <Suspense fallback={<SectionLoading />}>
                  <FirewallSection
                    mode={mode}
                    setMode={setMode}
                    setState={setState}
                    setFirewallResult={setFirewallResult}
                    initialFirewallScan={initialFirewallScan}
                    incomingDailyHash={incomingDailyHash}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="app-section" hidden={activeSection !== "knowledge"}>
            {visited.has("knowledge") && (
              <ErrorBoundary name="Knowledge">
                <Suspense fallback={<SectionLoading />}>
                  <KnowledgeSection
                    state={state}
                    setState={setState}
                    setKnowledgeMode={setKnowledgeMode}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="app-section" hidden={activeSection !== "defense"}>
            {visited.has("defense") && (
              <ErrorBoundary name="Defense">
                <Suspense fallback={<SectionLoading />}>
                  <DefenseSection
                    incomingImmunityCard={incomingImmunityCard}
                    incomingAutopsyHash={incomingAutopsyHash}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="app-section" hidden={activeSection !== "tools"}>
            {visited.has("tools") && (
              <ErrorBoundary name="Tools">
                <Suspense fallback={<SectionLoading />}>
                  <ToolsSection />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="app-section" hidden={activeSection !== "studio"}>
            {visited.has("studio") && (
              <ErrorBoundary name="Studio">
                <Suspense fallback={<SectionLoading />}>
                  <StudioSection regions={state.regions} />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="app-section" hidden={activeSection !== "neuro"}>
            {visited.has("neuro") && (
              <ErrorBoundary name="Neuro & RAG">
                <Suspense fallback={<SectionLoading />}>
                  <NeuroSection
                    state={state}
                    setState={setState}
                    quality={quality}
                    lastAffectDecode={lastAffectDecode}
                    setAffectOverride={setAffectOverride}
                    setLastAffectDecode={setLastAffectDecode}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>

          <div className="app-section" hidden={activeSection !== "io"}>
            {visited.has("io") && (
              <ErrorBoundary name="Share & I/O">
                <Suspense fallback={<SectionLoading />}>
                  <IoSection
                    state={state}
                    trends={trends}
                    firewallResult={firewallResult}
                    setState={setState}
                    gifOptions={gifOptions}
                    setGifOptions={setGifOptions}
                    exportProgress={exportProgress}
                    exportStatus={exportStatus}
                    timelineIndex={timelineIndex}
                    setTimelineIndex={setTimelineIndex}
                    eegStatus={eegStatus}
                    setEegStatus={setEegStatus}
                    setMode={setMode}
                  />
                </Suspense>
              </ErrorBoundary>
            )}
          </div>
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
