#!/usr/bin/env node
/**
 * BrainSNN MCP stdio server
 *
 * Bridges AI agents (Claude Code, Cursor, Codex, Windsurf) to a running
 * BrainSNN browser session via WebSocket. Proxies JSON-RPC 2.0 tool calls
 * over stdio.
 *
 * Setup:
 *   1. Start BrainSNN: `npm run dev` in brainsnn-r3f-app/
 *   2. Configure VITE_SYNC_WS_URL to point at a WebSocket relay
 *      (ws://localhost:7654 by default — see docs for starting one)
 *   3. Add this server to your agent's MCP config:
 *      {
 *        "mcpServers": {
 *          "brainsnn": {
 *            "command": "node",
 *            "args": ["/path/to/brainsnn-r3f-app/mcp-server/server.js"]
 *          }
 *        }
 *      }
 *
 * Cannibalized from GitNexus's MCP stdio pattern.
 */

import { createInterface } from 'node:readline';
import { WebSocket } from 'node:ws';

const WS_URL = process.env.BRAINSNN_WS_URL || 'ws://localhost:7654';
const ROOM = process.env.BRAINSNN_ROOM || 'mcp-bridge';
const REQUEST_TIMEOUT_MS = 5000;

// ---------- tool catalog (mirror of src/utils/mcpBridge.js) ----------

const TOOLS = [
  { name: 'get_brain_state', description: 'Return current brain region activities, weights, tick, scenario.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_region_info', description: 'Detailed info about a brain region.', inputSchema: { type: 'object', properties: { region: { type: 'string' } }, required: ['region'] } },
  { name: 'list_snapshots', description: 'List saved brain snapshots.', inputSchema: { type: 'object', properties: {} } },
  { name: 'save_snapshot', description: 'Persist current brain state as named snapshot.', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
  { name: 'compare_snapshots', description: 'Diff two snapshots by id.', inputSchema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] } },
  { name: 'scan_content', description: 'Cognitive Firewall manipulation scan.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'apply_scenario', description: 'Apply pre-computed scenario (sensory_burst, memory_replay, emotional_salience, executive).', inputSchema: { type: 'object', properties: { scenario: { type: 'string' } }, required: ['scenario'] } },
  { name: 'trigger_burst', description: 'Fire a sensory burst through the connectome.', inputSchema: { type: 'object', properties: {} } },
  { name: 'reset_brain', description: 'Reset brain to baseline.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_correlations', description: 'Pearson correlation matrix between regions.', inputSchema: { type: 'object', properties: { window: { type: 'number' } } } },
  { name: 'detect_anomaly', description: 'Z-score anomaly detection on recent activity.', inputSchema: { type: 'object', properties: {} } },
  { name: 'classify_knowledge', description: 'Classify text into 7 knowledge domains.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'narrate_state', description: 'Human-readable narration of current brain activity.', inputSchema: { type: 'object', properties: {} } },
  { name: 'impact_analysis', description: 'Blast-radius analysis for a region through the connectome.', inputSchema: { type: 'object', properties: { region: { type: 'string' } }, required: ['region'] } }
];

// ---------- WebSocket relay ----------

let ws = null;
let nextId = 1;
const pending = new Map();

function connectWs() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    log('WebSocket constructor failed: ' + err.message);
    return;
  }

  ws.on('open', () => {
    log(`Connected to ${WS_URL}`);
    ws.send(JSON.stringify({ type: 'join', room: ROOM, role: 'mcp-server' }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'tool_response' && msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg.payload);
      }
    } catch (err) {
      log('Failed to parse WS message: ' + err.message);
    }
  });

  ws.on('close', () => {
    log('WS closed — reconnecting in 3s');
    setTimeout(connectWs, 3000);
  });

  ws.on('error', (err) => log('WS error: ' + err.message));
}

function callBrowserTool(name, args) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      resolve({ ok: false, error: `BrainSNN browser not connected at ${WS_URL}. Is a BrainSNN tab open with live sync enabled?` });
      return;
    }
    const id = nextId++;
    pending.set(id, { resolve });
    ws.send(JSON.stringify({ type: 'tool_call', id, room: ROOM, name, args }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, error: `Tool ${name} timed out after ${REQUEST_TIMEOUT_MS}ms` });
      }
    }, REQUEST_TIMEOUT_MS);
  });
}

// ---------- stdio JSON-RPC handler ----------

function log(msg) {
  // MCP uses stdout for protocol, stderr for logs
  process.stderr.write(`[brainsnn-mcp] ${msg}\n`);
}

function send(response) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'brainsnn', version: '1.0.0' }
      }
    };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const result = await callBrowserTool(name, args || {});
    if (!result.ok) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: result.error } };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }]
      }
    };
  }

  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ---------- main ----------

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const res = await handleRequest(req);
    send(res);
  } catch (err) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error: ' + err.message } });
  }
});

log(`BrainSNN MCP server starting, relaying via ${WS_URL} (room: ${ROOM})`);
connectWs();
