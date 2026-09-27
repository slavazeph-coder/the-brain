import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import { buildCurveCoordinates, createNeuralMirrorViewModel, formatTimestampMs } from './neuralMirrorViewModel.js';

const CHART_WIDTH = 720;
const CHART_HEIGHT = 180;

function statusClass(status) {
  return ['available', 'completed', 'online'].includes(status)
    ? 'available'
    : ['failed', 'error', 'unavailable'].includes(status)
      ? 'unavailable'
      : 'neutral';
}

function humanize(value) {
  return String(value || 'not reported').replace(/[_-]+/g, ' ');
}

function InvalidPrediction({ viewModel }) {
  return (
    <section className="neural-mirror-panel neural-mirror-invalid" aria-labelledby="neural-mirror-heading">
      <div className="neural-mirror-header">
        <div>
          <p className="bsn-eyebrow">Neural Mirror</p>
          <h2 id="neural-mirror-heading">Predicted Neural Response unavailable</h2>
        </div>
        <Badge tone="warning">PREDICTED</Badge>
      </div>
      <p role="alert">The server returned a Neural Mirror payload that did not pass the public schema contract.</p>
      <ul className="neural-mirror-errors">
        {viewModel.errors.map((error) => <li key={error}>{error}</li>)}
      </ul>
      {viewModel.disclaimer ? <p className="neural-mirror-disclaimer">{viewModel.disclaimer}</p> : null}
      <strong className="neural-mirror-not-measured">NOT A MEASURED BRAIN SCAN</strong>
    </section>
  );
}

