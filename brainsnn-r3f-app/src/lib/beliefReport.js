// BrainSNN Belief Report V0.1
//
// This is the product-side learned-pattern reporting layer. It deliberately does
// not claim neuroscience, measured attention, emotion, purchase intent, or
// outcome prediction. Until a trained S-DBN adapter is configured, it derives a
// deterministic latent-state proxy from the same bounded multimodal features
// BrainSNN already exposes. The schema is intentionally stable so a real learned
// model can replace the proxy later without rebuilding the reporting UI.

const EPSILON = 1e-9;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function clamp100(value) {
  return Math.round(clamp((Number(value) || 0) / 100) * 100);
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0) / values.length;
}

function variance(values = []) {
  if (!values.length) return 0;
  const avg = mean(values);
  return mean(values.map((value) => ((Number(value) || 0) - avg) ** 2));
}

function nearestPoint(points = [], time = 0) {
  if (!points.length) return null;
  const target = Number(time) || 0;
  return points.reduce((best, point) => (
    Math.abs((Number(point.timestamp) || 0) - target) < Math.abs((Number(best.timestamp) || 0) - target)
      ? point
      : best
  ), points[0]);
}

function overlappingSegments(segments = [], start = 0, end = 0) {
  return segments.filter((segment) => (
    (Number(segment.start) || 0) < end && (Number(segment.end) || 0) > start
  ));
}

function semanticCode(segments = []) {
  const kinds = new Set(segments.map((segment) => segment.kind));
  let code = 0;
  if (kinds.has('claim')) code += 1;
  if (kinds.has('proof')) code += 2;
  if (kinds.has('price')) code += 4;
  if (kinds.has('cta')) code += 8;
  if (kinds.has('workflow')) code += 16;
  return code;
}

function featureVectorForWindow(window, multimodal) {
  const temporalPoints = multimodal?.temporalReadout?.points || [];
  const audioPoints = multimodal?.audioTimeline?.points || [];
  const segments = multimodal?.transcriptTimeline?.segments || [];
  const start = Number(window?.start) || 0;
  const end = Number(window?.end) || start;
  const midpoint = start + Math.max(0, end - start) / 2;
  const temporal = nearestPoint(temporalPoints, midpoint) || {};
  const audio = nearestPoint(audioPoints, midpoint) || {};
  const overlaps = overlappingSegments(segments, start, end);

  return {
    attention: clamp100(window?.attentionProxy ?? temporal.attentionProxy),
    responseChange: clamp100(window?.responseChange ?? temporal.responseChange),
    load: clamp100(window?.loadProxy ?? temporal.loadProxy),
    visualTone: clamp100(temporal.visualTone),
    luminance: clamp100(temporal.luminance),
    stability: clamp100(temporal.stability),
    audioEnergy: clamp100(audio.energy),
    audioDynamics: clamp100(audio.dynamics),
    semanticCode: semanticCode(overlaps),
    semanticDensity: Math.min(100, overlaps.length * 25),
  };
}

