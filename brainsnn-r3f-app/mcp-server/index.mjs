#!/usr/bin/env node
// BrainSNN MCP Bridge (Layer 19) — a stdio MCP server that exposes the
// deterministic BrainSNN engine to agents (Claude Code / Codex). Every tool
// runs fully offline (no model keys) by importing the same src/lib functions
// the web app uses.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { analyzeContentLocally } from '../src/lib/analysisEngine.js';
import { runLayerRouter, getEngineStatusSnapshot } from '../src/lib/layerRouter.js';
import { LAYER_CATALOG } from '../src/lib/layerCatalog.js';
import { computeSolitonField, exploreSolitonField } from '../src/lib/solitonLayer.js';
import { computeFirewall } from '../src/lib/firewallLayer.js';
import { computeAffect } from '../src/lib/affectLayer.js';

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const baseScan = (content, contentType = 'text') => analyzeContentLocally({ content, contentType, forceFallback: true });

const server = new McpServer({ name: 'brainsnn', version: '0.1.0' });

server.tool(
  'brain_analyze',
  'Run the full BrainSNN 103-layer scan of content (firewall, affect, TRIBE projection, soliton, receipt). Deterministic and offline.',
  { content: z.string(), contentType: z.string().optional() },
  async ({ content, contentType }) => json(runLayerRouter({
    content,
    contentType: contentType || 'text',
    baseResult: baseScan(content, contentType),
    engineStatus: getEngineStatusSnapshot(process.env),
  })),
);

server.tool(
  'brain_firewall',
  'Cognitive Firewall (L4): manipulation-pressure signals, per-category breakdown, per-sentence heatmap, A-F grade and named tactics.',
  { content: z.string() },
  async ({ content }) => json(computeFirewall({ content, metrics: baseScan(content).metrics, isFallback: true })),
);

server.tool(
  'brain_affect',
  'Affective Decoder (L29): affect taxonomy on Russell\'s valence-arousal circumplex, dominant affect, and a per-sentence emotion trajectory.',
  { content: z.string() },
  async ({ content }) => {
    const b = baseScan(content);
    const firewall = computeFirewall({ content, metrics: b.metrics, isFallback: true });
    return json(computeAffect({ content, metrics: b.metrics, firewallSignals: firewall }));
  },
);

server.tool(
  'brain_soliton',
  'Layer 103 — the 39 Hz soliton field (gamma coherence, KdV solitons, spectrum, theta-gamma PAC) for a piece of content.',
  { content: z.string(), contentType: z.string().optional() },
  async ({ content, contentType }) => {
    const b = baseScan(content, contentType);
    const firewall = computeFirewall({ content, metrics: b.metrics, isFallback: true });
    const affect = computeAffect({ content, metrics: b.metrics, firewallSignals: firewall });
    return json(computeSolitonField({ content, contentType: contentType || 'text', firewallSignals: firewall, affectProfile: affect, metrics: b.metrics }));
  },
);

server.tool(
  'brain_soliton_explore',
  'Ensemble-averaged sensitivity sweep of the soliton field across a driver axis (pressure / suppression / trustErosion / valence / arousal).',
  { axis: z.string().optional(), base: z.string().optional(), steps: z.number().optional() },
  async ({ axis, base, steps }) => json(exploreSolitonField({ axis, base, steps })),
);

server.tool(
  'brain_layers',
  'List the BrainSNN layer catalog (id, name, group, blurb).',
  {},
  async () => json({ total: LAYER_CATALOG.length, layers: LAYER_CATALOG }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('BrainSNN MCP server ready on stdio (6 tools).');
