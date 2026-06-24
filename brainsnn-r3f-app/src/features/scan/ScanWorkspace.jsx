import React, { useCallback, useEffect } from 'react';
import { ErrorState } from '../../components/ui/ErrorState.jsx';
import { ResultsWorkspace } from '../results/ResultsWorkspace.jsx';
import { ScanComposer } from './ScanComposer.jsx';
import { track } from '../../lib/analytics.js';

export function ScanWorkspace({ scan, onImprove, onSave, onQueue, onExport }) {
  useEffect(() => {
    track('cortex_viewed');
  }, []);

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
      {scan.state.result ? (
        <ResultsWorkspace
          result={scan.state.result}
          onImprove={onImprove}
          onSave={onSave}
          onQueue={onQueue}
          onExport={onExport}
        />
      ) : null}
    </div>
  );
}
