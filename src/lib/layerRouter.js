import { computeFirewall } from './firewallLayer.js';
import { computeAffect } from './affectLayer.js';
import { computeSolitonField } from './solitonLayer.js';
import { analyzeContentLocally } from './analysisEngine.js';

export function getEngineStatusSnapshot(env = process.env) {
  return {
    schemaVersion: 'brainsnn.engine-status.v1',
    timestamp: new Date().toISOString(),
    coreLayers: 7,
    engines: {
      localSnn: { status: 'online', deterministic: true },
      gemini: {
        configured: Boolean(env?.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      },
      gpu: {
        enabled: Boolean(env?.GPU_INFERENCE_URL),
        status: env?.GPU_INFERENCE_URL ? 'configured' : 'disabled',
      },
      tribe: {
        configured: Boolean(env?.TRIBE_API_URL),
        enabled: String(env?.ENABLE_TRIBE_RESEARCH || '').toLowerCase() === 'true',
        status: 'offline',
      },
    },
  };
}

export function runLayerRouter({
  content = '',
  contentType = 'text',
  baseResult = null,
  providerTrace = [],
  engineStatus = null,
} = {}) {
  const resolvedBase = baseResult || analyzeContentLocally({ content, contentType, forceFallback: true });
  const firewallSignals = computeFirewall({
    content,
    metrics: resolvedBase.metrics,
    isFallback: resolvedBase.isFallback,
  });
  const affectProfile = computeAffect({
    content,
    metrics: resolvedBase.metrics,
    firewallSignals,
  });
  const solitonField = computeSolitonField({
    metrics: resolvedBase.metrics,
    firewallSignals,
    affectProfile,
  });

  return {
    ...resolvedBase,
    firewallSignals,
    affectProfile,
    solitonField,
    providerTrace,
    engineStatus: engineStatus || getEngineStatusSnapshot(),
    receipt: {
      schemaVersion: 'brainsnn.receipt.v1',
      deterministicLayers: ['L4-Firewall', 'L29-Affect', 'L103-Soliton'],
      contentLength: String(content || '').length,
      contentType,
    },
  };
}

export function createRewriteFromLayerStack(content = '', goal = 'trust') {
  const cleaned = String(content || '')
    .replace(/\b(act now|immediately|last chance|urgent|hurry)\b/gi, 'when ready')
    .replace(/!+/g, '.')
    .trim();
  const rewritten =
    goal === 'calm'
      ? `${cleaned} (Measured summary without artificial urgency.)`
      : `${cleaned} [Evidence-anchored framing applied for ${goal}.]`;

  return {
    goal,
    originalContent: content,
    content: rewritten,
    notes: [
      'Reduced artificial scarcity and exclamation pressure.',
      `Re-anchored tone around ${goal}.`,
    ],
  };
}

export function createAutopsyFromLayerStack(leftContent = '', rightContent = '') {
  const left = runLayerRouter({ content: leftContent, contentType: 'text' });
  const right = runLayerRouter({ content: rightContent, contentType: 'text' });
  return {
    left,
    right,
    deltas: {
      trust: (right.metrics?.trust ?? 0) - (left.metrics?.trust ?? 0),
      urgency: (right.metrics?.urgency ?? 0) - (left.metrics?.urgency ?? 0),
      fear: (right.metrics?.fear ?? 0) - (left.metrics?.fear ?? 0),
      viralScore: (right.viralScore ?? 0) - (left.viralScore ?? 0),
    },
  };
}
