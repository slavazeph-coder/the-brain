import React from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Meter } from '../../components/ui/Meter.jsx';

const SYNC_TONE = { bound: 'success', partial: 'warning', desynchronized: 'danger' };
const BAND_ORDER = ['delta', 'theta', 'alpha', 'beta', 'gamma'];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function pct(value) {
  return Math.round(clamp01(value) * 100);
}

// Oscilloscope of the gamma coherence envelope r(t) over the settling window.
function Oscilloscope({ trace = [] }) {
  if (!Array.isArray(trace) || trace.length < 2) return null;
  const n = trace.length;
  const points = trace
    .map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(34 - clamp01(v) * 32).toFixed(2)}`)
    .join(' ');
  return (
    <svg className="soliton-scope" viewBox="0 0 100 36" preserveAspectRatio="none" role="img" aria-label="Gamma coherence waveform over the settling window">
      <line x1="0" y1="34" x2="100" y2="34" className="soliton-scope-axis" />
      <polyline points={points} className="soliton-scope-line" />
    </svg>
  );
}

// Solitons placed on the microtubule ring by final position, sized by amplitude.
function SolitonRing({ solitons = [], leapfrogEvents = 0 }) {
  const cx = 50;
  const cy = 50;
  const radius = 38;
  return (
    <svg className="soliton-ring" viewBox="0 0 100 100" role="img" aria-label={`${solitons.length} solitons leapfrogging on the lattice`}>
      <circle cx={cx} cy={cy} r={radius} className="soliton-ring-track" />
      {solitons.map((s) => {
        const angle = (Number(s.position) || 0) * 2 * Math.PI;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        const dot = 2.5 + Math.min(6, (Number(s.amplitude) || 0.5) * 4);
        return <circle key={s.id} cx={px.toFixed(2)} cy={py.toFixed(2)} r={dot.toFixed(2)} className="soliton-ring-dot" />;
      })}
      <text x={cx} y={cy - 1} className="soliton-ring-count" textAnchor="middle">{leapfrogEvents}</text>
      <text x={cx} y={cy + 9} className="soliton-ring-label" textAnchor="middle">leapfrogs</text>
    </svg>
  );
}

function BandBar({ label, value }) {
  return (
    <div className="soliton-band-row">
      <span>{label}</span>
      <div className="soliton-band-track" aria-hidden="true"><span style={{ width: `${pct(value)}%` }} /></div>
      <strong>{pct(value)}</strong>
    </div>
  );
}

export function SolitonFieldPanel({ result }) {
  const field = result?.solitonField;
  if (!field) return null;
  const bands = field.oscillationBands || {};
  const peaks = Array.isArray(field.spectralPeaks) ? field.spectralPeaks : [];
  const tone = SYNC_TONE[field.synchrony] || 'cyan';
  const windowMs = Array.isArray(field.sampleTimesMs) && field.sampleTimesMs.length
    ? field.sampleTimesMs[field.sampleTimesMs.length - 1]
    : 600;

  return (
    <section className="soliton-panel" aria-labelledby="soliton-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Layer 103 · gamma binding</p>
          <h2 id="soliton-heading">39 Hz soliton field</h2>
        </div>
        <Badge tone={tone}>{field.synchrony} · {field.effectiveFrequencyHz} Hz</Badge>
      </div>

      <div className="soliton-gauges">
        <Meter label="Binding score" value={field.bindingScore} color="cyan" explanation="Gamma coherence × confinement." />
        <Meter label="Gamma coherence" value={pct(field.gammaCoherence)} color="purple" explanation="Phase-lock of 13 protofilaments." />
        <Meter label="Confinement" value={pct(field.confinement)} color="green" explanation="Stability of the self-reinforcing packets." />
        <Meter label="Theta–gamma PAC" value={pct(field.thetaGammaPAC)} color="orange" explanation="Cross-band phase-amplitude coupling." />
      </div>

      <div className="soliton-viz">
        <article>
          <h3>Gamma coherence waveform</h3>
          <Oscilloscope trace={field.coherenceTrace} />
          <p className="bsn-note">Order parameter r(t) across the {windowMs} ms settling window.</p>
        </article>
        <article>
          <h3>Leapfrogging solitons</h3>
          <SolitonRing solitons={field.solitons} leapfrogEvents={field.leapfrogEvents} />
          <p className="bsn-note">{(field.solitons || []).length} ionic packets · {(field.collisions || []).length} overtakes · energy {field.solitonEnergy}.</p>
        </article>
      </div>

      <div className="engine-trace-grid">
        <article>
          <h3>Lattice readout</h3>
          <dl>
            <div><dt>Effective frequency</dt><dd>{field.effectiveFrequencyHz} Hz</dd></div>
            <div><dt>Context base</dt><dd>{field.contextualBaseHz} Hz</dd></div>
            <div><dt>Detune</dt><dd>{field.detuneHz} Hz</dd></div>
            <div><dt>Ionic drive</dt><dd>{pct(field.ionicDrive)}</dd></div>
          </dl>
        </article>
        <article>
          <h3>Oscillation bands</h3>
          <div className="soliton-bands">
            {BAND_ORDER.map((band) => <BandBar key={band} label={band} value={bands[band]} />)}
          </div>
        </article>
        <article>
          <h3>Spectral modes</h3>
          {peaks.length ? (
            <div className="soliton-bands">
              {peaks.map((peak, index) => <BandBar key={`${peak.freqHz}-${index}`} label={`${peak.freqHz} Hz`} value={peak.power} />)}
            </div>
          ) : <p className="bsn-note">No dominant modulation modes.</p>}
        </article>
      </div>

      <p className="bsn-note soliton-disclaimer">{field.note} {field.disclaimer}</p>
    </section>
  );
}
