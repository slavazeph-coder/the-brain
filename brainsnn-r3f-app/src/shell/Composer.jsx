import React, { useState } from 'react';
import { bus } from './bus';

/**
 * Composer — persistent top input. Paste text or drop a file; the active
 * workspace decides how to consume the payload. Emits `shell:compose`
 * with { text, mode } when the user submits; workspaces subscribe.
 *
 * Designed as a single-line ambient input — for the heavy stuff users
 * still go into the relevant panel's own textarea.
 */
export default function Composer() {
  const [text, setText] = useState('');
  const [mode, setMode] = useState('scan');

  // Each mode routes to the workspace that knows how to handle it.
  const MODE_WORKSPACE = {
    scan: 'defend',
    autopsy: 'defend',
    diff: 'connect',
    rag: 'knowledge'
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const ws = MODE_WORKSPACE[mode];
    if (ws) bus.emit('shell:goto', { workspace: ws });
    // requestAnimationFrame so the target workspace mounts before
    // the compose event arrives at its subscribers.
    requestAnimationFrame(() => bus.emit('shell:compose', { text: trimmed, mode }));
    // Don't clear — let the user iterate.
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="shell-composer">
      <select className="shell-composer-mode" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Composer mode">
        <option value="scan">Scan</option>
        <option value="autopsy">Autopsy</option>
        <option value="diff">Diff</option>
        <option value="rag">Ask</option>
      </select>
      <input
        className="shell-composer-input"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder="Paste text to scan, route through autopsy, diff, or ask the brain… (⌘+Enter)"
      />
      <button className="shell-composer-send" onClick={submit} disabled={!text.trim()}>
        Send
      </button>
    </div>
  );
}
