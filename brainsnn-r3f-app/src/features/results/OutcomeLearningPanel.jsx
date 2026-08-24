import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, GitCompareArrows, RefreshCw, Save, Target, Trash2, TrendingUp, WifiOff } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import {
  OUTCOME_METRICS,
  createOutcomeRecord,
  evaluateAgainstBrandHistory,
  formatMetricValue,
} from '../../lib/outcomeLearning.js';
import {
  deleteBrandBrainOutcome,
  ensureBrandBrainWorkspace,
  getBrandBrainStatus,
  importLegacyBrandBrainHistory,
  listBrandBrainBrands,
  listBrandBrainHistory,
  saveBrandBrainOutcome,
} from '../../lib/brandBrainClient.js';

function featureLabel(feature = '') {
  return ({
    decisionScore: 'decision score',
    trust: 'trust signal',
    manipulationSafety: 'low-pressure signal',
    meanSurprise: 'pattern surprise',
    surpriseVariance: 'surprise variability',
    agreement: 'cross-model agreement',
    transitionRate: 'state-transition rate',
    reviewSafety: 'low-disagreement rate',
    stateDiversity: 'pattern diversity',
    dominantStateShare: 'dominant-state consistency',
    spikeRate: 'response-change density',
    sparsity: 'pattern sparsity',
    claimRate: 'claim-window rate',
    proofRate: 'proof-window rate',
    ctaRate: 'CTA-window rate',
  })[feature] || feature;
}

function maturityTone(id) {
  if (id === 'comparative') return 'cyan';
  if (id === 'directional') return 'warning';
  return 'neutral';
}

function fitTone(score) {
  if (score == null) return 'neutral';
  if (score >= 67) return 'cyan';
  if (score < 40) return 'warning';
  return 'neutral';
}

function syncTone(state) {
  if (state === 'ready') return 'cyan';
  if (state === 'unavailable' || state === 'offline' || state === 'error') return 'warning';
  return 'neutral';
}

function syncLabel(state) {
  return ({
    loading: 'SYNCING',
    ready: 'SERVER-BACKED HISTORY',
    unavailable: 'PERSISTENCE NOT CONFIGURED',
    offline: 'OFFLINE',
    error: 'SYNC ERROR',
  })[state] || 'SYNCING';
}

function resultModelVersion(result = {}) {
  return String(
    result?.modelVersion
      || result?.engineVersion
      || result?.multimodal?.beliefReport?.model?.version
      || result?.multimodal?.beliefReport?.model?.id
      || 'unknown',
  );
}

