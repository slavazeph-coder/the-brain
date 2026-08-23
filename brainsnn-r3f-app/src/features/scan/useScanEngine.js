import { useCallback, useEffect, useReducer, useRef } from 'react';
import { analyzeContentLocally } from '../../lib/analysisEngine.js';
import { track } from '../../lib/analytics.js';
import { buildBeliefMultimodalFusion as buildMultimodalFusion } from '../../lib/beliefFusion.js';
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
        response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: analysisContent, contentType: 'video', type: 'video' }),
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

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Analysis service unavailable.');
      if (requestRef.current !== requestId) return null;

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