export function NeuralMirrorPanel({ prediction, modalityStatus, events, scanTrace, computeTrace }) {
  const viewModel = useMemo(() => createNeuralMirrorViewModel(prediction, {
    modalityStatus,
    events,
    scanTrace,
    computeTrace,
  }), [prediction, modalityStatus, events, scanTrace, computeTrace]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [prediction]);

  if (!viewModel) return null;
  if (!viewModel.valid) return <InvalidPrediction viewModel={viewModel} />;

  const safeIndex = Math.min(selectedIndex, viewModel.points.length - 1);
  const current = viewModel.points[safeIndex];
  const coordinates = buildCurveCoordinates(viewModel.points, CHART_WIDTH, CHART_HEIGHT);
  const polyline = coordinates.map((point) => `${point.x},${point.y}`).join(' ');
  const playhead = coordinates[safeIndex];
  const referenceLabel = [viewModel.referenceSpace.type, viewModel.referenceSpace.atlas].filter(Boolean).join(' · ');

  return (
    <section className="neural-mirror-panel" aria-labelledby="neural-mirror-heading" data-testid="neural-mirror-panel">
      <div className="neural-mirror-header">
        <div className="neural-mirror-title">
          <span className="neural-mirror-icon" aria-hidden="true"><BrainCircuit size={19} /></span>
          <div>
            <p className="bsn-eyebrow">Neural Mirror</p>
            <h2 id="neural-mirror-heading">Predicted Neural Response</h2>
          </div>
        </div>
        <div className="neural-mirror-badges">
          <Badge tone="cyan">PREDICTED</Badge>
          <Badge tone={viewModel.model.status === 'baseline_untrained' ? 'warning' : 'purple'}>{viewModel.model.status}</Badge>
        </div>
      </div>

      <div className="neural-mirror-metadata" aria-label="Neural Mirror model details">
        <div><span>Model</span><strong>{viewModel.model.id} v{viewModel.model.version}</strong></div>
        <div><span>Device</span><strong>{viewModel.model.device}</strong></div>
        <div><span>Reference representation</span><strong>{referenceLabel}</strong></div>
        <div><span>Parcels</span><strong>{viewModel.referenceSpace.parcelCount ?? 'not reported'}</strong></div>
      </div>

      <div className="neural-mirror-modalities" aria-label="Modality availability">
        {viewModel.modalities.map((modality) => (
          <div key={modality.id} className={`neural-modality ${statusClass(modality.status)}`}>
            <span aria-hidden="true" />
            <div>
              <strong>{modality.label}</strong>
              <small>{humanize(modality.status)}{modality.detail ? ` · ${modality.detail}` : ''}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="neural-mirror-chart-wrap">
        <div className="neural-mirror-chart-heading">
          <div>
            <span>Mean predicted response magnitude across the reference representation</span>
            <strong>{current.timeLabel}</strong>
          </div>
          <div>
            <span>Model confidence</span>
            <strong>{Math.round(current.confidence * 100)}%</strong>
          </div>
        </div>
        <svg
          className="neural-mirror-chart"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={`Predicted response curve with ${viewModel.points.length} temporal windows. Current window ${safeIndex + 1}, ${current.timeLabel}.`}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="neural-mirror-line" x1="0" x2="1">
              <stop offset="0" stopColor="#00f5ff" />
              <stop offset="1" stopColor="#a855f7" />
            </linearGradient>
          </defs>
          <line className="neural-chart-axis" x1="18" x2={CHART_WIDTH - 18} y1={CHART_HEIGHT - 18} y2={CHART_HEIGHT - 18} />
          <polyline className="neural-chart-line" points={polyline} />
          <line className="neural-chart-playhead" x1={playhead.x} x2={playhead.x} y1="10" y2={CHART_HEIGHT - 18} />
          {coordinates.map((point, index) => (
            <circle
              key={viewModel.points[index].timeLabel}
              className={index === safeIndex ? 'active' : ''}
              cx={point.x}
              cy={point.y}
              r={index === safeIndex ? 6 : 3}
            />
          ))}
        </svg>
        <label className="neural-mirror-playhead">
          <span>Timeline playhead</span>
          <input
            type="range"
            min="0"
            max={Math.max(0, viewModel.points.length - 1)}
            step="1"
            value={safeIndex}
            disabled={viewModel.points.length < 2}
            onChange={(event) => setSelectedIndex(Number(event.target.value))}
            aria-valuetext={`Window ${safeIndex + 1}: ${current.timeLabel}`}
          />
          <output>{safeIndex + 1} / {viewModel.points.length}</output>
        </label>
        <div className="neural-current-window" aria-live="polite">
          <Activity size={16} aria-hidden="true" />
          <span>Mean response magnitude</span>
          <strong>{current.meanActivation.toFixed(4)}</strong>
          <small>{formatTimestampMs(current.startMs)} to {formatTimestampMs(current.endMs)}</small>
        </div>
      </div>

      {viewModel.events.length ? (
        <div className="neural-mirror-events">
          <h3>Predicted timeline events</h3>
          <ol>
            {viewModel.events.map((event, index) => (
              <li key={`${event.timestampMs}-${event.type}-${index}`}>
                <time>{formatTimestampMs(event.timestampMs)}</time>
                <div>
                  <strong>{humanize(event.type)}</strong>
                  {event.description ? <p>{event.description}</p> : null}
                </div>
                {event.confidence === null ? null : <span>{Math.round(event.confidence * 100)}%</span>}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {viewModel.scanTrace.length || viewModel.computeTrace.length ? (
        <div className="neural-mirror-traces">
          {viewModel.scanTrace.length ? (
            <div>
              <h3>Scan trace</h3>
              <ol>{viewModel.scanTrace.map((entry, index) => <li key={`${entry}-${index}`}>{entry}</li>)}</ol>
            </div>
          ) : null}
          {viewModel.computeTrace.length ? (
            <div>
              <h3>Compute route</h3>
              <ol>
                {viewModel.computeTrace.map((entry, index) => (
                  <li key={`${entry.engine}-${index}`}><strong>{entry.engine}</strong> · {entry.status}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="neural-mirror-claim-boundary">
        <strong>NOT A MEASURED BRAIN SCAN</strong>
        <p className="neural-mirror-disclaimer">{viewModel.disclaimer}</p>
        <p className="neural-mirror-disclaimer">
          Scientific status: {viewModel.evidence.validatedAgainstNeuralData === true
            ? 'this model artifact reports neural-data validation; inspect its benchmark provenance.'
            : 'not validated against recorded neural data.'}
        </p>
      </div>
    </section>
  );
}
