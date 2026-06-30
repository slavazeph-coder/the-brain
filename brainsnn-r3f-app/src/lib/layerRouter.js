import { CORE_LAYER_IDS, LAYER_CATALOG, layersByIds } from './layerCatalog.js';
import { analyzeContentLocally } from './analysisEngine.js';
import { getBusinessMetrics } from './scoreMapping.js';
import { computeSolitonField } from './solitonLayer.js';

const urgencyTerms = /\b(now|today|deadline|limited|last chance|urgent|immediately|act fast|before it'?s too late)\b/gi;
const outrageTerms = /\b(outrage|furious|rigged|corrupt|betrayed|enemy|disgusting|they don't want|scandal)\b/gi;
const fearTerms = /\b(risk|danger|lose|fail|threat|panic|crisis|damage|warning|unsafe|hidden truth)\b/gi;
const certaintyTerms = /\b(guaranteed|proven|everyone knows|obviously|undeniably|100%|fact|scientifically proven)\b/gi;
const trustTerms = /\b(proof|data|tested|customer|source|case study|measured|verified|transparent|specific|evidence)\b/gi;
const empathyTerms = /\b(you|your|together|help|support|understand|people|customers|team|community)\b/gi;
const curiosityTerms = /\b(why|how|what if|surprising|discover|learn|before|after|mistake|lesson)\b/gi;

function count(text, regex) {
  return (String(text || '').match(regex) || []).length;
}

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

function findEvidence(text, regex, label) {
  const matches = String(text || '').match(regex) || [];
  return [...new Set(matches.map((match) => match.trim().toLowerCase()))].slice(0, 5).map((match) => ({ label, match }));
}

function detectGenre(text) {
  const lower = String(text || '').toLowerCase();
  if (lower.includes('subject:') || lower.includes('unsubscribe')) return 'sales_email';
  if (lower.includes('book a demo') || lower.includes('conversion')) return 'paid_ad';
  if (lower.includes('thread') || lower.includes('founder')) return 'founder_post';
  if (lower.length < 180) return 'social_hook';
  return 'brand_message';
}

function detectTemplates(text) {
  const templates = [];
  if (count(text, urgencyTerms) > 0 && count(text, trustTerms) === 0) templates.push({ id: 'forced-urgency', label: 'Forced urgency', risk: 'Pressure appears before proof.' });
  if (count(text, fearTerms) > 0) templates.push({ id: 'fear-pressure', label: 'Fear pressure', risk: 'Risk framing may attract attention while lowering trust.' });
  if (count(text, outrageTerms) > 0) templates.push({ id: 'outrage-hook', label: 'Outrage hook', risk: 'Conflict language may increase charge and brand risk.' });
  if (count(text, certaintyTerms) > 0) templates.push({ id: 'certainty-theater', label: 'Certainty theater', risk: 'Absolute claims need evidence or qualification.' });
  if (!templates.length) templates.push({ id: 'organic-baseline', label: 'Organic baseline', risk: 'No high-pressure template dominates.' });
  return templates.slice(0, 5);
}

function buildFirewallSignals(text, result = {}) {
  const metrics = result.metrics || {};
  const urgency = count(text, urgencyTerms);
  const outrage = count(text, outrageTerms);
  const fear = count(text, fearTerms);
  const certainty = count(text, certaintyTerms);
  const trust = count(text, trustTerms);
  const wordCount = Math.max(1, String(text || '').trim().split(/\s+/).filter(Boolean).length);
  const density = Math.min(1, (urgency + outrage + fear + certainty) / Math.max(3, wordCount / 18));
  const emotionalActivation = clamp01(((Number(metrics.fear) || 0) + (Number(metrics.anger) || 0) + fear * 12 + outrage * 10) / 180);
  const cognitiveSuppression = clamp01(((Number(metrics.urgency) || 0) + urgency * 11 + certainty * 9) / 160);
  const trustErosion = clamp01((((100 - (Number(metrics.trust) || 50)) / 100) * 0.58) + density * 0.34 - Math.min(0.18, trust * 0.03));
  const manipulationPressure = clamp01((emotionalActivation * 0.42) + (cognitiveSuppression * 0.38) + (trustErosion * 0.2));
  const evidence = [
    ...findEvidence(text, urgencyTerms, 'urgency'),
    ...findEvidence(text, outrageTerms, 'outrage'),
    ...findEvidence(text, fearTerms, 'fear'),
    ...findEvidence(text, certaintyTerms, 'certainty'),
    ...findEvidence(text, trustTerms, 'proof'),
  ].slice(0, 10);
  return {
    emotionalActivation: Number(emotionalActivation.toFixed(3)),
    cognitiveSuppression: Number(cognitiveSuppression.toFixed(3)),
    manipulationPressure: Number(manipulationPressure.toFixed(3)),
    trustErosion: Number(trustErosion.toFixed(3)),
    density: Number(density.toFixed(3)),
    evidence,
    templates: detectTemplates(text),
    source: result.isFallback ? 'deterministic-firewall-fallback' : 'model-plus-firewall',
  };
}

function buildAffectProfile(text, result = {}, firewallSignals) {
  const metrics = result.metrics || {};
  const curiosity = count(text, curiosityTerms);
  const empathy = count(text, empathyTerms);
  const trust = Number(metrics.trust) || 50;
  const excitement = Number(metrics.excitement) || 40;
  const fear = Number(metrics.fear) || 0;
  const anger = Number(metrics.anger) || 0;
  const urgency = Number(metrics.urgency) || 0;
  const dominantAffect = fear + anger > 115
    ? 'threat'
    : trust > 68 && empathy > 2
      ? 'trust'
      : curiosity + excitement / 30 > 3
        ? 'curiosity'
        : urgency > 70
          ? 'pressure'
          : 'clarity';
  const valence = clampScore(48 + trust * 0.32 + empathy * 4 - fear * 0.18 - anger * 0.16, 50);
  const arousal = clampScore(32 + excitement * 0.32 + urgency * 0.25 + (firewallSignals?.emotionalActivation || 0) * 32, 45);
  return {
    dominantAffect,
    valence,
    arousal,
    clusters: [
      { id: 'threat', label: 'Threat', value: clampScore((fear + anger) / 2, 20) },
      { id: 'reward', label: 'Reward', value: clampScore(excitement, 40) },
      { id: 'social', label: 'Social trust', value: clampScore((trust + empathy * 10) / 2, 45) },
      { id: 'cognitive', label: 'Curiosity / clarity', value: clampScore(curiosity * 16 + trust * 0.28, 38) },
    ],
  };
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
  const firewallSignals = buildFirewallSignals(rawContent, result);
  const affectProfile = buildAffectProfile(rawContent, result, firewallSignals);
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