export function OutcomeLearningPanel({ result }) {
  const [records, setRecords] = useState([]);
  const [serverBrands, setServerBrands] = useState([]);
  const [credential, setCredential] = useState(null);
  const [syncState, setSyncState] = useState('loading');
  const [syncMessage, setSyncMessage] = useState('Connecting Brand Brain to server-backed workspace history…');
  const [brandName, setBrandName] = useState('');
  const [metricId, setMetricId] = useState('roas');
  const [creativeLabel, setCreativeLabel] = useState(result?.title || 'Current creative');
  const [outcomeValue, setOutcomeValue] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const synchronize = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncState('offline');
      setSyncMessage('You are offline. Brand Brain will not pretend outcomes were saved. Reconnect and retry.');
      return;
    }

    setSyncState('loading');
    setSyncMessage('Checking server-backed Brand Brain persistence…');
    try {
      const status = await getBrandBrainStatus();
      if (!status?.configured || status?.status !== 'ready') {
        setSyncState('unavailable');
        setSyncMessage(status?.message || 'Server-backed Brand Brain persistence is not configured.');
        setRecords([]);
        return;
      }

      const nextCredential = await ensureBrandBrainWorkspace();
      setCredential(nextCredential);
      const imported = await importLegacyBrandBrainHistory(nextCredential);
      const [history, brands] = await Promise.all([
        listBrandBrainHistory(nextCredential),
        listBrandBrainBrands(nextCredential),
      ]);
      setRecords(history);
      setServerBrands(brands);
      if (!brandName && history[0]?.brandName) setBrandName(history[0].brandName);
      setSyncState('ready');
      setSyncMessage(imported.imported
        ? `Connected. Imported ${imported.imported} legacy browser outcome${imported.imported === 1 ? '' : 's'} once into this workspace.`
        : 'Connected. Outcome history is stored server-side for this pilot workspace.');
    } catch (error) {
      const backendUnavailable = error?.payload?.configured === false || error?.status === 503;
      setSyncState(backendUnavailable ? 'unavailable' : 'error');
      setSyncMessage(backendUnavailable
        ? (error?.payload?.message || error?.message || 'Server-backed Brand Brain persistence is unavailable.')
        : (error?.message || 'Could not synchronize Brand Brain history.'));
      setRecords([]);
    }
  }, [brandName]);

  useEffect(() => {
    synchronize();
  // synchronize intentionally runs once on mount; brand selection must not recreate a workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onOffline = () => {
      setSyncState('offline');
      setSyncMessage('You are offline. New outcomes will not be saved until the server is reachable.');
    };
    const onOnline = () => synchronize();
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [synchronize]);

  useEffect(() => {
    setCreativeLabel(result?.title || (result?.id ? `Creative ${String(result.id).slice(0, 8)}` : 'Current creative'));
    setMessage('');
  }, [result?.id, result?.title]);

  const brands = useMemo(() => {
    const map = new Map();
    for (const item of serverBrands) map.set(item.id, item.name);
    for (const item of records) map.set(item.brandId, item.brandName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [records, serverBrands]);

  const evaluation = useMemo(() => evaluateAgainstBrandHistory({
    result,
    records,
    brandName,
    metricId,
  }), [result, records, brandName, metricId]);

  const metric = OUTCOME_METRICS.find((item) => item.id === metricId) || OUTCOME_METRICS[0];
  const validValue = outcomeValue !== '' && Number.isFinite(Number(outcomeValue)) && Number(outcomeValue) >= 0;
  const canSave = Boolean(syncState === 'ready' && credential && !saving && brandName.trim() && creativeLabel.trim() && metric && validValue);

  async function refreshWorkspace() {
    if (!credential) return synchronize();
    try {
      const [history, brands] = await Promise.all([
        listBrandBrainHistory(credential),
        listBrandBrainBrands(credential),
      ]);
      setRecords(history);
      setServerBrands(brands);
      setSyncState('ready');
    } catch (error) {
      setSyncState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
      setSyncMessage(error?.message || 'Could not refresh Brand Brain history.');
    }
  }

  async function saveOutcome() {
    if (!canSave) {
      if (syncState !== 'ready') setMessage('Server-backed Brand Brain history is unavailable; this outcome was not saved.');
      return;
    }
    setSaving(true);
    setMessage('Saving actual outcome to Brand Brain…');
    try {
      const localRecord = createOutcomeRecord({
        result,
        brandName,
        creativeLabel,
        metricId,
        value: Number(outcomeValue),
      });
      const saved = await saveBrandBrainOutcome(credential, {
        ...localRecord,
        modelVersion: resultModelVersion(result),
        provenance: {
          source: 'customer-entered post-publish outcome',
          signatureSource: 'BrainSNN creative signature',
          analysisMode: String(result?.analysisMode || result?.mode || 'unknown'),
        },
      });
      setRecords((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setServerBrands((current) => current.some((item) => item.id === saved.brandId)
        ? current
        : [...current, { id: saved.brandId, name: saved.brandName }]);
      setOutcomeValue('');
      setMessage(`Saved actual ${metric.label} for ${saved.creativeLabel} to the server-backed workspace.`);
    } catch (error) {
      setMessage(`Outcome was not saved: ${error?.message || 'Brand Brain persistence failed.'}`);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) setSyncState('offline');
      else setSyncState('error');
    } finally {
      setSaving(false);
    }
  }

  async function removeOutcome(id) {
    if (!credential || syncState !== 'ready') {
      setMessage('The server is unavailable, so BrainSNN did not remove this outcome.');
      return;
    }
    try {
      await deleteBrandBrainOutcome(credential, id);
      setRecords((current) => current.filter((item) => item.id !== id));
      setMessage('Outcome removed from the server-backed Brand Brain workspace.');
    } catch (error) {
      setMessage(`Outcome was not removed: ${error?.message || 'Brand Brain persistence failed.'}`);
    }
  }

  return (
    <section className="outcome-learning-panel" aria-labelledby="outcome-learning-heading">
      <header className="outcome-learning-head">
        <div className="outcome-learning-title">
          <Database size={19} aria-hidden="true" />
          <div>
            <span className="bsn-eyebrow">Brand Brain · closed-loop evidence</span>
            <h3 id="outcome-learning-heading">Outcome Learning V0.2</h3>
          </div>
        </div>
        <div className="outcome-learning-badges">
          <Badge tone={maturityTone(evaluation.maturity.id)}>{evaluation.maturity.label}</Badge>
          <Badge tone={syncTone(syncState)}>{syncLabel(syncState)}</Badge>
        </div>
      </header>

      <p className="outcome-learning-intro">
        Close the loop with real post-publish results. BrainSNN stores a compact creative signature beside the customer-entered actual outcome, then compares future creatives with that workspace’s own brand history. It does not convert a small sample into a fabricated win probability.
      </p>

      <div className={`outcome-fit-banner ${syncState === 'ready' ? '' : 'warning'}`} role="status">
        {syncState === 'offline' ? <WifiOff size={18} aria-hidden="true" /> : <Database size={18} aria-hidden="true" />}
        <div>
          <Badge tone={syncTone(syncState)}>{syncLabel(syncState)}</Badge>
          <p>{syncMessage}</p>
        </div>
        {syncState !== 'loading' ? (
          <button type="button" className="outcome-delete" onClick={synchronize}><RefreshCw size={13} aria-hidden="true" /> Retry sync</button>
        ) : null}
      </div>

      <div className="outcome-learning-controls">
        <label>
          <span>Brand / client</span>
          <input list="brainsnn-brand-history" value={brandName} onChange={(event) => setBrandName(event.target.value)} placeholder="e.g. Acme" />
          <datalist id="brainsnn-brand-history">
            {brands.map((brand) => <option key={brand.id} value={brand.name} />)}
          </datalist>
        </label>
        <label>
          <span>Outcome goal</span>
          <select value={metricId} onChange={(event) => setMetricId(event.target.value)}>
            {OUTCOME_METRICS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      <div className="outcome-learning-status">
        <article>
          <small>SAVED COMPARABLE OUTCOMES</small>
          <strong>{syncState === 'ready' ? evaluation.sampleCount : '—'}</strong>
          <span>{syncState === 'ready' ? evaluation.maturity.message : 'Server history is not currently available.'}</span>
        </article>
        <article>
          <small>HISTORICAL FIT SIGNAL</small>
          <strong>{evaluation.historicalFit == null ? '—' : `${evaluation.historicalFit}/100`}</strong>
          <span>{evaluation.fitLabel}</span>
        </article>
        <article>
          <small>EVIDENCE WEIGHT</small>
          <strong>{evaluation.historicalFit == null ? '—' : `${evaluation.evidenceWeight}/100`}</strong>
          <span>history size × neighbor similarity</span>
        </article>
      </div>

      {evaluation.historicalFit != null ? (
        <div className="outcome-fit-banner">
          <TrendingUp size={18} aria-hidden="true" />
          <div>
            <Badge tone={fitTone(evaluation.historicalFit)}>{evaluation.fitLabel.toUpperCase()}</Badge>
            <p>This creative’s BrainSNN signature is being compared only with saved {metric.label} outcomes for <strong>{evaluation.brandName}</strong>. Use it to prioritize tests, not to promise results.</p>
          </div>
        </div>
      ) : null}

      {evaluation.neighbors.length ? (
        <section className="outcome-neighbors" aria-labelledby="outcome-neighbor-heading">
          <div className="outcome-section-heading">
            <div><GitCompareArrows size={16} aria-hidden="true" /><h4 id="outcome-neighbor-heading">Closest historical creatives</h4></div>
            <small>actual outcomes, nearest signature first</small>
          </div>
          <div className="outcome-neighbor-grid">
            {evaluation.neighbors.map((item) => (
              <article key={item.id}>
                <div><strong>{item.creativeLabel}</strong><span>{Math.round(item.similarity * 100)}% similar</span></div>
                <p>{metric.label}: <b>{formatMetricValue(metricId, item.actualValue)}</b></p>
                <small>saved {new Date(item.savedAt).toLocaleDateString()}</small>
                <button type="button" className="outcome-delete" onClick={() => removeOutcome(item.id)} aria-label={`Delete ${item.creativeLabel} outcome`}><Trash2 size={13} aria-hidden="true" /> Remove</button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {evaluation.associations.length ? (
        <section className="outcome-associations" aria-labelledby="outcome-association-heading">
          <div className="outcome-section-heading">
            <div><Target size={16} aria-hidden="true" /><h4 id="outcome-association-heading">Descriptive associations in saved workspace history</h4></div>
            <small>Spearman rank · n={evaluation.sampleCount}</small>
          </div>
          <div className="outcome-association-list">
            {evaluation.associations.map((item) => (
              <article key={item.feature}>
                <strong>{featureLabel(item.feature)}</strong>
                <span>{item.rho > 0 ? 'higher values tended to accompany stronger outcomes' : 'lower values tended to accompany stronger outcomes'}</span>
                <b>ρ {item.rho.toFixed(2)}</b>
              </article>
            ))}
          </div>
          <p className="outcome-association-boundary">These are descriptive correlations inside this workspace’s saved brand history. They are not causal findings.</p>
        </section>
      ) : null}

      <section className="outcome-capture" aria-labelledby="outcome-capture-heading">
        <div className="outcome-section-heading">
          <div><Save size={16} aria-hidden="true" /><h4 id="outcome-capture-heading">Record the actual result</h4></div>
          <small>customer-entered post-publish performance</small>
        </div>
        <div className="outcome-capture-grid">
          <label>
            <span>Creative label</span>
            <input value={creativeLabel} onChange={(event) => setCreativeLabel(event.target.value)} placeholder="Summer offer · Variant B" />
          </label>
          <label>
            <span>Actual {metric.label}</span>
            <div className="outcome-value-input"><input type="number" min="0" step="any" inputMode="decimal" value={outcomeValue} onChange={(event) => setOutcomeValue(event.target.value)} placeholder="0" /><em>{metric.unit}</em></div>
            <small>{metric.hint}</small>
          </label>
          <button type="button" className="outcome-save" disabled={!canSave} onClick={saveOutcome}><Save size={15} aria-hidden="true" /> {saving ? 'Saving…' : 'Save outcome'}</button>
        </div>
        {syncState !== 'ready' ? <p className="outcome-message" role="status">Saving is disabled until server-backed history is available. BrainSNN will not silently fall back to browser-only outcomes.</p> : null}
        {message ? <p className="outcome-message" role="status">{message}</p> : null}
      </section>

      <footer className="outcome-learning-footer">
        <strong>Claim & storage boundary</strong>
        <p>{evaluation.boundary}</p>
        <small>Outcomes and creative signatures are server-backed when persistence is ready. This browser stores only the opaque pilot workspace credential and a one-time migration marker; raw video is not added to Brand Brain history.</small>
        {syncState === 'ready' ? <button type="button" className="outcome-delete" onClick={refreshWorkspace}><RefreshCw size={13} aria-hidden="true" /> Refresh history</button> : null}
      </footer>
    </section>
  );
}
