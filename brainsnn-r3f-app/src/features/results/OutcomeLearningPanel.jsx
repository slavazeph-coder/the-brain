import React, { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudOff, Database, GitCompareArrows, Save, Target, Trash2, TrendingUp } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import {
  OUTCOME_METRICS,
  createOutcomeRecord,
  evaluateAgainstBrandHistory,
  formatMetricValue,
  loadOutcomeRecords,
} from '../../lib/outcomeLearning.js';
import {
  appendSyncedOutcomeRecord,
  deleteSyncedOutcomeRecord,
  loadSyncedOutcomeRecords,
} from '../../lib/outcomeSync.js';

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

function storageLabel(storage, synced) {
  if (synced && storage === 'postgres') return 'SERVER-SYNCED HISTORY';
  if (synced && storage === 'memory-fallback') return 'SERVER MEMORY FALLBACK';
  return 'BROWSER-LOCAL FALLBACK';
}

export function OutcomeLearningPanel({ result }) {
  const initialRecords = loadOutcomeRecords();
  const [records, setRecords] = useState(() => initialRecords);
  const [brandName, setBrandName] = useState(() => initialRecords[0]?.brandName || '');
  const [metricId, setMetricId] = useState('roas');
  const [creativeLabel, setCreativeLabel] = useState(result?.title || 'Current creative');
  const [outcomeValue, setOutcomeValue] = useState('');
  const [message, setMessage] = useState('');
  const [storage, setStorage] = useState('browser-local');
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    let active = true;
    loadSyncedOutcomeRecords().then((state) => {
      if (!active) return;
      setRecords(state.records);
      setStorage(state.storage);
      setSynced(Boolean(state.synced));
      setSyncing(false);
      if (!brandName && state.records[0]?.brandName) setBrandName(state.records[0].brandName);
    }).catch(() => {
      if (!active) return;
      setSyncing(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setCreativeLabel(result?.title || (result?.id ? `Creative ${String(result.id).slice(0, 8)}` : 'Current creative'));
    setMessage('');
  }, [result?.id, result?.title]);

  const brands = useMemo(() => {
    const map = new Map();
    for (const item of records) map.set(item.brandId, item.brandName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [records]);

  const evaluation = useMemo(() => evaluateAgainstBrandHistory({
    result,
    records,
    brandName,
    metricId,
  }), [result, records, brandName, metricId]);

  const metric = OUTCOME_METRICS.find((item) => item.id === metricId) || OUTCOME_METRICS[0];
  const validValue = outcomeValue !== '' && Number.isFinite(Number(outcomeValue)) && Number(outcomeValue) >= 0;
  const canSave = Boolean(brandName.trim() && creativeLabel.trim() && metric && validValue);

  async function saveOutcome() {
    if (!canSave) return;
    try {
      const record = createOutcomeRecord({
        result,
        brandName,
        creativeLabel,
        metricId,
        value: Number(outcomeValue),
      });
      const state = await appendSyncedOutcomeRecord(record);
      setRecords(state.records);
      setStorage(state.storage);
      setSynced(Boolean(state.synced));
      setOutcomeValue('');
      setMessage(state.synced
        ? `Saved ${metric.label} outcome for ${record.creativeLabel} and synced it to Brand Brain.`
        : `Saved ${metric.label} outcome locally. Server sync is unavailable, so this browser will retry later.`);
    } catch (error) {
      setMessage(error?.message || 'Could not save this outcome.');
    }
  }

  async function removeOutcome(id) {
    const state = await deleteSyncedOutcomeRecord(id);
    setRecords(state.records);
    setStorage(state.storage);
    setSynced(Boolean(state.synced));
    setMessage(state.synced ? 'Outcome removed from synced Brand Brain history.' : 'Outcome removed locally; server deletion can retry when sync returns.');
  }

  return (
    <section className="outcome-learning-panel" aria-labelledby="outcome-learning-heading">
      <header className="outcome-learning-head">
        <div className="outcome-learning-title">
          <Database size={19} aria-hidden="true" />
          <div>
            <span className="bsn-eyebrow">Brand Brain · feedback loop</span>
            <h3 id="outcome-learning-heading">Outcome Learning V0.2</h3>
          </div>
        </div>
        <div className="outcome-learning-badges">
          <Badge tone={maturityTone(evaluation.maturity.id)}>{evaluation.maturity.label}</Badge>
          <Badge tone={synced && storage === 'postgres' ? 'cyan' : 'neutral'}>{syncing ? 'SYNCING HISTORY' : storageLabel(storage, synced)}</Badge>
        </div>
      </header>

      <p className="outcome-learning-intro">
        Close the loop with real post-publish results. BrainSNN stores a compact creative signature beside the actual outcome, synchronizes that history to the current anonymous workspace when server persistence is available, and compares future creatives only with that brand’s own saved history. It does not turn a few examples into a fake win probability.
      </p>

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
          <strong>{evaluation.sampleCount}</strong>
          <span>{evaluation.maturity.message}</span>
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

      <div className="outcome-fit-banner">
        {synced ? <Cloud size={18} aria-hidden="true" /> : <CloudOff size={18} aria-hidden="true" />}
        <div>
          <Badge tone={synced && storage === 'postgres' ? 'cyan' : 'neutral'}>{storageLabel(storage, synced)}</Badge>
          <p>{synced && storage === 'postgres'
            ? 'Outcome history is persisted in BrainSNN’s Postgres workspace and mirrored into this browser for fast local access.'
            : 'BrainSNN is using the browser-local cache right now. Existing history remains usable and will migrate/sync when server persistence becomes available.'}</p>
        </div>
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

      {evaluation.neuralMirror?.present ? (
        <div className="outcome-fit-banner">
          <Database size={18} aria-hidden="true" />
          <div>
            <Badge tone={evaluation.neuralMirror.eligibleForOutcomeSimilarity ? 'cyan' : 'neutral'}>
              {evaluation.neuralMirror.eligibleForOutcomeSimilarity ? 'NEURAL MIRROR ELIGIBLE' : 'NEURAL MIRROR RESEARCH-ONLY'}
            </Badge>
            <p>{evaluation.neuralMirror.boundary}</p>
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
            <div><Target size={16} aria-hidden="true" /><h4 id="outcome-association-heading">Descriptive associations in saved history</h4></div>
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
          <p className="outcome-association-boundary">These are correlations inside the saved brand history for this workspace. They are not causal findings.</p>
        </section>
      ) : null}

      <section className="outcome-capture" aria-labelledby="outcome-capture-heading">
        <div className="outcome-section-heading">
          <div><Save size={16} aria-hidden="true" /><h4 id="outcome-capture-heading">Record the actual result</h4></div>
          <small>feed published performance back into BrainSNN</small>
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
          <button type="button" className="outcome-save" disabled={!canSave} onClick={saveOutcome}><Save size={15} aria-hidden="true" /> Save outcome</button>
        </div>
        {message ? <p className="outcome-message" role="status">{message}</p> : null}
      </section>

      <footer className="outcome-learning-footer">
        <strong>Claim boundary</strong>
        <p>{evaluation.boundary}</p>
        <small>V0.2 persists compact outcome/signature records when Postgres is available and keeps a browser-local cache/fallback. Raw video is not added to Brand Brain history.</small>
      </footer>
    </section>
  );
}
