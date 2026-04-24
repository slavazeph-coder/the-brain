/**
 * Layer 19 — MCP Brain Bridge
 *
 * Exposes BrainSNN state, snapshots, firewall, and knowledge brain as
 * MCP-style tools so AI agents (Claude Code, Cursor, Codex, Windsurf)
 * can read and steer the running brain via JSON-RPC.
 *
 * Cannibalized from GitNexus's MCP tool catalog pattern:
 * pre-computed relational intelligence exposed as single-call tools
 * instead of multi-query exploration chains.
 */

import { listSnapshots, saveSnapshot, loadSnapshot, compareSnapshots } from './snapshots';
import { scoreContent } from './cognitiveFirewall';
import { correlationMatrix, detectAnomalies, buildRegionTimeseries } from './analytics';
import { classifyContent } from '../data/knowledgeGraph';
import { generateNarrative } from './narrative';
import { REGION_INFO } from '../data/network';
// Layer 82 — tools surfacing the post-L19 layer surface
import { runAutopsy } from './autopsy';
import { counterDraft } from './counterDraft';
import { runDiff } from './diffMode';
import { detectArchetypes } from './adTransparency';
import { compareRulesets } from './comparator';
import { getImmunityState } from './immunityScore';
import { testHypothesis } from './hypothesis';
import { explain as explainScore } from './explanation';
import { mergeTemplateResults } from './semanticTemplates';
import { pickTodaysChallenge } from './dailyChallenge';
import { analyzeTimeSeries } from './timeSeries';
import { issueReceipt } from './receipt';

// ---------- tool catalog ----------

export const BRAIN_TOOLS = [
  {
    name: 'get_brain_state',
    description: 'Return the current brain state: 7 region activities, connection weights, tick, scenario, selected region.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_region_info',
    description: 'Return detailed info about a specific brain region (CTX, HPC, THL, AMY, BG, PFC, CBL).',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string', enum: ['CTX','HPC','THL','AMY','BG','PFC','CBL'] } },
      required: ['region']
    }
  },
  {
    name: 'list_snapshots',
    description: 'List all saved brain snapshots with id, name, timestamp, scenario, summary.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'save_snapshot',
    description: 'Persist the current brain state as a named snapshot.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Human label for the snapshot' } },
      required: []
    }
  },
  {
    name: 'compare_snapshots',
    description: 'Diff two snapshots by id, return per-region delta and top movers.',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a', 'b']
    }
  },
  {
    name: 'scan_content',
    description: 'Run the Cognitive Firewall against text. Returns manipulation scores, evidence, recommended action.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Content to analyze' } },
      required: ['text']
    }
  },
  {
    name: 'apply_scenario',
    description: 'Switch the brain to a pre-computed scenario (sensory_burst, memory_replay, emotional_salience, executive).',
    inputSchema: {
      type: 'object',
      properties: { scenario: { type: 'string', enum: ['sensory_burst','memory_replay','emotional_salience','executive'] } },
      required: ['scenario']
    }
  },
  {
    name: 'trigger_burst',
    description: 'Fire a sensory burst through the connectome (spikes all regions briefly).',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'reset_brain',
    description: 'Reset the brain to baseline state.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_correlations',
    description: 'Return the Pearson correlation matrix between brain regions over the last N ticks.',
    inputSchema: {
      type: 'object',
      properties: { window: { type: 'number', default: 40 } },
      required: []
    }
  },
  {
    name: 'detect_anomaly',
    description: 'Z-score anomaly detection — returns regions currently firing >2σ above their recent mean.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'classify_knowledge',
    description: 'Classify text into the 7 knowledge domains (mapped onto brain regions).',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'narrate_state',
    description: 'Generate a human-readable narration of what the brain is doing right now.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'impact_analysis',
    description: 'Blast-radius analysis — given a region, return which other regions are most affected through the connectome.',
    inputSchema: {
      type: 'object',
      properties: { region: { type: 'string' } },
      required: ['region']
    }
  },
  // ---------- Layer 82 — expose post-L19 layer surface ----------
  {
    name: 'run_autopsy',
    description: 'Layer 36 — per-speaker cognitive profile from a multi-speaker transcript.',
    inputSchema: {
      type: 'object',
      properties: { transcript: { type: 'string' } },
      required: ['transcript']
    }
  },
  {
    name: 'counter_draft',
    description: 'Layer 42 — rewrite manipulative text as neutral while preserving information. Uses Gemma when configured, local substitution otherwise.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'run_diff',
    description: 'Layer 47 — compare two texts (A vs B) for manipulation pressure; returns per-side scores + delta.',
    inputSchema: {
      type: 'object',
      properties: {
        textA: { type: 'string' }, textB: { type: 'string' },
        labelA: { type: 'string' }, labelB: { type: 'string' }
      },
      required: ['textA', 'textB']
    }
  },
  {
    name: 'detect_archetypes',
    description: 'Layer 48 — return matched propaganda archetypes (phishing, cult, FOMO, etc.) for a text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'compare_rulesets',
    description: 'Layer 74 — run the same text through the current DEFAULT_RULES and activeRules; returns pressure delta + evidence diff.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'get_immunity',
    description: 'Layer 23 — return the user\'s Cognitive Immunity score, streak, and recent event log.',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'test_hypothesis',
    description: 'Layer 62 — score evidence for/against a named hypothesis (gaslighting, DARVO, phishing, cult, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Hypothesis id — gaslighting / darvo / love-bombing / guilt-trip / phishing / cult-recruitment / political-attack / high-pressure' },
        evidenceText: { type: 'string' }
      },
      required: ['type', 'evidenceText']
    }
  },
  {
    name: 'explain_scan',
    description: 'Layer 70 — plain-English narrative of why a scan scored how it did. Returns a paragraph + bullets.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  },
  {
    name: 'todays_daily',
    description: 'Layer 38 — return the 3 items for today\'s Daily Firewall Challenge (same for everyone worldwide on UTC day).',
    inputSchema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'analyze_time_series',
    description: 'Layer 43 — chronological manipulation-pressure trend. Input: newline-separated dated messages. Returns slope, trend tier, peak, escalations.',
    inputSchema: {
      type: 'object',
      properties: { raw: { type: 'string' } },
      required: ['raw']
    }
  },
  {
    name: 'issue_receipt',
    description: 'Layer 46 — generate a deterministic, verifiable scan receipt for a piece of text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    }
  }
];

