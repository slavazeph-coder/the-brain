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

const WS_URL = process.env.BRAINSNN_WS_URL || 'ws://localhost:7654';
const ROOM = process.env.BRAINSNN_ROOM || 'mcp-bridge';
const REQUEST_TIMEOUT_MS = 5000;

const NativeWebSocket = globalThis.WebSocket;

const LOCAL_POLICY_DEFAULTS = {
  blockOnPromptInjection: true,
  redactPII: true,
  blockOnSecrets: true,
  allowToolDestructive: false,
  remoteEnabled: false
};

let localPolicy = { ...LOCAL_POLICY_DEFAULTS };
let localLobsterLog = [];

const INJECTION_PATTERNS = [
  /ignore (all|previous|prior) (instructions|prompts|rules)/i,
  /disregard (the|your) (system|developer) (prompt|message|instructions?)/i,
  /reveal (your|the) (system|hidden|secret) (prompt|instructions?|rules?)/i,
  /jailbreak.*?(prompt|mode|instructions)/i,
  /\bdeveloper mode\b.*(?:enabled|activated|on)/i
];

const SECRET_PATTERNS = [
  { name: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'google_api_key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: 'openai_key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'anthropic_key', re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/ },
  { name: 'github_token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'slack_token', re: /\bxox[abps]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'private_key', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ }
];

const PII_PATTERNS = [
  { name: 'email', re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replace: '[email]' },
  { name: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g, replace: '[ssn]' },
  { name: 'credit_card', re: /\b(?:\d[ -]?){13,19}\b/g, replace: '[card]' },
  { name: 'phone_us', re: /\b\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g, replace: '[phone]' }
];

const LOCAL_TOOLS = new Set(['lobster_trap_inspect', 'lobster_trap_log', 'lobster_trap_policy', 'test_hypothesis']);

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
  { name: 'impact_analysis', description: 'Blast-radius analysis for a region through the connectome.', inputSchema: { type: 'object', properties: { region: { type: 'string' } }, required: ['region'] } },
  { name: 'run_autopsy', description: 'Layer 36 — per-speaker cognitive autopsy of a transcript.', inputSchema: { type: 'object', properties: { transcript: { type: 'string' } }, required: ['transcript'] } },
  { name: 'counter_draft', description: 'Layer 42 — neutralize manipulative text (prefers Gemini, falls back to Gemma, then local).', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'run_diff', description: 'Layer 47 — side-by-side pressure delta for two texts.', inputSchema: { type: 'object', properties: { labelA: { type: 'string' }, textA: { type: 'string' }, labelB: { type: 'string' }, textB: { type: 'string' } }, required: ['textA', 'textB'] } },
  { name: 'detect_archetypes', description: 'Layer 48 — ad / political / cult / phishing archetype detection.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'compare_rulesets', description: 'Layer 74 — score text under defaults vs active rules; report evidence delta.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'get_immunity', description: 'Layer 23 — current Cognitive Immunity score + breakdown.', inputSchema: { type: 'object', properties: {} } },
  { name: 'test_hypothesis', description: 'Layer 62 — structured belief testing across evidence items.', inputSchema: { type: 'object', properties: { type: { type: 'string', description: 'Hypothesis id — gaslighting / darvo / love-bombing / guilt-trip / phishing / cult-recruitment / political-attack / high-pressure' }, evidenceText: { type: 'string' } }, required: ['type', 'evidenceText'] } },
  { name: 'explain_scan', description: 'Layer 70 — plain-English narration of a Firewall score.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'todays_daily', description: 'Layer 38 — today\'s Daily Firewall Challenge items.', inputSchema: { type: 'object', properties: {} } },
  { name: 'analyze_time_series', description: 'Layer 43 — manipulation-pressure trend over dated messages.', inputSchema: { type: 'object', properties: { raw: { type: 'string' } }, required: ['raw'] } },
  { name: 'issue_receipt', description: 'Layer 46 — deterministic SHA-256 scan receipt.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'lobster_trap_inspect', description: 'Layer 102 — Veea Lobster Trap prompt inspection (injection / secrets / PII). Returns allow / redact / block.', inputSchema: { type: 'object', properties: { prompt: { type: 'string' }, surface: { type: 'string' } }, required: ['prompt'] } },
  { name: 'lobster_trap_log', description: 'Layer 102 — return rolling Lobster Trap audit log (most recent first).', inputSchema: { type: 'object', properties: { limit: { type: 'number' }, action: { type: 'string' } } } },
  { name: 'lobster_trap_policy', description: 'Layer 102 — read or update Lobster Trap enforcement policy.', inputSchema: { type: 'object', properties: { blockOnPromptInjection: { type: 'boolean' }, blockOnSecrets: { type: 'boolean' }, redactPII: { type: 'boolean' }, allowToolDestructive: { type: 'boolean' }, remoteEnabled: { type: 'boolean' } } } }
];

// ---------- WebSocket relay ----------

let ws = null;
let nextId = 1;
const pending = new Map();

function connectWs() {
  if (!NativeWebSocket) {
    log('Native WebSocket unavailable; stdio local tools remain available');
    return;
  }

  try {
    ws = new NativeWebSocket(WS_URL);
  } catch (err) {
    log('WebSocket constructor failed: ' + err.message);
    return;
  }

  ws.onopen = () => {
    log(`Connected to ${WS_URL}`);
    ws.send(JSON.stringify({ type: 'join', room: ROOM, role: 'mcp-server' }));
  };

  ws.onmessage = (event) => {
    try {
      const data = event?.data ?? event;
      const msg = JSON.parse(typeof data === 'string' ? data : data.toString());
      if (msg.type === 'tool_response' && msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg.payload);
      }
    } catch (err) {
      log('Failed to parse WS message: ' + err.message);
    }
  };

  ws.onclose = () => {
    log('WS closed — reconnecting in 3s');
    setTimeout(connectWs, 3000);
  };

  ws.onerror = (err) => log('WS error: ' + (err?.message || 'connection failed'));
}

