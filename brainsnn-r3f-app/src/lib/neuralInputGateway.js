export const NEURAL_GATEWAY_SCHEMA_VERSION = 'brainsnn.neural-input.v1';
export const NEURAL_GATEWAY_VERSION = '0.1.0';
export const NEURAL_MODALITIES = ['meg', 'eeg', 'decoded_text'];
export const NEURAL_INPUT_DISCLAIMER =
  'Experimental research adapter. BrainSNN receives decoder output and does not measure thoughts, diagnose conditions, or replace clinical interpretation.';

const MAX_TRANSCRIPT_LENGTH = 12000;
const MAX_TOKEN_CONFIDENCES = 512;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeLabel(value, fallback, maxLength = 120) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, maxLength);
}

function safeOptionalNumber(value, minimum, maximum) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, minimum, maximum);
}

function normalizeCapturedAt(value, now) {
  const parsed = value ? new Date(value) : now();
  return Number.isNaN(parsed.getTime()) ? now().toISOString() : parsed.toISOString();
}

export function normalizeConfidence(value, fallback = 0) {
  let parsed = finiteNumber(value, fallback);
  if (parsed > 1) parsed /= 100;
  return Number(clamp(parsed, 0, 1).toFixed(4));
}

export function normalizeModality(value) {
  const normalized = String(value || 'decoded_text').trim().toLowerCase();
  return NEURAL_MODALITIES.includes(normalized) ? normalized : 'decoded_text';
}

export function sanitizeDecodedText(value) {
  const normalized = String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .trim();

  if (normalized.length > MAX_TRANSCRIPT_LENGTH) {
    throw new Error(`Decoded transcript exceeds ${MAX_TRANSCRIPT_LENGTH} characters.`);
  }

  return normalized;
}

export function normalizeTokenConfidences(value, decodedText = '') {
  if (!Array.isArray(value)) return [];
  const transcriptTokens = String(decodedText).split(/\s+/).filter(Boolean);

  return value.slice(0, MAX_TOKEN_CONFIDENCES).map((item, index) => {
    if (typeof item === 'number') {
      return {
        token: transcriptTokens[index] || `token_${index + 1}`,
        confidence: normalizeConfidence(item),
      };
    }

    const token = safeLabel(item?.token ?? item?.text, transcriptTokens[index] || `token_${index + 1}`, 80);
    const confidence = normalizeConfidence(item?.confidence ?? item?.score ?? item?.probability, 0);
    return { token, confidence };
  });
}

function createBaseEnvelope(payload, decodedText, mode, now) {
  const modality = normalizeModality(payload.modality);
  const confidence = normalizeConfidence(payload.confidence ?? payload.score ?? payload.probability, 0);
  const capturedAt = normalizeCapturedAt(payload.capturedAt ?? payload.timestamp, now);

  return {
    schemaVersion: NEURAL_GATEWAY_SCHEMA_VERSION,
    gatewayVersion: NEURAL_GATEWAY_VERSION,
    mode,
    modality,
    decodedText,
    confidence,
    tokenConfidences: normalizeTokenConfidences(
      payload.tokenConfidences ?? payload.tokens ?? payload.token_scores,
      decodedText,
    ),
    provenance: {
      source: safeLabel(payload.source, mode === 'remote' ? 'remote-decoder' : 'manual-replay'),
      decoder: safeLabel(payload.decoder ?? payload.model, mode === 'remote' ? 'external-neural-decoder' : 'replay-fixture'),
      modelVersion: safeLabel(payload.modelVersion ?? payload.model_version, 'unknown', 80),
      sessionId: safeLabel(payload.sessionId ?? payload.session_id, 'unassigned', 120),
    },
    capture: {
      capturedAt,
      sampleRateHz: safeOptionalNumber(payload.sampleRateHz ?? payload.sample_rate_hz, 1, 100000),
      channelCount: safeOptionalNumber(payload.channelCount ?? payload.channel_count, 1, 10000),
      durationMs: safeOptionalNumber(payload.durationMs ?? payload.duration_ms, 0, 86400000),
    },
    research: {
      consentConfirmed: Boolean(payload.consentConfirmed ?? payload.consent_confirmed),
      rawSignalRetained: false,
      disclaimer: NEURAL_INPUT_DISCLAIMER,
    },
  };
}

export function createReplayNeuralInput(payload = {}, now = () => new Date()) {
  const decodedText = sanitizeDecodedText(payload.decodedText ?? payload.transcript ?? payload.text);
  if (!decodedText) throw new Error('decodedText is required for replay mode.');
  return createBaseEnvelope(payload, decodedText, 'replay', now);
}

export function normalizeRemoteDecoderResponse(response = {}, request = {}, now = () => new Date()) {
  const decodedText = sanitizeDecodedText(
    response.decodedText ?? response.transcript ?? response.text ?? response.prediction,
  );
  if (!decodedText) throw new Error('Remote decoder returned no decoded text.');

  return createBaseEnvelope(
    {
      ...request,
      ...response,
      modality: response.modality ?? request.modality,
      source: response.source ?? request.source ?? 'remote-decoder',
      decoder: response.decoder ?? response.model ?? request.decoder,
      modelVersion: response.modelVersion ?? response.model_version ?? request.modelVersion,
      sessionId: response.sessionId ?? response.session_id ?? request.sessionId,
      capturedAt: response.capturedAt ?? response.timestamp ?? request.capturedAt,
      tokenConfidences: response.tokenConfidences ?? response.tokens ?? response.token_scores,
      confidence: response.confidence ?? response.score ?? response.probability,
    },
    decodedText,
    'remote',
    now,
  );
}

export function getNeuralGatewayCapabilities(env = {}) {
  return {
    schemaVersion: NEURAL_GATEWAY_SCHEMA_VERSION,
    gatewayVersion: NEURAL_GATEWAY_VERSION,
    modes: ['replay', 'remote'],
    modalities: [...NEURAL_MODALITIES],
    remoteConfigured: Boolean(env.NEURAL_DECODER_URL),
    retainsRawSignal: false,
    disclaimer: NEURAL_INPUT_DISCLAIMER,
  };
}
