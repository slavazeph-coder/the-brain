import React, { useMemo, useState } from 'react';
import { splitIntoSegments } from '../../lib/validation.js';
import { clampScore } from '../../lib/formatters.js';

function classify(segment, fallback, index) {
  if (fallback) return fallback;
  const text = segment.toLowerCase();
  let category = 'Strong attention signal';
  if (/\b(proof|because|data|tested|source|example)\b/.test(text)) category = 'Trust builder';
  if (/\b(now|limited|last chance|urgent)\b/.test(text)) category = 'Forced urgency';
  if (/\b(risk|danger|lose|panic|crisis)\b/.test(text)) category = 'Fear pressure';
  if (/\b(game[- ]changer|ultimate|guaranteed|revolutionary)\b/.test(text)) category = 'Vague claim';
  return {
    id: `segment-${index + 1}`,
    text: segment,
    category,
    score: clampScore(58 + (index === 0 ? 10 : 0)),
    reason: 'Detected pattern based on the sentence language.',
  };
}

function classForCategory(category) {
  if (/trust/i.test(category)) return 'heatmap-trust';
  if (/urgency|vague/i.test(category)) return 'heatmap-urgency';
  if (/fear|risk/i.test(category)) return 'heatmap-risk';
  return 'heatmap-strong';
}

export function ContentHeatmap({ result }) {
  const segments = useMemo(() => {
    const raw = Array.isArray(result.heatmap) && result.heatmap.length ? result.heatmap : null;
    return splitIntoSegments(result.rawContent).map((segment, index) => classify(segment, raw?.[index], index));
  }, [result]);
  const [selectedId, setSelectedId] = useState(segments[0]?.id);
  const selected = segments.find((segment) => segment.id === selectedId) || segments[0];
  const firstRecommendation = result.recommendations?.[0];
  const recommendationText = typeof firstRecommendation === 'string'
    ? firstRecommendation
    : firstRecommendation?.rewriteHint || 'Make the promise specific and easier to trust.';

  if (!segments.length) return null;

  return (
    <section className="content-heatmap" aria-labelledby="content-heatmap-heading">
      <div className="bsn-section-head">
        <div>
          <p className="bsn-eyebrow">Content heatmap</p>
          <h2 id="content-heatmap-heading">Which lines help or hurt</h2>
        </div>
      </div>
      <div className="heatmap-layout">
        <div className="heatmap-text">
          {segments.map((segment) => (
            <button
              type="button"
              key={segment.id}
              className={`heatmap-segment ${classForCategory(segment.category)} ${selected?.id === segment.id ? 'active' : ''}`}
              onClick={() => setSelectedId(segment.id)}
            >
              <span>{segment.text}</span>
              <strong>{clampScore(segment.score)}</strong>
            </button>
          ))}
        </div>
        <aside className="heatmap-inspector" aria-live="polite">
          <span>Detected pattern</span>
          <h3>{selected?.category || 'Content signal'}</h3>
          <p>{selected?.reason || 'Likely effect based on local content patterns.'}</p>
          <p><strong>Related recommendation:</strong> {recommendationText}</p>
        </aside>
      </div>
    </section>
  );
}
