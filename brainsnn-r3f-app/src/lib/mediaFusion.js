const MAX_WORKFLOW_STEPS = 8;
const MAX_EVENTS = 16;
const MAX_BROWSER_SAMPLES = 120;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function toScore(value) {
  return Math.round(clamp(Number(value) || 0) * 100);
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0) / values.length;
}

/**
 * Browser-local sampling density. Short-form creative now receives enough
 * samples to support useful sliding-window analysis while long clips remain
 * bounded so a visitor never pays an unbounded CPU cost for selecting a video.
 */
export function sampleCountForDuration(duration = 0) {
  const seconds = Math.max(0, Number(duration) || 0);
  if (seconds <= 0) return 12;
  if (seconds <= 15) return Math.max(12, Math.ceil(seconds * 2));
  if (seconds <= 30) return Math.max(30, Math.ceil(seconds * 1.5));
  if (seconds <= 60) return Math.max(45, Math.ceil(seconds));
  if (seconds <= 180) return Math.max(60, Math.ceil(seconds * 0.5));
  return Math.min(MAX_BROWSER_SAMPLES, Math.max(72, Math.ceil(seconds * 0.25)));
}

export function frameSignalFromPixels(data, previous = null, timestamp = 0) {
  if (!data?.length) return { timestamp, luminance: 0, motion: 0, red: 0, green: 0, blue: 0 };
  let luminance = 0;
  let red = 0;
  let green = 0;
  let blue = 0;
  let difference = 0;
  let pixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] || 0;
    const g = data[index + 1] || 0;
    const b = data[index + 2] || 0;
    red += r;
    green += g;
    blue += b;
    luminance += (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    if (previous?.length === data.length) {
      difference += Math.abs(r - previous[index]) + Math.abs(g - previous[index + 1]) + Math.abs(b - previous[index + 2]);
    }
    pixels += 1;
  }

  const divisor = Math.max(1, pixels * 255);
  const motionDivisor = Math.max(1, pixels * 255 * 3);
  return {
    timestamp: Number(timestamp.toFixed?.(2) ?? timestamp) || 0,
    luminance: Number(clamp(luminance / divisor).toFixed(3)),
    motion: Number(clamp(difference / motionDivisor).toFixed(3)),
    red: Number(clamp(red / divisor).toFixed(3)),
    green: Number(clamp(green / divisor).toFixed(3)),
    blue: Number(clamp(blue / divisor).toFixed(3)),
  };
}

function responseChangeForSignal(signal, previous) {
  const motion = Number(signal?.motion) || 0;
  const luminanceShift = previous ? Math.abs((signal?.luminance || 0) - (previous?.luminance || 0)) : 0;
  return clamp((motion * 2.2) + (luminanceShift * 0.8));
}

export function deriveVisualEvents(signals = []) {
  if (!signals.length) return [];
  return signals
    .map((signal, index) => {
      const intensity = responseChangeForSignal(signal, signals[index - 1]);
      const level = intensity >= 0.55 ? 'high' : intensity >= 0.24 ? 'medium' : 'low';
      return {
        timestamp: signal.timestamp || 0,
        timeLabel: formatTime(signal.timestamp),
        level,
        intensity: Number(intensity.toFixed(2)),
        label: level === 'high' ? 'Major visual change' : level === 'medium' ? 'Visual transition' : 'Stable scene',
      };
    })
    .filter((event, index) => index === 0 || event.level !== 'low')
    .slice(0, MAX_EVENTS);
}

