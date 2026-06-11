import React from "react";
import PanelAnchor from "../PanelAnchor";
import SectionHeader from "../SectionHeader";
import VoiceControl from "../VoiceControl";
import PluginPanel from "../PluginPanel";
import LiveSyncPanel from "../LiveSyncPanel";
import SharePanel from "../SharePanel";
import ExportPanel from "../ExportPanel";
import TimelinePanel from "../TimelinePanel";
import EEGPanel from "../EEGPanel";
import { mapTRIBEToRegions } from "../../utils/cognitiveFirewall";
import {
  applyMockEEG,
  connectMuseEEG,
  connectSerialEEG,
  mapEEGToRegions,
  parseMusePacket,
} from "../../utils/eeg";
import { toastInfo, toastSuccess, toastWarning } from "../../utils/toastStore";

/**
 * "Share & I/O" section. Lazy-mounted on first activation, then kept alive via
 * the parent's `hidden` wrapper so EEG connections + export state persist.
 */
export default function IoSection({
  state,
  trends,
  firewallResult,
  setState,
  gifOptions,
  setGifOptions,
  exportProgress,
  exportStatus,
  timelineIndex,
  setTimelineIndex,
  eegStatus,
  setEegStatus,
  setMode,
}) {
  return (
    <>
      <SectionHeader sectionId="io" />

      <PanelAnchor id="l14" title="Voice Narrator">
      <VoiceControl
        state={state}
        trends={trends}
        firewallResult={firewallResult}
      />
      </PanelAnchor>

      <PanelAnchor id="l15" title="Plugins">
      <PluginPanel
        onApplyResults={(combined) => {
          // Map plugin scores to firewall-compatible format if available
          const mapped = {
            emotionalActivation:
              combined.negativity ?? combined.emotionalActivation ?? 0,
            cognitiveSuppression:
              combined.complexity ?? combined.cognitiveSuppression ?? 0,
            manipulationPressure: 1 - (combined.credibility ?? 0.5),
            trustErosion: combined.negativity ?? combined.trustErosion ?? 0,
          };
          setState((s) => mapTRIBEToRegions(s, mapped));
          toastInfo("Plugin analysis applied to brain");
        }}
      />
      </PanelAnchor>

      <PanelAnchor id="l16" title="Live Sync">
      <LiveSyncPanel
        state={state}
        onRemoteState={(remote) => {
          if (remote?.regions) {
            setState((prev) => ({
              ...prev,
              regions: { ...prev.regions, ...remote.regions },
              scenario: remote.scenario || "Remote Sync",
              tick: prev.tick + 1,
            }));
          }
        }}
      />
      </PanelAnchor>

      <PanelAnchor id="l11" title="Share & Embed">
      <SharePanel state={state} />
      </PanelAnchor>

      <PanelAnchor id="export" title="Export">
      <ExportPanel
        {...gifOptions}
        exportProgress={exportProgress}
        exportStatus={exportStatus}
        onChange={(key, value) =>
          setGifOptions((prev) => ({ ...prev, [key]: value }))
        }
      />
      </PanelAnchor>

      <PanelAnchor id="timeline" title="Timeline Replay">
      <TimelinePanel
        history={state.history}
        timelineIndex={timelineIndex}
        onScrub={setTimelineIndex}
        onReplay={() =>
          setState((s) => ({
            ...s,
            burst: 20,
            tick: 0,
            scenario: "Replay Burst",
          }))
        }
      />
      </PanelAnchor>

      <PanelAnchor id="eeg" title="Live EEG">
      <EEGPanel
        eegStatus={eegStatus}
        onConnectMuse={async () => {
          try {
            const result = await connectMuseEEG();
            setEegStatus({
              connected: true,
              label: `Connected via Bluetooth: ${result.deviceName}`,
            });
            setMode("eeg");
            const mockPacket = new DataView(
              new Uint8Array([1, 20, 0, 120, 0, 90, 0, 60]).buffer,
            );
            const parsed = parseMusePacket(mockPacket);
            setState((s) => mapEEGToRegions(s, parsed));
            toastSuccess("Muse EEG connected");
          } catch (err) {
            setEegStatus({ connected: false, label: err.message });
            toastWarning("EEG connection failed");
          }
        }}
        onConnectSerial={async () => {
          try {
            await connectSerialEEG();
            setEegStatus({
              connected: true,
              label: "Serial EEG bridge connected",
            });
            setMode("eeg");
            toastSuccess("Serial EEG connected");
          } catch (err) {
            setEegStatus({ connected: false, label: err.message });
          }
        }}
        onInjectMock={() => {
          setState((s) => applyMockEEG(s));
          setEegStatus({
            connected: true,
            label: "Mock EEG injected into THL/PFC/HPC",
          });
          setMode("eeg");
          toastInfo("Mock EEG data injected");
        }}
      />
      </PanelAnchor>

      <section className="panel panel-pad deploy-panel">
        <div className="eyebrow">Deployment</div>
        <h2>Ready for GitHub Pages and Vercel</h2>
        <p className="muted">
          This project includes deployment configs plus browser-side export
          helpers for shareable demos.
        </p>
      </section>
    </>
  );
}
