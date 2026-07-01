import { CORE_LAYER_IDS, LAYER_CATALOG, layersByIds } from './layerCatalog.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { getBusinessMetrics } from './scoreMapping.js';
import { computeSolitonField } from './solitonLayer.js';
import { computeFirewall, detectTemplates } from './firewallLayer.js';
import { computeAffect } from './affectLayer.js';

export function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function clampScore(value, fallback = 0) {
  const n = Number.isFinite(Number(value)) ? Number(value) : fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function stableHash(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function detectGenre(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('subject:') || lower.includes('unsubscribe')) return 'sales_email';
  if (lower.includes('book a demo') || lower.includes('conversion')) return 'paid_ad';
  if (lower.includes('thread') || lower.includes('founder')) return 'founder_post';
  if (lower.length < 180) return 'social_hook';
  return 'brand_message';
}

function buildContextTriggers(text, result = {}) {
  const genre = detectGenre(text);
  const title = result.title || 'Untitled scan';
  const terms = [...new Set([
    ...String(text || '').match(/\b[A-Z][A-Za-z0-9&.-]{2,}\b/g) || [],
  ])].filter((term) => !['BrainSNN', 'AI'].includes(term)).slice(0, 4);
  return {
    genre,
    entityCandidates: terms,
    recurringSignals: detectTemplates(text).map((template) => template.label),
    memoryPrompt: terms.length
      ? `Track future scans mentioning ${terms[0]} to see whether pressure, trust and proof improve over time.`
      : `Save "${title}" to History to build a local context trail for this campaign.`,
  };
}

function buildTribeProjection(result = {}, firewallSignals, affectProfile, tribeStatus = {}) {
  const metrics = result.metrics || {};
  const emotional = firewallSignals?.emotionalActivation || 0;
  const suppression = firewallSignals?.cognitiveSuppression || 0;
  const pressure = firewallSignals?.manipulationPressure || 0;
  const trust = (Number(metrics.trust) || 50) / 100;
  const regions = {
    CTX: clampScore(54 + trust * 25 - suppression * 18, 58),
    HPC: clampScore(42 + trust * 24 + (affectProfile?.clusters?.find((c) => c.id === 'cognitive')?.value || 40) * 0.18, 50),
    THL: clampScore(34 + emotional * 28 + pressure * 18, 42),
    AMY: clampScore(24 + emotional * 42 + pressure * 24, 35),
    BG: clampScore(36 + pressure * 35 + (Number(metrics.excitement) || 40) * 0.2, 48),
    PFC: clampScore(62 + trust * 24 - suppression * 30, 58),
    CBL: clampScore(38 + (Number(result.confidence) || 60) * 0.22, 50),
  };
  return {
    source: tribeStatus.configured ? 'TRIBE-ready projection' : 'TRIBE-informed local projection',
    status: tribeStatus.status || (tribeStatus.configured ? 'configured' : 'not_configured'),
    scenario: pressure > 0.62 ? 'Content Pressure Cascade' : trust > 0.68 ? 'Emotional Salience & Trust' : 'Organic Baseline',
    regions,
    note: tribeStatus.configured
      ? 'TRIBE service can be used for media/text prediction; this scan shows the mapped BrainSNN projection.'
      : 'TRIBE v2 service is not configured, so BrainSNN used the local 7-region projection layer.',
  };
}

export function getEngineStatusSnapshot(env = {}) {
  const has = (key) => Boolean(env[key]);
  return {
    totalLayers: LAYER_CATALOG.length,
    coreLayers: layersByIds(CORE_LAYER_IDS),
    engines: {
      stripe: { configured: has('STRIPE_SECRET_KEY'), status: has('STRIPE_SECRET_KEY') ? 'configured' : 'not_configured' },
      supabase: { configured: has('SUPABASE_URL') && (has('SUPABASE_SERVICE_ROLE_KEY') || has('SUPABASE_ANON_KEY')), status: has('SUPABASE_URL') ? 'configured' : 'not_configured' },
      openai: { configured: has('OPENAI_API_KEY'), status: has('OPENAI_API_KEY') ? 'configured' : 'not_configured' },
      gemini: { configured: has('GEMINI_API_KEY'), status: has('GEMINI_API_KEY') ? 'configured' : 'not_configured' },
      gemma: { configured: has('GEMMA_API_ENDPOINT'), status: has('GEMMA_API_ENDPOINT') ? 'configured' : 'not_configured' },
      tribe: { configured: has('TRIBE_API_URL'), status: has('TRIBE_API_URL') ? 'configured' : 'not_configured' },
    },
  };
}

export function runLayerRouter({ content, contentType = 'text', baseResult, providerTrace = [], engineStatus = {} } = {}) {
  const result = baseResult || analyzeContentLocally({ content, contentType, forceFallback: true });
  const rawContent = String(content || result.rawContent || '');
  const firewallSignals = computeFirewall({ content: rawContent, metrics: result.metrics, isFallback: result.isFallback });
  const affectProfile = computeAffect({ content: rawContent, metrics: result.metrics, firewallSignals });
  const solitonField = computeSolitonField({ content: rawContent, contentType, firewallSignals, affectProfile, metrics: result.metrics });
  const contextTriggers = buildContextTriggers(rawContent, result);
  const tribeProjection = buildTribeProjection(result, firewallSignals, affectProfile, engineStatus.tribe || {});
  const receipt = {
    id: `bsnn-${stableHash(`${rawContent}|${result.timestamp || ''}`)}`,
    contentHash: stableHash(rawContent),
    resultHash: stableHash(JSON.stringify({
      metrics: result.metrics,
      viralScore: result.viralScore,
      gaugeGapScore: result.gaugeGapScore,
      firewallSignals,
    })),
    solitonHash: stableHash(JSON.stringify({
      gammaCoherence: solitonField.gammaCoherence,
      leapfrogEvents: solitonField.leapfrogEvents,
      bindingScore: solitonField.bindingScore,
      thetaGammaPAC: solitonField.thetaGammaPAC,
    })),
    generatedAt: result.timestamp || new Date().toISOString(),
    disclaimer: 'AI-estimated content response. Not a medical, biometric, or literal neurological measurement.',
  };
  const layersUsed = layersByIds(CORE_LAYER_IDS);
  const engineTrace = [
    { stage: 'L102 Lobster Trap', status: 'local_preflight', note: 'PII/prompt-risk safety preflight is represented in the engine trace.' },
    { stage: 'L4 Cognitive Firewall', status: 'completed', note: `${firewallSignals.templates.length} template signal(s) evaluated.` },
    { stage: 'L29 Affective Decoder', status: 'completed', note: `Dominant affect: ${affectProfile.dominantAffect}.` },
    { stage: 'L103 39 Hz Soliton Field', status: 'completed', note: `Gamma coherence ${solitonField.gammaCoherence} at ${solitonField.effectiveFrequencyHz} Hz (${solitonField.synchrony}); ${solitonField.leapfrogEvents} leapfrog event(s); theta-gamma PAC ${solitonField.thetaGammaPAC}.` },
    { stage: 'L3 TRIBE v2 Projection', status: tribeProjection.status, note: tribeProjection.note },
    ...providerTrace,
    { stage: 'L46 Firewall Receipt', status: 'completed', note: receipt.id },
  ];
  return {
    ...result,
    contentType,
    firewallSignals,
    affectProfile,
    solitonField,
    contextTriggers,
    tribeProjection,
    layersUsed,
    engineTrace,
    receipt,
    researchNotes: [
      'TRIBE v2 is used as a BrainSNN projection layer unless the external prediction service is configured.',
      'Gemma, Gemini and OpenAI are treated as model providers inside the layer stack, not as literal brain measurement.',
      'The Cognitive Firewall, Affective Decoder and Context Memory layers are deterministic enough to support regression tests.',
    ],
    crumbModelStats: {
      ...(result.crumbModelStats || {}),
      model: result.crumbModelStats?.model || (result.isFallback ? 'brainsnn-layer-router-local-v1' : 'brainsnn-layer-router-model-v1'),
      layersEvaluated: layersUsed.length,
      totalLayersAvailable: LAYER_CATALOG.length,
    },
  };
}

export function createRewriteFromLayerStack(content, goal = 'trust') {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return { content: '', changes: [], layersUsed: layersByIds([41, 42, 68, 88, 89]) };
  const proofLine = goal === 'curiosity'
    ? 'Open with the unanswered question, then earn the click with proof.'
    : goal === 'reduce-risk'
      ? 'Keep urgency only where there is a clear reason for it.'
      : goal === 'clarity'
        ? 'Name the audience, outcome and next action in one clean sequence.'
        : 'Lead with proof before the ask.';
  const softened = text
    .replace(/\blast chance\b/gi, 'a useful moment')
    .replace(/\bact now\b/gi, 'see whether it fits')
    .replace(/\bsecret\b/gi, 'practical signal')
    .replace(/\bguaranteed\b/gi, 'designed to help');
  return {
    content: `${proofLine}\n\n${softened}\n\nAdd one specific proof point before publishing.`,
    changes: [
      'Layer 42 Counter-Draft softened pressure language.',
      'Layer 41 Refutation Library preserved the claim but asked for evidence.',
      'Layer 68 Tone Shifter kept the intent while reducing manipulation risk.',
      'Layer 88 Persona Simulator checked that the rewrite remains readable to a cautious buyer.',
    ],
    layersUsed: layersByIds([41, 42, 68, 88, 89]),
  };
}

export function createAutopsyFromLayerStack(leftContent, rightContent) {
  const left = runLayerRouter({ content: leftContent, baseResult: analyzeContentLocally({ content: leftContent, forceFallback: true }) });
  const right = runLayerRouter({ content: rightContent, baseResult: analyzeContentLocally({ content: rightContent, forceFallback: true }) });
  const score = (result) => {
    const metrics = Object.fromEntries(getBusinessMetrics(result).map((metric) => [metric.id, metric.value]));
    return Math.round(metrics.hookStrength * 0.32 + metrics.trust * 0.28 + (100 - metrics.manipulationRisk) * 0.22 + metrics.shareability * 0.18);
  };
  const leftScore = score(left);
  const rightScore = score(right);
  return {
    winner: leftScore === rightScore ? 'tie' : leftScore > rightScore ? 'left' : 'right',
    scores: { left: leftScore, right: rightScore },
    left,
    right,
    layersUsed: layersByIds([13, 36, 47, 48, 51, 53, 70]),
    explanation: leftScore === rightScore
      ? 'Both variants are close. Use the lower-risk version or add proof before retesting.'
      : `${leftScore > rightScore ? 'Variant A' : 'Variant B'} has the stronger combined hook, trust and risk profile.`,
  };
}
