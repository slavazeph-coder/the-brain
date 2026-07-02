import React, { useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';

const SAMPLE = 'Customer proof makes this calmer launch claim easier to trust today.';
const BAND_COLOR = { high: 'var(--bsn-green)', medium: 'var(--bsn-yellow)', low: 'var(--bsn-red)' };

function tokenBackground(confidence) {
  if (confidence >= 0.75) return 'rgba(34,197,94,0.16)';
  if (confidence >= 0.5) return 'rgba(234,179,8,0.18)';
  return 'rgba(239,68,68,0.18)';
}

// Per-token confidence strip. Uses the decoder's per-token scores when present,
// otherwise applies the overall decode confidence to each token.
function TokenStrip({ neuralInput, uncertainty }) {
  const tokens = neuralInput.tokenConfidences?.length
    ? neuralInput.tokenConfidences
    : neuralInput.decodedText.split(/\s+/).filter(Boolean).map((token) => ({ token, confidence: uncertainty.confidence }));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 6px', lineHeight: 1.9 }}>
      {tokens.map((item, index) => (
        <span key={index} title={`${Math.round(item.confidence * 100)}% confidence`} style={{ padding: '1px 6px', borderRadius: 6, background: tokenBackground(item.confidence) }}>{item.token}</span>
      ))}
    </div>
  );
}
const inputStyle = {
  width: '100%',
  minHeight: 44,
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(241,241,246,0.14)',
  background: 'rgba(255,255,255,0.035)',
  color: 'var(--bsn-text)',
};

function Metric({ label, value }) {
  return (
    <article style={{ padding: 14, border: '1px solid rgba(241,241,246,0.09)', borderRadius: 12 }}>
      <span className="bsn-mono" style={{ color: 'var(--bsn-text-muted)', fontSize: 12 }}>{label}</span>
      <strong style={{ display: 'block', marginTop: 7, fontSize: 22 }}>{value}</strong>
    </article>
  );
}

export function DecoderTranscriptPanel() {
  const [transcript, setTranscript] = useState(SAMPLE);
  const [decoder, setDecoder] = useState('Research decoder');
  const [confidence, setConfidence] = useState(78);
  const [authorized, setAuthorized] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);

  async function runImport() {
    setError('');
    setRecord(null);
    if (!authorized) {
      setError('Confirm that this decoded transcript is authorized for research use.');
      return;
    }
    if (!transcript.trim()) {
      setError('Enter a decoded transcript to analyze.');
      return;
    }

    setStatus('loading');
    try {
      const response = await fetch('/api/neural/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decodedText: transcript,
          modality: 'decoded_text',
          confidence,
          decoder,
          source: 'research-import',
          consentConfirmed: authorized,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Analysis service unavailable.');
      setRecord(data);
      setStatus('success');
    } catch (cause) {
      setStatus('error');
      setError(cause.message || 'Analysis failed.');
    }
  }

  const analysis = record?.result || {};
  const metrics = analysis.metrics || {};

  return (
    <section className="research-panel" aria-labelledby="decoder-transcript-heading" data-testid="decoder-transcript-panel">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Decoder transcript gateway · replay</p>
          <h2 id="decoder-transcript-heading">Import decoded communication</h2>
          <p className="bsn-note">Preserve decoder confidence and provenance, then run the text through BrainSNN's deterministic analysis stack.</p>
        </div>
        <span className="bsn-mono" style={{ color: 'var(--bsn-green)' }}>text only · no recording retained</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(180px,1fr)', gap: 14, marginTop: 18 }}>
        <label>
          <span className="bsn-mono">Decoder name</span>
          <input value={decoder} onChange={(event) => setDecoder(event.target.value)} style={{ ...inputStyle, marginTop: 7 }} />
        </label>
        <label>
          <span className="bsn-mono">Confidence: {confidence}%</span>
          <input type="range" min="0" max="100" value={confidence} onChange={(event) => setConfidence(Number(event.target.value))} style={{ width: '100%', marginTop: 16 }} />
        </label>
      </div>

      <label style={{ display: 'block', marginTop: 16 }}>
        <span className="bsn-mono">Decoded transcript</span>
        <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={5} style={{ ...inputStyle, marginTop: 7, resize: 'vertical' }} />
      </label>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14 }}>
        <input type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
        <span className="bsn-note">This transcript is authorized for research use and the source recording does not need to be stored.</span>
      </label>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <Button variant="primary" onClick={runImport} disabled={status === 'loading'}>
          {status === 'loading' ? 'Analyzing…' : 'Import and analyze'}
        </Button>
        <span className="bsn-note">Experimental adapter. The output is an analysis of decoded text, not a clinical measurement.</span>
      </div>

      {error ? <p role="alert" style={{ color: '#fecdd3', marginTop: 14 }}>{error}</p> : null}

      {record ? (
        <div style={{ marginTop: 20, display: 'grid', gap: 14 }}>
          <article style={{ padding: 14, borderRadius: 12, border: `1px solid ${BAND_COLOR[record.uncertainty.band]}`, background: 'rgba(255,255,255,0.02)' }}>
            <span className="bsn-mono" style={{ color: BAND_COLOR[record.uncertainty.band] }}>Decode uncertainty · {record.uncertainty.band}</span>
            <p className="bsn-note" style={{ margin: '6px 0 0' }}>{record.uncertainty.label}</p>
          </article>
          <div>
            <span className="bsn-mono" style={{ color: 'var(--bsn-text-muted)', fontSize: 12 }}>Per-token confidence</span>
            <div style={{ marginTop: 8 }}><TokenStrip neuralInput={record.neuralInput} uncertainty={record.uncertainty} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
            <Metric label="Decoder confidence" value={`${Math.round(record.neuralInput.confidence * 100)}%`} />
            <Metric label="Firewall grade" value={analysis.firewallSignals?.grade || '—'} />
            <Metric label="Dominant affect" value={analysis.affectProfile?.dominantEmotion || analysis.affectProfile?.dominantAffect || '—'} />
            <Metric label="Pressure" value={`${Math.round((analysis.firewallSignals?.manipulationPressure || 0) * 100)}/100`} />
          </div>
          <article style={{ padding: 16, borderRadius: 12, background: 'rgba(0,245,255,0.045)', border: '1px solid rgba(0,245,255,0.18)' }}>
            <strong>{analysis.title || 'Transcript analyzed'}</strong>
            <p className="bsn-note" style={{ marginBottom: 0 }}>{analysis.summary}</p>
            <p className="bsn-mono" style={{ marginBottom: 0 }}>Receipt: {analysis.receipt?.id || 'layer-router receipt generated'} · via {record.neuralInput.provenance?.decoder}</p>
          </article>
        </div>
      ) : null}
    </section>
  );
}