function hashState(features) {
  // Compact, deterministic state fingerprint. A learned adapter can later
  // replace this state assignment while preserving the public schema.
  const buckets = [
    Math.floor(features.attention / 25),
    Math.floor(features.responseChange / 25),
    Math.floor(features.load / 25),
    Math.floor(features.audioEnergy / 25),
    features.semanticCode,
  ];
  let hash = 2166136261;
  for (const value of buckets) {
    hash ^= Number(value) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 24;
}

function reconstructionSurprise(features, baseline) {
  const keys = ['attention', 'responseChange', 'load', 'audioEnergy', 'audioDynamics', 'semanticDensity'];
  const deltas = keys.map((key) => Math.abs((features[key] || 0) - (baseline[key] || 0)) / 100);
  return clamp(mean(deltas) * 1.7);
}

function vectorDistance(a, b) {
  if (!a || !b) return 0;
  const keys = ['attention', 'responseChange', 'load', 'audioEnergy', 'audioDynamics', 'semanticDensity'];
  return Math.sqrt(mean(keys.map((key) => (((a[key] || 0) - (b[key] || 0)) / 100) ** 2)));
}

function baselineFor(features = []) {
  const keys = ['attention', 'responseChange', 'load', 'visualTone', 'luminance', 'stability', 'audioEnergy', 'audioDynamics', 'semanticDensity'];
  return Object.fromEntries(keys.map((key) => [key, mean(features.map((item) => item[key]))]));
}

function deterministicFlags(window, multimodal) {
  const flags = [];
  const start = Number(window?.start) || 0;
  const end = Number(window?.end) || start;
  const segments = overlappingSegments(multimodal?.transcriptTimeline?.segments || [], start, end);
  if (Number(window?.attentionDrop) > 12) flags.push('attention_proxy_drop');
  if (Number(window?.loadProxy) > 70) flags.push('high_change_load_proxy');
  if (segments.some((segment) => segment.kind === 'claim')) flags.push('claim_present');
  if (segments.some((segment) => segment.kind === 'proof')) flags.push('proof_present');
  if (segments.some((segment) => segment.kind === 'price')) flags.push('price_present');
  if (segments.some((segment) => segment.kind === 'cta')) flags.push('cta_present');
  return flags;
}

function agreementForWindow({ surprise, stateChanged, flags }) {
  const deterministicConcern = flags.includes('attention_proxy_drop') || flags.includes('high_change_load_proxy');
  const learnedConcern = surprise >= 0.42 || stateChanged;
  let score = 0.5;
  let label = 'mixed';
  if (deterministicConcern && learnedConcern) {
    score = 0.86;
    label = 'high';
  } else if (!deterministicConcern && !learnedConcern) {
    score = 0.74;
    label = 'stable';
  } else {
    score = 0.34;
    label = 'review';
  }
  return { score: Number(score.toFixed(2)), label, deterministicConcern, learnedConcern };
}

function bestBy(items, selector) {
  if (!items.length) return null;
  return items.reduce((best, item) => selector(item) > selector(best) ? item : best, items[0]);
}

export function buildBeliefReport(multimodal = {}) {
  const sourceWindows = multimodal?.temporalReadout?.windows?.windows || [];
  const windows = sourceWindows.length
    ? sourceWindows
    : (multimodal?.temporalReadout?.points || []).map((point) => ({
        start: Number(point.timestamp) || 0,
        end: Number(point.timestamp) || 0,
        attentionProxy: point.attentionProxy,
        responseChange: point.responseChange,
        loadProxy: point.loadProxy,
        attentionDrop: 0,
      }));

  const features = windows.map((window) => featureVectorForWindow(window, multimodal));
  const baseline = baselineFor(features);
  let previousState = null;
  let previousFeatures = null;

  const learnedWindows = windows.map((window, index) => {
    const currentFeatures = features[index];
    const stateId = hashState(currentFeatures);
    const stateChanged = previousState != null && previousState !== stateId;
    const surprise = reconstructionSurprise(currentFeatures, baseline);
    const transitionMagnitude = previousFeatures ? clamp(vectorDistance(currentFeatures, previousFeatures) * 1.7) : 0;
    const spikeRateProxy = clamp((currentFeatures.responseChange * 0.45 + currentFeatures.audioDynamics * 0.25 + currentFeatures.semanticDensity * 0.3) / 100);
    const sparsityProxy = clamp(1 - spikeRateProxy * 0.72);
    const flags = deterministicFlags(window, multimodal);
    const agreement = agreementForWindow({ surprise, stateChanged, flags });

    const item = {
      start: Number((Number(window.start) || 0).toFixed(2)),
      end: Number((Number(window.end) || Number(window.start) || 0).toFixed(2)),
      stateId,
      stateConfidence: Number(clamp(0.52 + Math.abs(surprise - 0.5) * 0.36 + Math.min(0.12, transitionMagnitude * 0.15)).toFixed(2)),
      surprise: Number(surprise.toFixed(3)),
      reconstructionError: Number((surprise * 0.88).toFixed(3)),
      transitionMagnitude: Number(transitionMagnitude.toFixed(3)),
      stateChanged,
      spikeRateProxy: Number(spikeRateProxy.toFixed(3)),
      sparsityProxy: Number(sparsityProxy.toFixed(3)),
      deterministicFlags: flags,
      agreement,
      features: currentFeatures,
    };
    previousState = stateId;
    previousFeatures = currentFeatures;
    return item;
  });

  const stateCounts = learnedWindows.reduce((acc, item) => {
    acc[item.stateId] = (acc[item.stateId] || 0) + 1;
    return acc;
  }, {});
  const dominantState = Object.entries(stateCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const highestSurprise = bestBy(learnedWindows, (item) => item.surprise || 0);
  const highestTransition = bestBy(learnedWindows, (item) => item.transitionMagnitude || 0);
  const highestDisagreement = bestBy(learnedWindows, (item) => 1 - (item.agreement?.score ?? 0.5));
  const agreementScore = learnedWindows.length ? mean(learnedWindows.map((item) => item.agreement.score)) : 0;
  const surpriseVariance = variance(learnedWindows.map((item) => item.surprise));

  return {
    schemaVersion: 'brainsnn.belief.v0.1',
    model: {
      id: 'brainsnn-sdbn-proxy-v0',
      version: '0.1.0',
      status: 'proxy-ready',
      learnedWeights: false,
      note: 'Deterministic latent-state proxy over existing BrainSNN multimodal features. Replaceable by a trained S-DBN adapter without changing the report schema.',
    },
    windows: learnedWindows,
    summary: {
      dominantState: dominantState == null ? null : Number(dominantState),
      uniqueStates: Object.keys(stateCounts).length,
      stateTransitions: learnedWindows.filter((item) => item.stateChanged).length,
      meanSurprise: Number(mean(learnedWindows.map((item) => item.surprise)).toFixed(3)),
      surpriseVariance: Number(surpriseVariance.toFixed(4)),
      agreementScore: Number(agreementScore.toFixed(3)),
      highestSurprise: highestSurprise ? {
        start: highestSurprise.start,
        end: highestSurprise.end,
        value: highestSurprise.surprise,
        stateId: highestSurprise.stateId,
      } : null,
      highestTransition: highestTransition ? {
        start: highestTransition.start,
        end: highestTransition.end,
        value: highestTransition.transitionMagnitude,
        fromState: null,
        toState: highestTransition.stateId,
      } : null,
      highestDisagreement: highestDisagreement ? {
        start: highestDisagreement.start,
        end: highestDisagreement.end,
        agreementScore: highestDisagreement.agreement.score,
        label: highestDisagreement.agreement.label,
      } : null,
    },
    tracks: [
      {
        id: 'belief-state',
        label: 'Learned state proxy',
        provenance: 'BrainSNN S-DBN-ready latent-state schema; current V0.1 uses deterministic feature-state proxy',
        values: learnedWindows.map((item) => ({ timestamp: item.start, value: item.stateId })),
      },
      {
        id: 'belief-surprise',
        label: 'Pattern surprise',
        provenance: 'Distance from this scan\'s multimodal feature baseline; not measured audience response',
        values: learnedWindows.map((item) => ({ timestamp: item.start, value: Math.round(item.surprise * 100) })),
      },
      {
        id: 'belief-agreement',
        label: 'Model agreement',
        provenance: 'Agreement between deterministic BrainSNN flags and learned-pattern proxy',
        values: learnedWindows.map((item) => ({ timestamp: item.start, value: Math.round(item.agreement.score * 100) })),
      },
      {
        id: 'belief-transition',
        label: 'State transition',
        provenance: 'Magnitude of change in the bounded multimodal feature representation',
        values: learnedWindows.map((item) => ({ timestamp: item.start, value: Math.round(item.transitionMagnitude * 100) })),
      },
    ],
    disclaimer: 'Belief Report V0.1 reports learned-model-ready pattern states, surprise, transitions and cross-model agreement over BrainSNN\'s existing bounded multimodal features. The current proxy does not use trained S-DBN weights and does not measure human attention, emotion, cognition, intent, EEG, fMRI, or neural activity.',
  };
}

export function attachBeliefReport(multimodal = {}) {
  const beliefReport = buildBeliefReport(multimodal);
  return {
    ...multimodal,
    beliefReport,
    temporalReadout: {
      ...(multimodal.temporalReadout || {}),
      tracks: [
        ...(multimodal.temporalReadout?.tracks || []),
        ...beliefReport.tracks,
      ],
    },
  };
}