function callBrowserTool(name, args) {
  return new Promise((resolve) => {
    if (!NativeWebSocket || !ws || ws.readyState !== NativeWebSocket.OPEN) {
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

function makeId() {
  return `lt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function inspectPromptLocal(prompt, surface = 'mcp.preflight') {
  const text = String(prompt || '');
  const reasons = [];
  let action = 'allow';
  let redacted;

  const injection = INJECTION_PATTERNS
    .map((re) => text.match(re)?.[0])
    .filter(Boolean);
  if (injection.length && localPolicy.blockOnPromptInjection) {
    action = 'block';
    reasons.push(`prompt_injection: ${injection.slice(0, 2).join(' | ')}`);
  }

  const secrets = SECRET_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name);
  if (secrets.length && localPolicy.blockOnSecrets) {
    action = 'block';
    reasons.push(`secret_leak: ${secrets.join(', ')}`);
  }

  if (action !== 'block' && localPolicy.redactPII) {
    let out = text;
    const piiHits = [];
    for (const { name, re, replace } of PII_PATTERNS) {
      if (re.test(out)) {
        piiHits.push(name);
        out = out.replace(re, replace);
      }
    }
    if (piiHits.length) {
      action = 'redact';
      redacted = out;
      reasons.push(`pii_redacted: ${piiHits.join(', ')}`);
    }
  }

  const entry = {
    id: makeId(),
    ts: Date.now(),
    surface,
    action,
    reasons,
    score: Math.min(1, injection.length * 0.4 + secrets.length * 0.5 + (action === 'redact' ? 0.2 : 0)),
    sample: text.slice(0, 120),
    redacted
  };
  localLobsterLog.unshift(entry);
  localLobsterLog = localLobsterLog.slice(0, 200);
  return entry;
}

function testHypothesisLocal({ type, evidenceText }) {
  const text = String(evidenceText || '');
  if (!type) return { error: 'unknown hypothesis type' };
  if (!text.trim()) return { error: 'no evidence items' };

  const chunks = text.split(/\n[\-=]{3,}\n+|\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const phishingRe = /\b(click|verify|account|password|suspend|urgent|login|credential|confirm)\b/i;
  const pressureRe = /\b(urgent|now|immediately|last chance|act now|must)\b/i;
  const rows = chunks.map((chunk, idx) => {
    const matches = type === 'phishing'
      ? phishingRe.test(chunk)
      : type === 'high-pressure'
        ? pressureRe.test(chunk)
        : new RegExp(type.replace(/[-_]/g, '\\s+'), 'i').test(chunk);
    return {
      idx,
      text: chunk,
      matches,
      pressure: pressureRe.test(chunk) ? 0.72 : matches ? 0.55 : 0.1,
      templates: [],
      archetypes: type === 'phishing' && matches ? [{ id: 'phishing', label: 'Phishing', score: 1 }] : []
    };
  });
  const supported = rows.filter((r) => r.matches).length;
  const confidence = supported / rows.length;
  const label = confidence >= 0.7 ? 'Supported' : confidence >= 0.4 ? 'Mixed' : confidence > 0.1 ? 'Weak' : 'Refuted';
  return {
    hypothesis: { id: type, label: type.replace(/-/g, ' ') },
    totalEvidence: rows.length,
    supported,
    against: rows.length - supported,
    confidence,
    verdict: { label, color: confidence >= 0.7 ? '#5ee69a' : confidence >= 0.4 ? '#fdab43' : '#dd6974' },
    rows
  };
}

async function callLocalTool(name, args = {}) {
  switch (name) {
    case 'lobster_trap_inspect':
      if (!args.prompt) return { ok: false, error: 'prompt required' };
      return { ok: true, result: inspectPromptLocal(args.prompt, args.surface || 'mcp.preflight') };

    case 'lobster_trap_log': {
      const limit = Math.max(1, Math.min(200, Number(args.limit) || 50));
      const filtered = args.action ? localLobsterLog.filter((e) => e.action === args.action) : localLobsterLog;
      return { ok: true, result: { entries: filtered.slice(0, limit), total: localLobsterLog.length } };
    }

    case 'lobster_trap_policy': {
      const patch = {};
      for (const key of ['blockOnPromptInjection', 'blockOnSecrets', 'redactPII', 'allowToolDestructive', 'remoteEnabled']) {
        if (typeof args[key] === 'boolean') patch[key] = args[key];
      }
      if (Object.keys(patch).length) localPolicy = { ...localPolicy, ...patch };
      return { ok: true, result: { policy: localPolicy, updated: Object.keys(patch).length > 0, changed: Object.keys(patch) } };
    }

    case 'test_hypothesis': {
      if (!args.type || !args.evidenceText) return { ok: false, error: 'type and evidenceText required' };
      return { ok: true, result: testHypothesisLocal(args) };
    }

    default:
      return null;
  }
}

async function callTool(name, args) {
  if (LOCAL_TOOLS.has(name)) return callLocalTool(name, args);
  return callBrowserTool(name, args);
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
    const result = await callTool(name, args || {});
    if (!result.ok) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: result.error } };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
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

rl.on('close', () => {
  try { ws?.close(); } catch {}
  process.exit(0);
});

log(`BrainSNN MCP server starting, relaying via ${WS_URL} (room: ${ROOM})`);
connectWs();
