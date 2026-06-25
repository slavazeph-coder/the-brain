import React, { useCallback, useEffect, useRef } from 'react';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { ResultsWorkspace } from '../results/ResultsWorkspace.jsx';
import { EngineReadinessPanel } from './EngineReadinessPanel.jsx';
import { ScanComposer } from './ScanComposer.jsx';
import { track } from '../../lib/analytics.js';

export function ScanWorkspace({ scan, onImprove, onSave, onQueue, onExport }) {
  const resultsRef = useRef(null);

  useEffect(() => {
    track('cortex_viewed');
  }, []);

  useEffect(() => {
    if (!scan.state.result?.id) return;
    window.requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [scan.state.result?.id]);

  const run = useCallback(() => {
    scan.runScan();
  }, [scan]);

  return (
    <div>
      <ScanComposer scan={scan} onRun={run} />
      {scan.state.status === 'error' ? (
        <div style={{ marginTop: 18 }}>
          <ErrorState message={scan.state.error} onRetry={run} />
        </div>
      ) : null}
      {!scan.state.result && scan.state.status !== 'scanning' ? <EngineReadinessPanel /> : null}
      {scan.state.result ? (
        <div ref={resultsRef} className="results-scroll-anchor">
          <ResultsWorkspace
            result={scan.state.result}
            onImprove={onImprove}
            onSave={onSave}
            onQueue={onQueue}
            onExport={onExport}
          />
        </div>
      ) : null}
    </div>
  );
}
