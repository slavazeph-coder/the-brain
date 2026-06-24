import { useCallback, useEffect, useReducer, useRef } from 'react';
import { analyzeContentLocally } from '../../lib/analysisEngine.js';
import { track } from '../../lib/analytics.js';
import { validateScanInput } from '../../lib/validation.js';

export const initialScanState = {
  status: 'idle',
  input: '',
  contentType: 'text',
  result: null,
  error: '',
  validation: validateScanInput(''),
};

export function scanReducer(state, action) {
  switch (action.type) {
    case 'set-input': {
      const validation = validateScanInput(action.input);
      return { ...state, input: action.input, validation, status: state.status === 'idle' ? 'editing' : state.status, error: '' };
    }
    case 'set-content-type':
      return { ...state, contentType: action.contentType };
    case 'scan-started':
      return { ...state, status: 'scanning', error: '', validation: validateScanInput(state.input) };
    case 'scan-success':
      return { ...state, status: action.result.isFallback ? 'fallback' : 'success', result: action.result, error: '' };
    case 'scan-error':
      return { ...state, status: 'error', error: action.error };
    case 'cancel':
      return { ...state, status: state.result ? 'success' : 'editing', error: 'Scan cancelled. Your input is preserved.' };
    case 'load-result':
      return {
        ...state,
        status: action.result?.isFallback ? 'fallback' : 'success',
        input: action.result?.rawContent || state.input,
        contentType: action.result?.contentType || state.contentType,
        result: action.result,
        error: '',
        validation: validateScanInput(action.result?.rawContent || state.input),
      };
    case 'reset':
      return initialScanState;
    default:
      return state;
  }
}

export function useScanEngine() {
  const [state, dispatch] = useReducer(scanReducer, initialScanState);
  const abortRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  const runScan = useCallback(async (overrideInput) => {
    const input = overrideInput ?? state.input;
    const validation = validateScanInput(input);
    if (!validation.valid) {
      dispatch({ type: 'set-input', input });
      return null;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    dispatch({ type: 'scan-started' });
    track('scan_started', { contentType: state.contentType, length: input.length });

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input, contentType: state.contentType, type: state.contentType }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Analysis service unavailable.');
      if (requestRef.current !== requestId) return null;
      dispatch({ type: 'scan-success', result: payload });
      track(payload.isFallback ? 'scan_fallback_completed' : 'scan_completed', { contentType: state.contentType });
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') return null;
      if (typeof window !== 'undefined' && window.__BRAINSNN_ALLOW_LOCAL_FALLBACK__) {
        const fallback = analyzeContentLocally({ content: input, contentType: state.contentType, forceFallback: true });
        dispatch({ type: 'scan-success', result: fallback });
        track('scan_fallback_completed', { contentType: state.contentType, local: true });
        return fallback;
      }
      dispatch({ type: 'scan-error', error: error.message || 'BrainSNN could not complete this scan.' });
      track('scan_failed', { contentType: state.contentType });
      return null;
    }
  }, [state.contentType, state.input]);

  const cancelScan = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'cancel' });
  }, []);

  return {
    state,
    setInput: (input) => dispatch({ type: 'set-input', input }),
    setContentType: (contentType) => dispatch({ type: 'set-content-type', contentType }),
    runScan,
    cancelScan,
    loadResult: (result) => dispatch({ type: 'load-result', result }),
    reset: () => dispatch({ type: 'reset' }),
  };
}
