import React, { useState } from 'react';
import { BRAIN_TOOLS, handleToolCall, getAuditLog, clearAuditLog } from '../utils/mcpBridge';

/**
 * Layer 19 — MCP Bridge Panel
 *
 * Shows the BrainSNN tool catalog that's exposed to AI agents via MCP.
 * Includes an in-browser tester, audit log, and copy-paste config
 * snippet for Claude Code, Cursor, Codex, and Windsurf.
 */
export default function MCPBridgePanel() {
  const [selectedTool, setSelectedTool] = useState(BRAIN_TOOLS[0].name);
  const [args, setArgs] = useState('{}');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [auditTick, setAuditTick] = useState(0);
  const [showConfig, setShowConfig] = useState(false);

  const tool = BRAIN_TOOLS.find((t) => t.name === selectedTool);

  async function runTool() {
    setBusy(true);
    try {
      const parsedArgs = args.trim() ? JSON.parse(args) : {};
      const r = await handleToolCall(selectedTool, parsedArgs);
      setResult(r);
      setAuditTick((t) => t + 1);
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setBusy(false);
    }
  }

  const audit = getAuditLog();

  const clientConfig = {
    mcpServers: {
      brainsnn: {
        command: 'node',
        args: ['./mcp-server/server.js'],
        env: { BRAINSNN_WS_URL: 'ws://localhost:7654' }
      }
    }
  };

  return (
    <section className="panel panel-pad mcp-panel">
      <div className="eyebrow">Layer 19</div>
      <h2>MCP Brain Bridge</h2>
      <p className="muted">
        Exposes this running brain as {BRAIN_TOOLS.length} MCP tools. Cannibalized from GitNexus's
        tool-catalog pattern — pre-computed relational intelligence, single-call context, not multi-query chains.
        AI agents (Claude Code, Cursor, Codex, Windsurf) can read and steer the brain through JSON-RPC.
      </p>

      <div className="mcp-catalog">
        <div className="mcp-tool-list">
          {BRAIN_TOOLS.map((t) => (
            <button
              key={t.name}
              className={`mcp-tool-chip ${selectedTool === t.name ? 'active' : ''}`}
              onClick={() => setSelectedTool(t.name)}
            >
              {t.name}
            </button>
          ))}
        </div>

        {tool && (
          <div className="mcp-tool-detail">
            <strong>{tool.name}</strong>
            <p className="muted small-note">{tool.description}</p>
            <label className="muted small-note">Arguments (JSON):</label>
            <textarea
              className="mcp-args-input"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder='{"region": "PFC"}'
              rows={3}
            />
            <button className="primary" onClick={runTool} disabled={busy}>
              {busy ? 'Running…' : `Call ${tool.name}`}
            </button>

            {result && (
              <pre className="mcp-result">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      <div className="mcp-audit">
        <div className="mcp-audit-header">
          <strong>Audit log</strong>
          <button className="ghost small" onClick={() => { clearAuditLog(); setAuditTick((t) => t + 1); }}>
            Clear
          </button>
        </div>
        {audit.length === 0 && <p className="muted small-note">No tool calls yet.</p>}
        {audit.slice(0, 8).map((entry, i) => (
          <div key={i} className={`mcp-audit-row ${entry.ok ? 'ok' : 'err'}`}>
            <span className="mcp-audit-name">{entry.name}</span>
            <span className="mcp-audit-ms">{entry.ms}ms</span>
            <span className="mcp-audit-status">{entry.ok ? 'ok' : 'err'}</span>
          </div>
        ))}
      </div>

      <div className="mcp-config">
        <button className="ghost small" onClick={() => setShowConfig((s) => !s)}>
          {showConfig ? 'Hide' : 'Show'} Claude Code config
        </button>
        {showConfig && (
          <>
            <p className="muted small-note">
              Add to <code>~/.config/claude-code/mcp.json</code> (or run <code>claude mcp add</code>):
            </p>
            <pre className="mcp-config-snippet">
              {JSON.stringify(clientConfig, null, 2)}
            </pre>
            <p className="muted small-note">
              Requires running <code>node mcp-server/server.js</code> in a separate terminal.
              See <code>mcp-server/README.md</code>.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