export function deriveWindowMoments(points = [], requestedWindowSeconds = 5) {
  if (!points.length) {
    return {
      windowSeconds: requestedWindowSeconds,
      strongest: null,
      weakest: null,
      largestDrop: null,
      windows: [],
    };
  }

  const lastTimestamp = Number(points[points.length - 1]?.timestamp) || 0;
  const firstTimestamp = Number(points[0]?.timestamp) || 0;
  const availableDuration = Math.max(0.5, lastTimestamp - firstTimestamp);
  const windowSeconds = Math.min(Math.max(1, requestedWindowSeconds), Math.max(1, availableDuration));
  const windows = [];

  for (let index = 0; index < points.length; index += 1) {
    const start = Number(points[index]?.timestamp) || 0;
    const end = Math.min(lastTimestamp || (start + windowSeconds), start + windowSeconds);
    const members = points.filter((point) => {
      const timestamp = Number(point.timestamp) || 0;
      return timestamp >= start && timestamp <= end;
    });
    if (!members.length) continue;

    const first = members[0];
    const last = members[members.length - 1];
    const attention = average(members.map((point) => point.attentionProxy));
    const responseChange = average(members.map((point) => point.responseChange));
    const load = average(members.map((point) => point.loadProxy));
    const drop = (Number(first.attentionProxy) || 0) - (Number(last.attentionProxy) || 0);

    windows.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      duration: Number(Math.max(0, end - start).toFixed(2)),
      sampleCount: members.length,
      attentionProxy: Math.round(attention),
      responseChange: Math.round(responseChange),
      loadProxy: Math.round(load),
      attentionDrop: Math.round(drop),
    });
  }

  const usable = windows.filter((window) => window.sampleCount >= Math.min(2, points.length));
  const source = usable.length ? usable : windows;
  const strongest = source.reduce((best, window) => (
    window.responseChange > best.responseChange ? window : best
  ), source[0]);
  const weakest = source.reduce((best, window) => (
    window.attentionProxy < best.attentionProxy ? window : best
  ), source[0]);
  const largestDrop = source.reduce((best, window) => (
    window.attentionDrop > best.attentionDrop ? window : best
  ), source[0]);

  return {
    windowSeconds,
    strongest,
    weakest,
    largestDrop,
    windows,
  };
}

/**
 * Presentation-oriented V0.1 temporal readout. These values are deliberately
 * labelled proxies: they are derived only from browser-local frame deltas,
 * luminance and colour energy. They are not measured attention, emotion or
 * cognitive load and they do not identify people, objects or actions.
 */
export function deriveTemporalReadout(signals = []) {
  if (!signals.length) {
    return {
      schemaVersion: 'brainsnn.temporal.v0.1',
      points: [],
      tracks: [],
      strongest: null,
      weakest: null,
      windows: deriveWindowMoments([]),
      disclaimer: 'No browser-local frame signals were available for a temporal readout.',
    };
  }

  const points = signals.map((signal, index) => {
    const previous = signals[index - 1];
    const previousPrevious = signals[index - 2];
    const responseChange = responseChangeForSignal(signal, previous);
    const previousChange = previous ? responseChangeForSignal(previous, previousPrevious) : 0;
    const luminance = clamp(Number(signal.luminance) || 0);
    const visualTone = clamp(0.5 + ((Number(signal.red) || 0) - (Number(signal.blue) || 0)) * 0.9);
    const attentionProxy = clamp(0.18 + responseChange * 0.68 + Math.abs(luminance - 0.5) * 0.12);
    const loadProxy = clamp(0.16 + responseChange * 0.5 + previousChange * 0.24 + Math.abs(luminance - (previous?.luminance || luminance)) * 0.35);
    const stability = clamp(1 - responseChange);

    return {
      timestamp: Number(signal.timestamp) || 0,
      responseChange: toScore(responseChange),
      attentionProxy: toScore(attentionProxy),
      loadProxy: toScore(loadProxy),
      visualTone: toScore(visualTone),
      luminance: toScore(luminance),
      stability: toScore(stability),
    };
  });

  const strongest = points.reduce((best, point) => point.responseChange > best.responseChange ? point : best, points[0]);
  const weakCandidates = points.length > 2 ? points.slice(1) : points;
  const weakest = weakCandidates.reduce((best, point) => point.attentionProxy < best.attentionProxy ? point : best, weakCandidates[0]);
  const windows = deriveWindowMoments(points, 5);

  const makeTrack = (id, label, provenance, key) => ({
    id,
    label,
    provenance,
    values: points.map((point) => ({ timestamp: point.timestamp, value: point[key] })),
  });

  return {
    schemaVersion: 'brainsnn.temporal.v0.1',
    source: 'browser-local frame deltas only',
    points,
    tracks: [
      makeTrack('response-change', 'Response change', 'pixel + luminance delta', 'responseChange'),
      makeTrack('attention-proxy', 'Attention proxy', 'visual-change heuristic only', 'attentionProxy'),
      makeTrack('load-proxy', 'Cognitive-load proxy', 'rapid-change heuristic only', 'loadProxy'),
      makeTrack('visual-tone', 'Visual tone', 'colour-energy signal; not emotion recognition', 'visualTone'),
      makeTrack('luminance', 'Luminance', 'frame brightness', 'luminance'),
      makeTrack('stability', 'Visual stability', 'inverse response change', 'stability'),
    ],
    strongest,
    weakest,
    windows,
    disclaimer: 'Temporal V0.1 tracks are modelled visual proxies from browser-local frame changes. They are not measured human attention, emotion, cognition or neural activity.',
  };
}

