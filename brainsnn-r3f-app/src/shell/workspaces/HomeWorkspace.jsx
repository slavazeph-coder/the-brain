import React from 'react';
import ControlsBar from '../../components/ControlsBar';
import DemoTiles from '../../components/DemoTiles';

/**
 * Home — landing workspace. Run controls + demo tiles for first-time
 * users. The brain itself lives in BrainViewport which is rendered
 * by AppShell and visible from every workspace.
 */
export default function HomeWorkspace({ session }) {
  const { state, mode, quality, isRecording, exportStatus, gifOptions, onControls, onDemo } = session;

  return (
    <div className="shell-workspace shell-workspace-home">
      <header className="shell-workspace-header">
        <div className="eyebrow">Welcome back</div>
        <h1>The brain is listening.</h1>
        <p className="muted">
          Drop a tweet, an email, a transcript, or a screenshot. Watch the brain react,
          firewall score the manipulation pressure, and 100+ cognitive layers light up.
          Pick a workspace on the left to go deeper.
        </p>
      </header>

      <ControlsBar
        state={state}
        isRecording={isRecording}
        exportStatus={exportStatus}
        quality={quality}
        mode={mode}
        onSetMode={onControls.onSetMode}
        onSetQuality={onControls.onSetQuality}
        onToggleRun={onControls.onToggleRun}
        onBurst={onControls.onBurst}
        onReset={onControls.onReset}
        onScenario={onControls.onScenario}
        onToggleRecording={onControls.onToggleRecording}
        onExportGif={onControls.onExportGif}
      />

      <DemoTiles onPlay={onDemo} />
    </div>
  );
}
