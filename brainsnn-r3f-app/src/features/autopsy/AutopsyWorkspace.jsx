import React, { useMemo, useState } from 'react';
import { GitCompare, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { track } from '../../lib/analytics.js';
import { createAutopsyFromLayerStack } from '../../lib/layerRouter.js';
import { getBusinessMetrics } from '../../lib/scoreMapping.js';
import { BrainVisualizer } from '../results/BrainVisualizer.jsx';
import { LayerTracePanel } from '../results/LayerTracePanel.jsx';

const sampleA = 'Last chance to unlock the secret growth system before your competitors take the market.';
const sampleB = 'See the customer proof behind our growth system, then decide whether it fits your next campaign.';

function MetricRows({ result }) {
  const rows = getBusinessMetrics(result).filter((metric) => ['hookStrength', 'trust', 'manipulationRisk', 'shareability'].includes(metric.id));
  return (
    <div className="autopsy-metrics">
      {rows.map((metric) => (
        <div key={metric.id}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function AutopsyWorkspace({ onSendToImprove }) {
  const [left, setLeft] = useState(sampleA);
  const [right, setRight] = useState(sampleB);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const canRun = left.trim().length >= 12 && right.trim().length >= 12;
  const winnerLabel = useMemo(() => {
    if (!result) return '';
    if (result.winner === 'tie') return 'Tie. Use the lower-risk version.';
    return result.winner === 'left' ? 'Variant A wins' : 'Variant B wins';
  }, [result]);

  async function runAutopsy() {
    setError('');
    setMessage('');
    if (!canRun) {
      setError('Enter two meaningful variants to compare.');
      return;
    }
    setLoading(true);
    track('autopsy_started');
    try {
      const response = await fetch('/api/autopsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leftContent: left, rightContent: right }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.left || !body.right) throw new Error(body.error || 'Autopsy endpoint unavailable.');
      setResult(body);
      setMessage('Autopsy completed through the server layer stack.');
      track('autopsy_completed');
    } catch (error) {
      setResult(createAutopsyFromLayerStack(left, right));
      setMessage(`${error.message || 'Autopsy endpoint unavailable.'} Local layer comparison was used instead.`);
    } finally {
      setLoading(false);
    }
  }

  const winningResult = result?.winner === 'right' ? result.right : result?.left;
  const winningContent = result?.winner === 'right' ? right : left;

  return (
    <div className="autopsy-workspace" data-testid="autopsy-workspace">
      <header className="workspace-heading">
        <p className="bsn-kicker">Autopsy</p>
        <h1>Reverse-engineer which version should publish.</h1>
        <p>Battle two hooks, ads or posts through the BrainSNN layer stack. See the emotional triggers, trust pressure and decision score side by side.</p>
      </header>

      <section className="autopsy-input-grid" aria-label="Autopsy inputs">
        <label>
          Variant A
          <textarea value={left} onChange={(event) => setLeft(event.target.value)} />
        </label>
        <label>
          Variant B
          <textarea value={right} onChange={(event) => setRight(event.target.value)} />
        </label>
      </section>
      <div className="synapse-actions">
        <Button variant="primary" onClick={runAutopsy} disabled={!canRun || loading}>
          <GitCompare size={16} aria-hidden="true" /> {loading ? 'Running...' : 'Run Autopsy'}
        </Button>
        <Button variant="ghost" onClick={() => { setLeft(sampleA); setRight(sampleB); }}>
          Load example
        </Button>
      </div>
      {error ? <p role="alert" className="bsn-validation">{error}</p> : null}
      {message ? <p role="status" className="bsn-note autopsy-message">{message}</p> : null}

      {result ? (
        <div className="autopsy-results">
          <div className="autopsy-verdict">
            <Badge tone={result.winner === 'tie' ? 'warning' : 'cyan'}>{winnerLabel}</Badge>
            <h2>{result.explanation}</h2>
            <p>Scores: A {result.scores.left} / B {result.scores.right}. The winner is directional, based on hook strength, trust, manipulation risk and shareability.</p>
            <Button variant="secondary" onClick={() => onSendToImprove?.(winningResult, winningContent)}>
              <Sparkles size={16} aria-hidden="true" /> Improve winning version
            </Button>
          </div>
          <div className="autopsy-card-grid">
            <article className={result.winner === 'left' ? 'winner' : ''}>
              <h3>Variant A</h3>
              <p>{left}</p>
              <MetricRows result={result.left} />
            </article>
            <article className={result.winner === 'right' ? 'winner' : ''}>
              <h3>Variant B</h3>
              <p>{right}</p>
              <MetricRows result={result.right} />
            </article>
          </div>
          <BrainVisualizer result={winningResult} />
          <LayerTracePanel result={winningResult} />
        </div>
      ) : null}
    </div>
  );
}
