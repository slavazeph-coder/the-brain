const MAX_WORKFLOW_STEPS = 8;
const MAX_EVENTS = 12;

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

/**
 * Browser-local sampling density. Short clips get enough samples to catch fast
 * UI steps; longer clips stay bounded so a visitor never pays an unbounded CPU
 * cost just for choosing a video.
 */
export function sampleCountForDuration(duration = 0) {
  const seconds = Math.max(0, Number(duration) || 0);
  if (seconds <= 20) return 12;
  if (seconds <= 45) return 16;
  if (seconds <= 90) return 24;
  if (seconds <= 180) return 28;
  return 32;
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

export function deriveVisualEvents(signals = []) {
  if (!signals.length) return [];
  return signals
    .map((signal, index) => {
      const motion = Number(signal.motion) || 0;
      const previous = signals[index - 1];
      const luminanceShift = previous ? Math.abs((signal.luminance || 0) - (previous.luminance || 0)) : 0;
      const intensity = clamp((motion * 2.2) + (luminanceShift * 0.8));
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

export function buildMultimodalFusion({ text = '', media = null } = {}) {
  const signals = Array.isArray(media?.signals) ? media.signals : [];
  const events = deriveVisualEvents(signals);
  const workflowSteps = extractWorkflowSteps(text);
  const proofPoints = extractProofPoints(text);
  const missingEvidence = deriveMissingEvidence(text, proofPoints, workflowSteps);
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
      workflowSteps,
      proofPoints,
      missingEvidence,
      commercialUses: [
        'Security-footage triage and timestamped event review',
        'Screen-recording to structured workflow / SOP draft',
        'Creative video segmentation before publishing',
      ],
      disclaimer: 'V0.1 samples visual-change signals in the browser and fuses them with transcript/notes. A transition means pixels changed; it does not identify people, objects, actions, or audio yet.',
    },
  };
}
