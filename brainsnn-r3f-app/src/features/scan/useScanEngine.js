import { useCallback, useEffect, useReducer, useRef } from 'react';
import { analyzeContentLocally } from '../../lib/analysisEngine.js';
import { track } from '../../lib/analytics.js';
import { buildMultimodalFusion } from '../../lib/mediaFusion.js';
import { validateScanInput } from '../../lib/validation.js';

export const initialScanState = {
  status: 'idle',
  input: '',
  contentType: 'text',
  media: null,
  result: null,
  error: '',
  validation: validateScanInput(''),
};

function normalizeContentType(contentType) {
  return contentType === 'script' ? 'video' : (contentType || 'text');
}

function stableBrowserHash(value = '') {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeBrowserFilename(value = '') {
  const basename = String(value).normalize('NFKC').split(/[\\/]/).pop() || 'local-video';
  return basename
    .replace(/\.{2,}/g, '_')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'local-video';
}

function finiteObservation(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function buildNeuralMirrorRequest({ input = '', media = null } = {}) {
  const filename = media?.fileName ? safeBrowserFilename(media.fileName) : '';
  const durationMs = Math.max(0, Math.round(finiteObservation(media?.duration) * 1000));
  const mimeType = media?.mimeType ? String(media.mimeType).slice(0, 120) : '';
  const identity = JSON.stringify({
    type: 'video',
    filename,
    durationMs,
    mimeType,
    fileSize: Math.max(0, Math.round(finiteObservation(media?.fileSize))),
  });
  const vision = (Array.isArray(media?.signals) ? media.signals : []).map((signal) => ({
    timestampMs: Math.max(0, Math.round(finiteObservation(signal.timestamp) * 1000)),
    luminance: finiteObservation(signal.luminance),
    motion: finiteObservation(signal.motion),
    red: finiteObservation(signal.red),
    green: finiteObservation(signal.green),
    blue: finiteObservation(signal.blue),
  }));
  const audio = (Array.isArray(media?.audioSignals) ? media.audioSignals : []).map((signal) => ({
    timestampMs: Math.max(0, Math.round(finiteObservation(signal.timestamp) * 1000)),
    audioEnergy: finiteObservation(signal.energy),
  }));

  return {
    input: {
      schemaVersion: 'brainsnn.multimodal.v1',
      id: `browser-${stableBrowserHash(identity)}`,
      source: {
        type: 'video',
        ...(filename ? { filename } : {}),
        ...(durationMs > 0 ? { durationMs } : {}),
        ...(mimeType ? { mimeType } : {}),
      },
      text: {
        transcript: String(input || '').trim(),
        language: 'en',
      },
      observations: { vision, audio },
      provenance: {
        userProvided: true,
        extractorVersions: { browserSampler: '1.0.0' },
      },
    },
    options: { ablation: 'all' },
  };
}

export function scanReducer(state, action) {
  switch (action.type) {
    case 'set-input': {
      const validation = validateScanInput(action.input);
      return { ...state, input: action.input, validation, status: state.status === 'idle' ? 'editing' : state.status, error: '' };
    }
    case 'set-content-type':
      return { ...state, contentType: normalizeContentType(action.contentType), error: '' };
    case 'set-media':
      return { ...state, media: action.media, status: state.status === 'idle' ? 'editing' : state.status, error: '' };
    case 'scan-started':
      return { ...state, status: 'scanning', error: '', validation: validateScanInput(state.input) };
    case 'scan-success':
      return { ...state, status: action.result.isFallback ? 'fallback' : 'success', result: action.result, error: '' };
    case 'scan-error':
      return { ...state, status: 'error', error: action.error };
    case 'cancel':
      return { ...state, status: state.result ? 'success' : 'editing', error: 'Scan cancelled. Your input is preserved.' };
    case 'load-result': {
      const restoredInput = action.result?.rawContent || state.input;
      return {
        ...state,
        status: action.result?.isFallback ? 'fallback' : 'success',
        input: restoredInput,
        contentType: normalizeContentType(action.result?.contentType || state.contentType),
        media: null,
        result: action.result,
        error: '',
        validation: validateScanInput(restoredInput),
      };
    }
    case 'reset':
      return initialScanState;
    default:
      return state;
  }
}

function createNeuralReplayFallback(input) {
  return {
    schemaVersion: 'brainsnn.neural-input.v1',
    mode: 'replay',
    modality: 'decoded_text',
    decodedText: input,
    confidence: 0.8,
    provenance: { source: 'manual-ui', decoder: 'manual-replay', modelVersion: 'unknown', sessionId: 'unassigned' },
    research: { consentConfirmed: true, rawSignalRetained: false },
  };
}

export function useScanEngine() {
  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  const abortRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runScan = useCallback(async (overrideInput) => {
    const input = overrideInput ?? state.input;
    const contentType = normalizeContentType(state.contentType);
    const validation = validateScanInput(input);
    const mediaReady = contentType === 'video' && Boolean(state.media?.signals?.length);
    if (!validation.valid && !mediaReady) {
      dispatch({ type: 'set-input', input });
      return null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    dispatch({ type: 'scan-started' });
    track('scan_started', { contentType, length: input.length, media: mediaReady });

    let fusion = null;
    let analysisContent = input;
    try {
      let response;
      if (contentType === 'video') {
        fusion = buildMultimodalFusion({ text: input, media: state.media });
        analysisContent = fusion.packet;
        response = await fetch('/api/v1/neural/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildNeuralMirrorRequest({ input, media: state.media })),
          signal: controller.signal,
        });
      } else if (contentType === 'neural') {
        response = await fetch('/api/neural/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decodedText: input,
            modality: 'decoded_text',
            confidence: 0.8,
            source: 'manual-ui',
            decoder: 'manual-replay',
            consentConfirmed: true,
          }),
          signal: controller.signal,
        });
      } else {
        response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: input, contentType, type: contentType }),
          signal: controller.signal,
        });
      }

      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const apiMessage = responsePayload.message
          || (typeof responsePayload.error === 'string' ? responsePayload.error : responsePayload.error?.message);
        throw new Error(apiMessage || 'Analysis service unavailable.');
      }
      if (requestRef.current !== requestId) return null;

      // The V1 prediction endpoint returns the combined scan directly. Accept a
      // `{ result }` wrapper defensively for local fixtures without changing the
      // canonical browser contract.
      const payload = contentType === 'video'
        && responsePayload?.result
        && typeof responsePayload.result === 'object'
        ? responsePayload.result
        : responsePayload;

      const result = contentType === 'neural'
        ? {
            ...payload.result,
            rawContent: input,
            contentType: 'neural',
            neuralInput: payload.neuralInput,
            neuralUncertainty: payload.uncertainty,
          }
        : contentType === 'video'
          ? {
              ...payload,
              rawContent: input,
              contentType: 'video',
              multimodal: fusion.result,
            }
          : payload;

      dispatch({ type: 'scan-success', result });
      track(result.isFallback ? 'scan_fallback_completed' : 'scan_completed', { contentType });
      return result;
    } catch (error) {
      if (error.name === 'AbortError') return null;
      if (typeof window !== 'undefined' && window.__BRAINSNN_ALLOW_LOCAL_FALLBACK__) {
        const fallbackSource = contentType === 'video' ? analysisContent : input;
        const local = analyzeContentLocally({ content: fallbackSource, contentType: contentType === 'neural' ? 'text' : contentType, forceFallback: true });
        const fallback = contentType === 'video'
          ? { ...local, rawContent: input, contentType: 'video', multimodal: fusion?.result }
          : contentType === 'neural'
            ? {
                ...local,
                rawContent: input,
                contentType: 'neural',
                neuralInput: createNeuralReplayFallback(input),
                neuralUncertainty: { confidence: 0.8, band: 'high', label: 'Manual replay input; remote neural gateway was unavailable.' },
              }
            : local;
        dispatch({ type: 'scan-success', result: fallback });
        track('scan_fallback_completed', { contentType, local: true });
        return fallback;
      }
      dispatch({ type: 'scan-error', error: error.message || 'BrainSNN could not complete this scan.' });
      track('scan_failed', { contentType });
      return null;
    }
  }, [state.contentType, state.input, state.media]);

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'cancel' });
  }, []);

  return {
    state,
    setInput: (input) => dispatch({ type: 'set-input', input }),
    setContentType: (contentType) => dispatch({ type: 'set-content-type', contentType }),
    setMedia: (media) => dispatch({ type: 'set-media', media }),
    runScan,
    cancelScan,
    loadResult: (result) => dispatch({ type: 'load-result', result }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
