import { useCallback, useEffect, useRef, useState } from 'react';
import { analyzeContentLocally } from '../../lib/analysisEngine.js';
import { runLayerRouter } from '../../lib/layerRouter.js';
import { validateScanInput } from '../../lib/validation.js';
import { analyzeSensitivity } from '../../lib/ablation.js';
import { track } from '../../lib/analytics.js';

// Deterministic scan-time pause so the brain burst reads as a live simulation
// instead of an instant table swap.
const SIMULATION_MS = 550;

// Challenge links carry the pasted text in the same `state` param the other
// arcade labs use, so the arcade's lab-switch cleanup applies unchanged.
export const SHARED_TEXT_LIMIT = 1600;

export function parseSharedContent(search) {
  const params = new URLSearchParams(search || '');
  if (params.get('lab') !== 'content') return null;
  const raw = params.get('state');
  if (!raw) return null;
  const text = String(raw).slice(0, SHARED_TEXT_LIMIT).trim();
  return validateScanInput(text).valid ? text : null;
}

export function buildContentShareUrl(href, text) {
  const url = new URL(href);
  url.searchParams.set('lab', 'content');
  url.searchParams.delete('run');
  url.searchParams.set('state', String(text || '').slice(0, SHARED_TEXT_LIMIT));
  url.hash = 'playground';
  return url.toString();
}

export function scanContentLocally(content) {
  const baseResult = analyzeContentLocally({ content, contentType: 'text', forceFallback: true });
  return runLayerRouter({ content, contentType: 'text', baseResult });
}

// Fully client-side scan for the arcade's Content Reaction Lab: no fetch, no
// cold start. The full /app workspace keeps its server-backed useScanEngine.
export function useContentScan() {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [previousResult, setPreviousResult] = useState(null);
  const [sensitivity, setSensitivity] = useState(null);
  const [error, setError] = useState('');
  const timerRef = useRef(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const runSimulation = useCallback((override) => {
    const content = typeof override === 'string' ? override : input;
    const validation = validateScanInput(content);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }
    setError('');
    setStatus('running');
    track('gaugegap_content_scan_started', { chars: content.length });
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const nextResult = scanContentLocally(content);
      setResult((current) => {
        setPreviousResult(current);
        return nextResult;
      });
      // Leave-one-sentence-out attribution and its jackknife band. Measured at
      // ~27 ms for the 18-sentence ceiling, so it runs inline with the scan.
      setSensitivity(analyzeSensitivity(content));
      setStatus('done');
      track('gaugegap_content_scan_completed', { risk: nextResult.gaugeGapScore });
    }, SIMULATION_MS);
  }, [input]);

  const applyContent = useCallback((content, { autoRun = true } = {}) => {
    setInput(content);
    setError('');
    if (autoRun) runSimulation(content);
  }, [runSimulation]);

  return { input, setInput, status, result, previousResult, sensitivity, error, setError, runSimulation, applyContent };
}
