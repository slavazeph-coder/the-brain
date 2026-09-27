export const MULTIMODAL_SCHEMA_VERSION = 'brainsnn.multimodal.v1';
export const MULTIMODAL_SOURCE_TYPES = Object.freeze(['text', 'video', 'audio', 'image', 'mixed']);
export const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;
export const DEFAULT_MAX_TRANSCRIPT_CHARS = 100_000;

const MIME_BY_TYPE = Object.freeze({
  text: new Set(['text/plain', 'text/markdown', 'text/vtt', 'application/json']),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']),
  audio: new Set(['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/flac']),
  image: new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
});

const PRIVATE_SOURCE_FIELDS = new Set([
  'path', 'filePath', 'filepath', 'localPath', 'local_path', 'tempPath', 'temp_path',
  'absolutePath', 'absolute_path', 'directory', 'cwd',
]);

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeText(value, maximum, field) {
  const text = String(value ?? '').replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim();
  if (text.length > maximum) throw new Error(`${field} exceeds ${maximum} characters.`);
  return text;
}

function safeId(value, fallback) {
  const normalized = String(value || fallback || '')
    .normalize('NFKC')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return normalized || fallback;
}

function smallStableHash(value = '') {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeSafeFilename(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const filename = String(value).normalize('NFKC').trim();
  if (!filename || filename.length > 255) throw new Error('filename must be between 1 and 255 characters.');
  if (/[\\/\u0000-\u001f\u007f]/.test(filename) || filename === '.' || filename === '..' || filename.includes('..')) {
    throw new Error('filename must not contain path traversal or control characters.');
  }
  const sanitized = filename.replace(/[^\p{L}\p{N} ._()-]+/gu, '_').replace(/\s+/g, ' ').trim();
  if (!sanitized) throw new Error('filename does not contain a usable name.');
  return sanitized;
}

function ipv4Parts(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split('.').map(Number);
  return parts.every((part) => part >= 0 && part <= 255) ? parts : null;
}

function isPrivateIpv4(hostname) {
  const parts = ipv4Parts(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

function isPrivateIpv6(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  if (/^(fc|fd)/.test(host) || /^fe[89ab]/.test(host)) return true;
  const mapped = host.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

export function assertSafeRemoteUrl(value, { allowHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new Error('source.url must be a valid absolute URL.');
  }
  if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
    throw new Error('source.url must use HTTPS.');
  }
  if (parsed.username || parsed.password) throw new Error('source.url must not contain credentials.');
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || hostname === 'metadata.google.internal'
    || isPrivateIpv4(hostname)
    || isPrivateIpv6(hostname)) {
    throw new Error('source.url must not target a local, private, or link-local address.');
  }
  parsed.hash = '';
  return parsed.toString();
}

function normalizeMime(type, value) {
  if (!value) return undefined;
  const mime = String(value).split(';')[0].trim().toLowerCase();
  const allowed = type === 'mixed'
    ? Object.values(MIME_BY_TYPE).some((items) => items.has(mime))
    : MIME_BY_TYPE[type]?.has(mime);
  if (!allowed) throw new Error(`Unsupported MIME type "${mime}" for ${type} input.`);
  return mime;
}

function normalizePreprocessingFeatures(value = {}) {
  const result = {};
  for (const key of ['sceneChange', 'audioEnergy', 'visualChange', 'luminance', 'motion', 'red', 'green', 'blue', 'spectralCentroid', 'zeroCrossingRate']) {
    const parsed = finite(value[key]);
    if (parsed !== null) result[key] = Number(clamp(parsed).toFixed(6));
  }
  if (value.speechPresent !== undefined) result.speechPresent = Boolean(value.speechPresent);
  return result;
}

function normalizeTemporalSegments(value, durationMs) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5000).map((segment, index) => {
    const startMs = finite(segment?.startMs);
    const endMs = finite(segment?.endMs);
    if (startMs === null || endMs === null || startMs < 0 || endMs <= startMs || (durationMs && endMs > durationMs)) {
      throw new Error(`temporal.segments[${index}] has invalid timestamps.`);
    }
    return {
      index: Number.isInteger(segment.index) && segment.index >= 0 ? segment.index : index,
      startMs,
      endMs,
      ...(segment.id ? { id: safeId(segment.id, `source-segment-${index}`) } : {}),
      ...(segment.text ? { text: safeText(segment.text, 20_000, `temporal.segments[${index}].text`) } : {}),
      features: normalizePreprocessingFeatures(segment.features),
    };
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.index - b.index);
}

function normalizeSignalSeries(signals = {}) {
  const normalizeSeries = (items, kind) => Array.isArray(items) ? items.slice(0, 5000).map((item, index) => {
    const timestampMs = finite(item?.timestampMs ?? (finite(item?.timestamp) !== null ? Number(item.timestamp) * 1000 : null));
    if (timestampMs === null || timestampMs < 0) throw new Error(`signals.${kind}[${index}] has an invalid timestamp.`);
    return { timestampMs, ...normalizePreprocessingFeatures(item) };
  }).sort((a, b) => a.timestampMs - b.timestampMs) : [];
  return {
    vision: normalizeSeries(signals.vision ?? signals.visual, 'vision'),
    audio: normalizeSeries(signals.audio, 'audio'),
  };
}

function rejectFilesystemFields(source) {
  for (const key of Object.keys(source || {})) {
    if (PRIVATE_SOURCE_FIELDS.has(key)) throw new Error(`source.${key} is not accepted by the public input schema.`);
  }
}

export function normalizeMultimodalInput(input = {}, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Multimodal input must be an object.');
  if (input.schemaVersion && input.schemaVersion !== MULTIMODAL_SCHEMA_VERSION) {
    throw new Error(`Unsupported multimodal schemaVersion "${input.schemaVersion}".`);
  }
  const sourceInput = input.source && typeof input.source === 'object' ? input.source : {};
  rejectFilesystemFields(sourceInput);
  const type = String(sourceInput.type || options.defaultType || (input.text ? 'text' : '')).toLowerCase();
  if (!MULTIMODAL_SOURCE_TYPES.includes(type)) throw new Error('source.type must be text, video, audio, image, or mixed.');

  const maxDurationMs = finite(options.maxDurationMs, DEFAULT_MAX_DURATION_MS);
  const durationMs = finite(sourceInput.durationMs ?? input.temporal?.endMs);
  if (durationMs !== null && (durationMs <= 0 || durationMs > maxDurationMs)) {
    throw new Error(`source.durationMs must be greater than 0 and no more than ${maxDurationMs}.`);
  }
  const filename = normalizeSafeFilename(sourceInput.filename);
  const mimeType = normalizeMime(type, sourceInput.mimeType);
  const url = sourceInput.url
    ? assertSafeRemoteUrl(sourceInput.url, { allowHttp: Boolean(options.allowHttpRemoteUrls) })
    : undefined;
  const transcript = safeText(input.text?.transcript ?? input.text?.text ?? '', options.maxTranscriptChars || DEFAULT_MAX_TRANSCRIPT_CHARS, 'text.transcript');
  if (type === 'text' && !transcript) throw new Error('text.transcript is required for text input.');
  if (!filename && !url && !transcript && type !== 'mixed') {
    throw new Error('Input must include a transcript, safe filename, or remote URL.');
  }

  const temporalStart = finite(input.temporal?.startMs, 0);
  const temporalEnd = finite(input.temporal?.endMs, durationMs ?? null);
  if (temporalStart < 0 || (temporalEnd !== null && temporalEnd <= temporalStart)) {
    throw new Error('temporal start/end timestamps are invalid.');
  }
  const resolvedDuration = durationMs ?? (temporalEnd !== null ? temporalEnd - temporalStart : null);
  const segments = normalizeTemporalSegments(input.temporal?.segments ?? input.text?.segments, resolvedDuration);
  const signals = normalizeSignalSeries(input.signals ?? input.observations);
  const sourceFingerprint = JSON.stringify({ type, filename, url, durationMs: resolvedDuration, mimeType, transcript });
  const id = safeId(input.id, `stimulus-${smallStableHash(sourceFingerprint)}`);

  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id,
    source: {
      type,
      ...(filename ? { filename } : {}),
      ...(url ? { url } : {}),
      ...(resolvedDuration !== null ? { durationMs: resolvedDuration } : {}),
      ...(mimeType ? { mimeType } : {}),
    },
    ...(transcript || input.text?.language ? {
      text: {
        ...(transcript ? { transcript } : {}),
        ...(input.text?.language ? { language: safeText(input.text.language, 32, 'text.language').toLowerCase() } : {}),
      },
    } : {}),
    temporal: {
      startMs: temporalStart,
      endMs: temporalEnd ?? temporalStart + (resolvedDuration ?? 1500),
      segments,
    },
    signals,
    provenance: {
      userProvided: input.provenance?.userProvided !== false,
      extractorVersions: Object.fromEntries(Object.entries(input.provenance?.extractorVersions || {})
        .slice(0, 50)
        .map(([key, value]) => [safeId(key, 'unknown'), safeText(value, 80, `extractorVersions.${key}`)])),
    },
  };
}

export function validateMultimodalInput(input, options = {}) {
  try {
    const normalized = normalizeMultimodalInput(input, options);
    return { valid: true, errors: [], value: normalized };
  } catch (error) {
    return { valid: false, errors: [error?.message || 'Invalid multimodal input.'], value: null };
  }
}

export function allowedMimeTypes(type) {
  if (type === 'mixed') return [...new Set(Object.values(MIME_BY_TYPE).flatMap((items) => [...items]))].sort();
  return [...(MIME_BY_TYPE[type] || [])].sort();
}
