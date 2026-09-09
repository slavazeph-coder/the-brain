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
import { createReplayNeuralInput, deriveDecodeUncertainty } from '../src/lib/neuralInputGateway.js';
import { compareEngineInputs, ENGINE_COMPARE_MAX_CHARS } from '../src/lib/engineComparison.js';
import { evaluatePromotion } from '../src/lib/researchDirector.js';

const json = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const baseScan = (content, contentType = 'text') => analyzeContentLocally({ content, contentType, forceFallback: true });

const server = new McpServer({ name: 'brainsnn', version: '0.1.0' });

server.tool(
  'brain_analyze',
  'Run the implemented local BrainSNN analysis stack (firewall, affect, simulated projection, soliton, receipt). Deterministic and offline; catalog size does not mean every named layer executes.',
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

server.tool(
  'brain_decode',
  'Neural decoder gateway (L19): analyze an authorized decoded transcript (output of a communication decoder) through the full BrainSNN stack, with a decode-uncertainty label. Transcript-in only — no raw signals; a real external decoder is wired via NEURAL_DECODER_URL on the server.',
  { decodedText: z.string(), confidence: z.number().optional(), decoder: z.string().optional(), modality: z.string().optional() },
  async ({ decodedText, confidence, decoder, modality }) => {
    const envelope = createReplayNeuralInput({ decodedText, confidence, decoder, modality, source: 'mcp', consentConfirmed: true });
    const result = runLayerRouter({ content: envelope.decodedText, baseResult: baseScan(envelope.decodedText), engineStatus: getEngineStatusSnapshot(process.env) });
    return json({ neuralInput: envelope, uncertainty: deriveDecodeUncertainty(envelope), result });
  },
);

const transport = new StdioServerTransport();
server.tool(
  'brain_compare',
  'Compare original and candidate text with the same deterministic scorer. Returns exact text hashes, source spans, signal regressions and a review record. Does not verify facts, measure market outcomes, accept work or promote context.',
  {
    original: z.string().min(1).max(ENGINE_COMPARE_MAX_CHARS),
    candidate: z.string().min(1).max(ENGINE_COMPARE_MAX_CHARS),
    limits: z.object({ maxTrustDrop: z.number().min(0).max(100).optional(), maxPressureIncrease: z.number().min(0).max(1).optional() }).optional(),
  },
  async (input) => json(compareEngineInputs(input)),
);

server.tool(
  'brain_promotion_check',
  'Check supplied model benchmark records for completion, measured scores, compatible dataset/split and latency constraints. Returns eligibility only; it does not independently verify benchmark provenance, train, deploy or promote a model.',
  {
    candidate: z.record(z.unknown()),
    champion: z.record(z.unknown()).nullable().optional(),
    minDelta: z.number().min(0).max(2).optional(),
    maxLatencyIncreaseFraction: z.number().min(0).optional(),
  },
  async (input) => json(evaluatePromotion(input)),
);

await server.connect(transport);
console.error('BrainSNN MCP server ready on stdio (9 tools).');