function sentenceCandidates(text = '') {
  return String(text)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((item) => item.length >= 8);
}

export function extractWorkflowSteps(text = '') {
  const candidates = sentenceCandidates(text);
  const actionPattern = /\b(click|open|select|choose|enter|type|submit|send|review|approve|upload|download|create|add|remove|check|verify|scan|record|label|convert|export|save|move|route|assign|notify|publish|pay|sign|login|log in|navigate|press|tap)\b/i;
  const actions = candidates.filter((item) => actionPattern.test(item));
  const source = actions.length ? actions : candidates;
  return source.slice(0, MAX_WORKFLOW_STEPS).map((step, index) => ({
    step: index + 1,
    label: step.slice(0, 180),
  }));
}

export function extractProofPoints(text = '') {
  const candidates = sentenceCandidates(text);
  const proofPattern = /(\$\s?\d|\b\d+(?:\.\d+)?%|\b\d{2,}\b|customer|client|tested|measured|result|revenue|conversion|ctr|cpc|cpa|roas|hours?|days?|users?|orders?|cases?|pilot|benchmark)/i;
  return candidates.filter((item) => proofPattern.test(item)).slice(0, 5);
}

export function deriveMissingEvidence(text = '', proofPoints = [], workflowSteps = []) {
  const notes = String(text || '').trim();
  const missing = [];
  if (!notes) missing.push('No transcript or operator notes supplied — the visual layer can segment change, but not infer the business meaning of each scene yet.');
  if (!proofPoints.length) {
    const finalStep = workflowSteps.at?.(-1)?.label || workflowSteps[workflowSteps.length - 1]?.label;
    missing.push(finalStep
      ? `The workflow reaches “${finalStep.slice(0, 120)}” but no measurable result, customer outcome, or constraint is attached to that step.`
      : 'No concrete proof point, customer example, or measurable constraint was detected.');
  }
  if (notes && !/\b(result|outcome|revenue|conversion|saved|reduced|increased|decreased|faster|cheaper|accuracy|time|cost|roi|roas)\b/i.test(notes)) {
    missing.push('No explicit outcome is stated, so the recommendation layer cannot tie the workflow to measurable value yet.');
  }
  return missing.slice(0, 3);
}

