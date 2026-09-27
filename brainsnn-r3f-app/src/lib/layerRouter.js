import { CORE_LAYER_IDS, LAYER_CATALOG, layersByIds } from './layerCatalog.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { getBusinessMetrics } from './scoreMapping.js';
import { computeSolitonField } from './solitonLayer.js';
import { computeFirewall, detectTemplates } from './firewallLayer.js';
import { computeAffect } from './affectLayer.js';
import { createRewritePlan } from './draftRewrite.js';
import { clampScore } from './formatters.js';
import { analyzeEvidenceGaps } from './evidenceGapAnalyzer.js';

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
    source: 'BrainSNN deterministic broad-region compatibility view',
    status: 'compatibility_only',
    scenario: pressure > 0.62 ? 'Content Pressure Cascade' : trust > 0.68 ? 'Emotional Salience & Trust' : 'Organic Baseline',
    regions,
    mappingId: 'brainsnn-commercial-signals-to-seven-regions-v1',
    modelled: true,
    measured: false,
    note: tribeStatus.enabled
      ? 'This compatibility view is still derived only from BrainSNN deterministic content signals. The research-only TRIBE adapter is never invoked by this commercial route.'
      : 'Derived from BrainSNN deterministic content signals for the legacy seven-region display. No TRIBE model or measured neural data was used.',
  };
}

