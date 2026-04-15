import React from 'react';

export default function EEGPanel({ eegStatus, onConnectMuse, onConnectSerial, onInjectMock }) {
  return (
    <section className="panel panel-pad eeg-panel">
      <div className="eyebrow">EEG / Sensor input</div>
      <h2>Live Input Hooks</h2>
      <p className="muted">
        Web apps can connect to supported devices through Web Bluetooth and Web Serial, which makes browser-level sensor input plausible for BrainSNN demos and prototypes.
      </p>

      <div className="eeg-status-row">
        <span className={`status-dot ${eegStatus.connected ? 'online' : ''}`} />
        <span>{eegStatus.label}</span>
      </div>

      <div className="control-actions">
        <button className="btn" onClick={onConnectMuse}>Connect Muse (Web Bluetooth)</button>
        <button className="btn" onClick={onConnectSerial}>Connect Serial</button>
        <button className="btn" onClick={onInjectMock}>Inject mock EEG</button>
      </div>

      <ul className="eeg-notes">
        <li>Use Muse-compatible BLE streams via browser Bluetooth when available.</li>
        <li>Use Web Serial for Arduino or custom sensor bridges.</li>
        <li>Map alpha, beta, or attention signals into THL, PFC, or HPC drive values.</li>
      </ul>
    </section>
  );
}
