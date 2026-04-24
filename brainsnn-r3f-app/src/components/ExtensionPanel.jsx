import React, { useState } from 'react';
import {
  extensionFiles, EXTENSION_PERMISSIONS, EXTENSION_NAME, EXTENSION_VERSION,
} from '../utils/extensionSource';

/**
 * Layer 81 — Browser Extension Generator panel.
 */
export default function ExtensionPanel() {
  const [copied, setCopied] = useState('');
  const files = extensionFiles();

  function download(file) {
    const blob = new Blob([file.content], { type: file.mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(file) {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(file.name);
      setTimeout(() => setCopied(''), 2500);
    } catch {
      window.prompt(`Copy ${file.name}:`, file.content);
    }
  }

  return (
    <section className="panel panel-pad extension-panel">
      <div className="eyebrow">Layer 81 · browser extension</div>
      <h2>{EXTENSION_NAME} · v{EXTENSION_VERSION}</h2>
      <p className="muted">
        Minimal Manifest V3 extension that adds a right-click menu item
        to send any selected text into the Cognitive Firewall. Download
        the source files, drop them in a folder, then Load Unpacked in
        chrome://extensions — takes 30 seconds.
      </p>

      <div className="muted small-note">
        Permissions requested: <strong>{EXTENSION_PERMISSIONS.join(', ')}</strong>
      </div>

      <div style={{ marginTop: 12 }}>
        {files.map((file) => (
          <div
            key={file.name}
            style={{
              padding: '10px 12px',
              borderLeft: '3px solid #5ad4ff',
              background: 'rgba(90,212,255,0.04)',
              borderRadius: 6,
              marginTop: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontFamily: 'monospace' }}>{file.name}</strong>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-sm" onClick={() => download(file)}>Download</button>
                <button className="btn-sm" onClick={() => copy(file)}>
                  {copied === file.name ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            </div>
            <pre
              style={{
                marginTop: 8,
                padding: 10,
                borderRadius: 6,
                background: 'rgba(0,0,0,0.24)',
                fontSize: 11,
                lineHeight: 1.4,
                maxHeight: 160,
                overflow: 'auto',
              }}
            >
              {file.content}
            </pre>
          </div>
        ))}
      </div>

      <p className="muted small-note" style={{ marginTop: 12 }}>
        Works in Chrome, Edge, Brave, Arc, and any other Chromium-based
        browser. Firefox support will need a MV2 variant — fork welcome.
      </p>
    </section>
  );
}