// ---------- bridge state ----------

let bridgeContext = {
  getState: () => null,
  setState: () => {},
  getHistory: () => [],
  applyScenarioKey: () => {},
  triggerBurst: () => {},
  resetBrain: () => {},
  onToolCall: null
};

/**
 * Wire the bridge to the running React app. Call once from App.jsx.
 */
export function registerBridgeContext(ctx) {
  bridgeContext = { ...bridgeContext, ...ctx };
  if (typeof window !== 'undefined') {
    window.__brainsnn_mcp__ = {
      tools: BRAIN_TOOLS,
      call: handleToolCall,
      listTools: () => BRAIN_TOOLS.map((t) => ({ name: t.name, description: t.description }))
    };
  }
}

// ---------- dispatch ----------

export async function handleToolCall(name, args = {}) {
  const t0 = Date.now();
  try {
    const result = await dispatch(name, args);
    if (bridgeContext.onToolCall) {
      bridgeContext.onToolCall({ name, args, result, ms: Date.now() - t0, ok: true });
    }
    return { ok: true, result };
  } catch (err) {
    const payload = { ok: false, error: err.message || String(err) };
    if (bridgeContext.onToolCall) {
      bridgeContext.onToolCall({ name, args, result: payload, ms: Date.now() - t0, ok: false });
    }
    return payload;
  }
}

