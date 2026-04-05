import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrainScene from './components/BrainScene';
import ControlsBar from './components/ControlsBar';
import InspectorPanel from './components/InspectorPanel';
import ActivityCharts from './components/ActivityCharts';
import EEGPanel from './components/EEGPanel';
import TimelinePanel from './components/TimelinePanel';
import ExportPanel from './components/ExportPanel';
import TribePanel from './components/TribePanel';
import { REGION_INFO } from './data/network';
import { applyScenario, createInitialState, resetState, simulateStep } from './utils/sim';
import { applyMockEEG, connectMuseEEG, connectSerialEEG, mapEEGToRegions, parseMusePacket } from './utils/eeg';
import { startCanvasRecording } from './utils/recording';

export default function App() {
  const [state, setState] = useState(() => createInitialState());
  const [mode, setMode] = useState('simulation');
  const [eegStatus, setEegStatus] = useState({ connected: false, label: 'No device connected' });
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [exportStatus, setExportStatus] = useState('idle');
  const [exportProgress, setExportProgress] = useState(0);
  const [quality, setQuality] = useState('high');
  const [gifOptions, setGifOptions] = useState({ trimStart: 0, trimDuration: 2.5, fps: 12, width: 720 });
  const recorderRef = useRef(null);

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
        scenario: 'TRIBE v2',
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
            onToggleRun={() => setState((s) => ({ ...s, running: !s.running }))}
            onBurst={() => setState((s) => ({ ...s, burst: 20, scenario: 'Sensory Burst' }))}
            onReset={() => { setState(resetState()); setMode('simulation'); }}
            onScenario={(key) => { setState((s) => applyScenario(s, key)); setMode('simulation'); }}
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
              </p>
            </div>
          </section>

          <ActivityCharts state={state} />

          <TribePanel
            mode={mode}
            onApplyFrame={applyTribeFrame}
            onSetMode={setMode}
          />

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
              } catch (err) {
                setEegStatus({ connected: false, label: err.message });
              }
            }}
            onConnectSerial={async () => {
              try {
                await connectSerialEEG();
                setEegStatus({ connected: true, label: 'Serial EEG bridge connected' });
                setMode('eeg');
              } catch (err) {
                setEegStatus({ connected: false, label: err.message });
              }
            }}
            onInjectMock={() => {
              setState((s) => applyMockEEG(s));
              setEegStatus({ connected: true, label: 'Mock EEG injected into THL/PFC/HPC' });
              setMode('eeg');
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
