import React from 'react';
import { BrainCircuit, Film, ShieldCheck, Workflow } from 'lucide-react';

function SectionList({ title, items = [], ordered = false }) {
  if (!items?.length) return null;
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <div className="fusion-result-section">
      <strong>{title}</strong>
      <Tag>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{typeof item === 'string' ? item : item.label || item.timeLabel || JSON.stringify(item)}</li>
        ))}
      </Tag>
    </div>
  );
}

function MultimodalPanel({ multimodal }) {
  const transitions = multimodal.events?.filter((event) => event.level !== 'low') || [];
  return (
    <section className="fusion-result-card" aria-labelledby="multimodal-result-heading">
      <div className="fusion-result-heading">
        <span className="fusion-icon"><Film size={18} aria-hidden="true" /></span>
        <div>
          <span className="bsn-eyebrow">Multimodal video layer · V0</span>
          <h3 id="multimodal-result-heading">Video → events → workflow</h3>
        </div>
      </div>
      <div className="fusion-stats">
        <span><b>{multimodal.frameCount || 0}</b> sampled frames</span>
        <span><b>{transitions.length}</b> visual transitions</span>
        <span><b>{multimodal.duration ? `${multimodal.duration.toFixed(1)}s` : '—'}</b> duration</span>
      </div>
      {transitions.length ? (
        <div className="fusion-timeline" aria-label="Visual transition timeline">
          {transitions.map((event, index) => (
            <div key={`${event.timeLabel}-${index}`}>
              <span>{event.timeLabel}</span>
              <i aria-hidden="true" />
              <p><strong>{event.label}</strong><small>{Math.round((event.intensity || 0) * 100)}% change intensity</small></p>
            </div>
          ))}
        </div>
      ) : null}
      <SectionList title="Workflow extracted from transcript / notes" items={multimodal.workflowSteps} ordered />
      <SectionList title="Concrete proof points found" items={multimodal.proofPoints} />
      <SectionList title="Evidence still missing" items={multimodal.missingEvidence} />
      <SectionList title="Commercial paths this input can feed" items={multimodal.commercialUses} />
      <p className="bsn-note fusion-disclaimer">{multimodal.disclaimer}</p>
    </section>
  );
}

function NeuralPanel({ neuralInput, uncertainty }) {
  return (
    <section className="fusion-result-card neural" aria-labelledby="neural-result-heading">
      <div className="fusion-result-heading">
        <span className="fusion-icon"><BrainCircuit size={18} aria-hidden="true" /></span>
        <div>
          <span className="bsn-eyebrow">L19 Neural Input Gateway</span>
          <h3 id="neural-result-heading">Decoded neural transcript → BrainSNN stack</h3>
        </div>
      </div>
      <div className="fusion-stats">
        <span><b>{Math.round((uncertainty?.confidence || neuralInput?.confidence || 0) * 100)}%</b> decode confidence</span>
        <span><b>{neuralInput?.modality || 'decoded_text'}</b> modality</span>
        <span><b>{neuralInput?.provenance?.decoder || 'manual replay'}</b> decoder</span>
      </div>
      <div className="fusion-neural-status">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>{uncertainty?.label || 'Decoded text routed through the experimental neural input adapter.'}</p>
      </div>
      <div className="fusion-neural-route">
        <Workflow size={17} aria-hidden="true" />
        <span>Decoder output</span><i aria-hidden="true">→</i><span>L19 gateway</span><i aria-hidden="true">→</i><span>103-layer BrainSNN analysis</span>
      </div>
      <p className="bsn-note fusion-disclaimer">Experimental research adapter. BrainSNN analyzes decoded text; it does not read thoughts, diagnose conditions, or interpret raw neural signals.</p>
    </section>
  );
}

export function InputFusionPanel({ result }) {
  if (!result?.multimodal && !result?.neuralInput) return null;
  return (
    <div className="fusion-result-stack">
      {result.multimodal ? <MultimodalPanel multimodal={result.multimodal} /> : null}
      {result.neuralInput ? <NeuralPanel neuralInput={result.neuralInput} uncertainty={result.neuralUncertainty} /> : null}
    </div>
  );
}