function deriveRecommendedEdit(text = '', proofPoints = [], workflowSteps = [], temporalReadout = null) {
  const finalStep = workflowSteps.at?.(-1)?.label || workflowSteps[workflowSteps.length - 1]?.label || '';
  const firstProof = proofPoints[0] || '';

  if (!firstProof) {
    return {
      headline: 'Add measurable proof before the final action',
      instruction: finalStep
        ? `Insert one concrete result, customer outcome or measurable constraint before “${finalStep.slice(0, 120)}”.`
        : 'Insert one concrete result, customer outcome or measurable constraint before the final CTA or workflow action.',
      timingNote: 'The transcript is not time-aligned, so V0.1 will not invent an exact video second for this edit.',
    };
  }

  if (finalStep) {
    const proofIndex = String(text).indexOf(firstProof);
    const stepIndex = String(text).indexOf(finalStep);
    if (proofIndex >= 0 && stepIndex >= 0 && proofIndex > stepIndex) {
      return {
        headline: 'Move proof before the action',
        instruction: `Move “${firstProof.slice(0, 135)}” before “${finalStep.slice(0, 110)}” so evidence arrives before the ask.`,
        timingNote: 'This recommendation uses transcript order only; exact video placement requires timestamped transcript/audio.',
      };
    }
  }

  const strongestWindow = temporalReadout?.windows?.strongest;
  return {
    headline: 'Keep proof attached to the strongest transition',
    instruction: firstProof
      ? `Keep “${firstProof.slice(0, 135)}” visually close to the claim or action it supports.`
      : 'Keep the strongest evidence visually close to the claim or action it supports.',
    timingNote: strongestWindow
      ? `Highest average response-change window is ${formatTime(strongestWindow.start)}–${formatTime(strongestWindow.end)}; V0.1 cannot verify whether that window contains the claim or proof.`
      : 'Exact video placement requires timestamped transcript/audio.',
  };
}

export function buildMultimodalFusion({ text = '', media = null } = {}) {
  const signals = Array.isArray(media?.signals) ? media.signals : [];
  const events = deriveVisualEvents(signals);
  const temporalReadout = deriveTemporalReadout(signals);
  const workflowSteps = extractWorkflowSteps(text);
  const proofPoints = extractProofPoints(text);
  const missingEvidence = deriveMissingEvidence(text, proofPoints, workflowSteps);
  const recommendedEdit = deriveRecommendedEdit(text, proofPoints, workflowSteps, temporalReadout);
  const duration = Number(media?.duration) || 0;
  const packetLines = [
    '[BrainSNN multimodal video packet]',
    `File: ${media?.fileName || 'local video'}`,
    `Duration: ${duration ? `${duration.toFixed(1)} seconds` : 'unknown'}`,
    `Sampled frames: ${signals.length}`,
    `Detected visual transitions: ${events.filter((event) => event.level !== 'low').length}`,
  ];

  if (events.length) {
    packetLines.push('Visual timeline:');
    for (const event of events) packetLines.push(`- ${event.timeLabel}: ${event.label} (${Math.round(event.intensity * 100)}% change intensity)`);
  }
  if (workflowSteps.length) {
    packetLines.push('Transcript-derived workflow:');
    for (const step of workflowSteps) packetLines.push(`- Step ${step.step}: ${step.label}`);
  }
  if (proofPoints.length) {
    packetLines.push('Concrete proof / constraints found:');
    for (const proof of proofPoints) packetLines.push(`- ${proof}`);
  }
  if (text.trim()) packetLines.push('Transcript / operator notes:', text.trim());

  return {
    packet: packetLines.join('\n'),
    result: {
      schemaVersion: 'brainsnn.multimodal.v0.1',
      mode: 'browser-sampled-video',
      fileName: media?.fileName || 'local video',
      duration,
      frameCount: signals.length,
      events,
      temporalReadout,
      workflowSteps,
      proofPoints,
      missingEvidence,
      recommendedEdit,
      commercialUses: [
        'Security-footage triage and timestamped event review',
        'Screen-recording to structured workflow / SOP draft',
        'Creative video segmentation before publishing',
      ],
      provenance: {
        visual: 'browser-local 64×36 frame sampling',
        transcript: text.trim() ? 'operator-supplied transcript / notes; not time-aligned' : 'none',
        audio: 'not analyzed',
        objectRecognition: 'not available',
        neuralValidation: 'not measured',
      },
      disclaimer: 'V0.1 samples visual-change signals in the browser and fuses them with transcript/notes. A transition means pixels changed; it does not identify people, objects, actions, audio, purchase intent or measured brain activity.',
    },
  };
}
