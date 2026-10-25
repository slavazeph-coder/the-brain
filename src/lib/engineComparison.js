import { analyzeContentLocally } from './analysisEngine.js';
import { runLayerRouter } from './layerRouter.js';

export function compareEngineInputs(body = {}, options = {}) {
  const leftText = typeof body?.left === 'string' ? body.left : body?.baseline;
  const rightText = typeof body?.right === 'string' ? body.right : body?.candidate;
  if (typeof leftText !== 'string' || !leftText.trim() || typeof rightText !== 'string' || !rightText.trim()) {
    throw new TypeError('Both baseline (left) and candidate (right) text inputs are required.');
  }

  const left = runLayerRouter({
    content: leftText,
    contentType: body.contentType || 'text',
    baseResult: analyzeContentLocally({ content: leftText, contentType: body.contentType || 'text', forceFallback: true }),
  });

  const right = runLayerRouter({
    content: rightText,
    contentType: body.contentType || 'text',
    baseResult: analyzeContentLocally({ content: rightText, contentType: body.contentType || 'text', forceFallback: true }),
  });

  return {
    schemaVersion: 'brainsnn.engine-compare.v1',
    revision: options.revision ?? null,
    left,
    right,
    delta: {
      trust: (right.metrics?.trust ?? 0) - (left.metrics?.trust ?? 0),
      fear: (right.metrics?.fear ?? 0) - (left.metrics?.fear ?? 0),
      urgency: (right.metrics?.urgency ?? 0) - (left.metrics?.urgency ?? 0),
      firingRate: (right.metrics?.firingRate ?? 0) - (left.metrics?.firingRate ?? 0),
    },
  };
}