async function dispatch(name, args) {
  const state = bridgeContext.getState();
  switch (name) {
    case 'get_brain_state': {
      if (!state) throw new Error('Brain not initialized');
      return {
        regions: state.regions,
        weights: state.weights,
        tick: state.tick,
        scenario: state.scenario,
        selected: state.selected,
        mean: state.mean,
        plasticity: state.plasticity
      };
    }

    case 'get_region_info': {
      const info = REGION_INFO[args.region];
      if (!info) throw new Error(`Unknown region: ${args.region}`);
      return {
        region: args.region,
        name: info.name,
        role: info.role,
        color: info.color,
        currentActivity: state?.regions?.[args.region] ?? null
      };
    }

    case 'list_snapshots':
      return { snapshots: listSnapshots() };

    case 'save_snapshot': {
      if (!state) throw new Error('No state to snapshot');
      const snap = saveSnapshot(state, args.name || `MCP snapshot ${new Date().toLocaleTimeString()}`);
      return { id: snap.id, name: snap.name, timestamp: snap.timestamp };
    }

    case 'compare_snapshots': {
      const a = loadSnapshot(args.a);
      const b = loadSnapshot(args.b);
      if (!a || !b) throw new Error('Snapshot not found');
      return compareSnapshots(a, b);
    }

    case 'scan_content':
      if (!args.text || args.text.length < 3) throw new Error('Text too short');
      return scoreContent(args.text);

    case 'apply_scenario':
      bridgeContext.applyScenarioKey(args.scenario);
      return { applied: args.scenario };

    case 'trigger_burst':
      bridgeContext.triggerBurst();
      return { triggered: true };

    case 'reset_brain':
      bridgeContext.resetBrain();
      return { reset: true };

    case 'get_correlations': {
      const history = bridgeContext.getHistory();
      const series = buildRegionTimeseries(history, args.window || 40);
      return { matrix: correlationMatrix(series), window: args.window || 40 };
    }

    case 'detect_anomaly': {
      const history = bridgeContext.getHistory();
      const series = buildRegionTimeseries(history, 40);
      return { anomalies: detectAnomalies(series, 2.0) };
    }

    case 'classify_knowledge':
      if (!args.text) throw new Error('Text required');
      return classifyContent(args.text);

    case 'narrate_state':
      if (!state) throw new Error('Brain not initialized');
      return { narrative: generateNarrative(state, {}, null) };

    case 'impact_analysis':
      return impactAnalysis(args.region, state);

    // ---------- Layer 82 tools ----------

    case 'run_autopsy': {
      if (!args.transcript) throw new Error('transcript required');
      const autopsy = runAutopsy(args.transcript);
      return {
        speakers: autopsy.speakers,
        meta: autopsy.meta,
        turnCount: autopsy.turns.length,
      };
    }

    case 'counter_draft': {
      if (!args.text) throw new Error('text required');
      return await counterDraft(args.text);
    }

    case 'run_diff': {
      if (!args.textA || !args.textB) throw new Error('textA and textB required');
      return runDiff({
        labelA: args.labelA || 'A',
        labelB: args.labelB || 'B',
        textA: args.textA,
        textB: args.textB,
      });
    }

    case 'detect_archetypes': {
      if (!args.text) throw new Error('text required');
      const s = scoreContent(args.text);
      return { archetypes: detectArchetypes(s.templates || []) };
    }

    case 'compare_rulesets': {
      if (!args.text) throw new Error('text required');
      return compareRulesets(args.text);
    }

    case 'get_immunity':
      return getImmunityState();

    case 'test_hypothesis': {
      if (!args.type || !args.evidenceText) throw new Error('type and evidenceText required');
      return testHypothesis({ type: args.type, evidenceText: args.evidenceText });
    }

    case 'explain_scan': {
      if (!args.text) throw new Error('text required');
      const s = scoreContent(args.text);
      const merged = mergeTemplateResults(s.templates || [], []);
      const archs = detectArchetypes(merged);
      return explainScore(args.text, s, { templates: merged, archetypes: archs });
    }

    case 'todays_daily':
      return { items: pickTodaysChallenge() };

    case 'analyze_time_series': {
      if (!args.raw) throw new Error('raw transcript required');
      return analyzeTimeSeries(args.raw);
    }

    case 'issue_receipt': {
      if (!args.text) throw new Error('text required');
      const s = scoreContent(args.text);
      return await issueReceipt({ text: args.text, score: s });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ---------- impact analysis (blast radius) ----------

/**
 * Cannibalized from GitNexus's `impact` tool — given a region, compute
 * blast radius through the connectome using weighted adjacency.
 * Confidence-weighted by connection strength.
 */
function impactAnalysis(region, state) {
  if (!state) throw new Error('Brain not initialized');
  const weights = state.weights || {};
  const affected = {};
  let maxWeight = 0;

  // First-order: direct neighbors via weights dict (keys like "CTX-PFC")
  for (const [key, w] of Object.entries(weights)) {
    const [from, to] = key.split('-');
    if (from === region && to) {
      affected[to] = (affected[to] || 0) + w;
      maxWeight = Math.max(maxWeight, w);
    }
    if (to === region && from) {
      affected[from] = (affected[from] || 0) + w * 0.6; // inbound counts less
      maxWeight = Math.max(maxWeight, w * 0.6);
    }
  }

  // Rank + confidence score
  const ranked = Object.entries(affected)
    .map(([r, w]) => ({
      region: r,
      weight: w,
      confidence: maxWeight > 0 ? w / maxWeight : 0,
      currentActivity: state.regions?.[r] ?? 0
    }))
    .sort((a, b) => b.weight - a.weight);

  return { source: region, directlyAffected: ranked, totalAffected: ranked.length };
}

// ---------- JSON-RPC framing (for stdio MCP server) ----------

/**
 * Parse a JSON-RPC 2.0 request and dispatch to tool handler.
 * Returns a JSON-RPC 2.0 response envelope.
 */
export async function handleJsonRpc(request) {
  const { id, method, params } = request;
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: BRAIN_TOOLS } };
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    const result = await handleToolCall(name, args || {});
    if (!result.ok) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: result.error } };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(result.result, null, 2) }] }
    };
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ---------- audit log ----------

const auditLog = [];
export const MAX_AUDIT_ENTRIES = 50;

export function logToolCall(entry) {
  auditLog.unshift({ ...entry, timestamp: Date.now() });
  if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.pop();
}

export function getAuditLog() {
  return auditLog.slice();
}

export function clearAuditLog() {
  auditLog.length = 0;
}