export function getEngineStatusSnapshot(env = {}) {
  const has = (key) => Boolean(env[key]);
  const tribeEnabled = String(env.ENABLE_TRIBE_RESEARCH || '').toLowerCase() === 'true';
  const tribeConfigured = has('TRIBE_API_URL');
  const outbound = env.GPU_INFERENCE_TRANSPORT === 'outbound';
  const bridgeKey = String(env.GPU_BRIDGE_WORKER_KEY || '');
  const gpuConfigured = outbound
    ? env.GPU_BRIDGE_SINGLE_REPLICA === '1' && bridgeKey.length >= 32 && bridgeKey.length <= 256
      && !/[\r\n]/.test(bridgeKey) && has('GPU_INFERENCE_MODEL')
    : has('GPU_INFERENCE_URL') && has('GPU_INFERENCE_KEY') && has('GPU_INFERENCE_MODEL');
  const gpuEnabled = outbound || has('GPU_INFERENCE_URL') || has('GPU_INFERENCE_KEY') || has('GPU_INFERENCE_MODEL');

  return {
    totalLayers: LAYER_CATALOG.length,
    coreLayers: layersByIds(CORE_LAYER_IDS),
    engines: {
      stripe: { configured: has('STRIPE_SECRET_KEY'), status: has('STRIPE_SECRET_KEY') ? 'configured' : 'not_configured' },
      supabase: { configured: has('SUPABASE_URL') && (has('SUPABASE_SERVICE_ROLE_KEY') || has('SUPABASE_ANON_KEY')), status: has('SUPABASE_URL') ? 'configured' : 'not_configured' },
      openai: { configured: has('OPENAI_API_KEY'), status: has('OPENAI_API_KEY') ? 'configured' : 'not_configured' },
      gemini: { configured: has('GEMINI_API_KEY'), status: has('GEMINI_API_KEY') ? 'configured' : 'not_configured' },
      gemma: { configured: has('GEMMA_API_ENDPOINT'), status: has('GEMMA_API_ENDPOINT') ? 'configured' : 'not_configured' },
      gpu: { configured: gpuConfigured, status: gpuConfigured ? 'unverified' : gpuEnabled ? 'invalid_configuration' : 'not_configured' },
      tribe: {
        configured: tribeConfigured,
        enabled: tribeEnabled,
        status: tribeConfigured && tribeEnabled ? 'configured_research_only' : tribeConfigured ? 'disabled' : 'not_configured',
        researchOnly: true,
        commercialUse: false,
      },

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
  const evidenceGapAnalysis = analyzeEvidenceGaps({
    content: rawContent,
    context: contentType === 'video' ? 'video_script' : contextTriggers.genre,
  });
  const tribeProjection = buildTribeProjection(
    result,
    firewallSignals,
    affectProfile,
    engineStatus.tribe || engineStatus.engines?.tribe || {},
  );
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
    { stage: 'Evidence Gap Analyzer', status: 'completed', note: evidenceGapAnalysis.summary },
    { stage: 'L103 39 Hz Soliton Field', status: 'completed', note: `Gamma coherence ${solitonField.gammaCoherence} at ${solitonField.effectiveFrequencyHz} Hz (${solitonField.synchrony}); ${solitonField.leapfrogEvents} leapfrog event(s); theta-gamma PAC ${solitonField.thetaGammaPAC}.` },
    { stage: 'L3 Broad-region compatibility view', status: tribeProjection.status, note: tribeProjection.note },
    ...providerTrace,
    { stage: 'L46 Firewall Receipt', status: 'completed', note: receipt.id },
  ];
  const specificRecommendation = evidenceGapAnalysis.topRecommendation
    ? {
        id: evidenceGapAnalysis.topRecommendation.id,
        goal: 'Proof',
        title: evidenceGapAnalysis.topRecommendation.title,
        rationale: evidenceGapAnalysis.topRecommendation.rationale,
        rewriteHint: `${evidenceGapAnalysis.topRecommendation.recommendedEdit} Most valuable proof: ${evidenceGapAnalysis.topRecommendation.mostValuableProof.slice(0, 3).join(' ')}`,
      }
    : null;
  return {
    ...result,
    recommendations: specificRecommendation
      ? [specificRecommendation, ...(Array.isArray(result.recommendations) ? result.recommendations : [])].slice(0, 3)
      : result.recommendations,
    contentType,
    firewallSignals,
    affectProfile,
    solitonField,
    contextTriggers,
    evidenceGapAnalysis,
    evidenceGaps: evidenceGapAnalysis.gaps,
    tribeProjection,
    layersUsed,
    engineTrace,
    receipt,
    researchNotes: [
      'TRIBE v2 is a separate CC BY-NC research reference and is never used by the automatic commercial scan route.',
      'The seven-region compatibility view is derived from deterministic BrainSNN commercial signals, not from TRIBE or measured neural data.',
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

// Layers 41/42/68 are the rewrite layers that actually have an implementation.
// The previous version of this list also cited 88 and 89, which exist only as
// names in layerCatalog — citing them made the trace look deeper than the code.
const REWRITE_LAYER_IDS = [41, 42, 68];

export function createRewriteFromLayerStack(content, goal = 'trust') {
  const plan = createRewritePlan(content, goal);
  if (!plan.content) return { content: '', changes: [], patches: [], layersUsed: layersByIds(REWRITE_LAYER_IDS) };

  const context = analyzeContentLocally({ content: plan.content, forceFallback: true });
  const primary = context.recommendations?.[0];

  // Merge decision, kept from the coherence-landing branch: a trust rewrite
  // appends the ranked proof the evidence-gap analysis asks for when the
  // strongest gap is a price claim — the one class where the missing proof is
  // objectively nameable. Every other case keeps the clean copy; the judgement
  // call stays in `remaining` rather than being pasted into the user's
  // publishable text as a template sentence.
  let finalContent = plan.content;
  if (goal === 'trust') {
    const evidence = analyzeEvidenceGaps({ content: plan.content, context: detectGenre(plan.content) });
    const top = evidence.topRecommendation;
    if (top && evidence.gaps?.[0]?.classification === 'price_claim') {
      finalContent = `${plan.content}\n\n${top.recommendedEdit}\nMost valuable proof: ${top.mostValuableProof.slice(0, 3).join(' ')}`;
    }
  }

  return {
    content: finalContent,
    // Each entry describes an edit that was actually made to the text, so the
    // change log can be checked against the diff rather than taken on faith.
    changes: plan.changes,
    patches: plan.patches,
    appliedCount: plan.appliedCount,
    note: plan.note,
    // What the mechanical pass cannot do — the judgement call left for the user.
    remaining: primary ? `${primary.title}: ${primary.rewriteHint}` : '',
    layersUsed: layersByIds(REWRITE_LAYER_IDS),
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
