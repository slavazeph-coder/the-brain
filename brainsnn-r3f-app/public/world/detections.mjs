/** On-device object detections -> the same frame-bound observation sidecar a worker returns, so review, provenance and
 * proof export are shared. Detections are suggestions for a person to review; nothing here touches map geometry. */
import { OBSERVATION_SCHEMA } from './observations.mjs';

export const DETECTOR = Object.freeze({
  provider: 'on-device (Transformers.js)', id: 'Xenova/detr-resnet-50', revision: '8be7ab59ff663484ee9ba2e8d8f267330d5ad03e',
  baseModel: 'facebook/detr-resnet-50', license: 'Apache-2.0 (base model card)', runtime: '@huggingface/transformers@3.8.1',
  dtype: 'q8', device: 'wasm', threshold: 0.7, maxDetections: 20, maxEdge: 512,
  vocabulary: 'COCO-2017, 80 categories (no doors, stairs, boxes or cables)',
});
// Hashed into the provenance in place of a prompt: what was asked of the detector and how its output was cut.
export const DETECTION_CONFIG = JSON.stringify({ task: 'object-detection', model: DETECTOR.id, revision: DETECTOR.revision,
  threshold: DETECTOR.threshold, maxDetections: DETECTOR.maxDetections, vocabulary: 'COCO-2017' });

const unit = v => typeof v === 'number' && Number.isFinite(v);
const clamp = v => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;

/** Normalised [x0, y0, x1, y1] from a Transformers.js percentage box, or null if it has no area. */
export function detectionBox(box) {
  if (!box || ![box.xmin, box.ymin, box.xmax, box.ymax].every(unit)) return null;
  const b = [clamp(box.xmin), clamp(box.ymin), clamp(box.xmax), clamp(box.ymax)];
  return b[0] < b[2] && b[1] < b[3] ? b : null;
}

export function detectionSidecar({ sourceSha256, frame, detections, configSha256 }) {
  const kept = (Array.isArray(detections) ? detections : [])
    .filter(d => unit(d?.score) && d.score >= DETECTOR.threshold && d.score <= 1 && typeof d.label === 'string' && d.label.trim() && d.label.length <= 120)
    .map(d => ({ ...d, box: detectionBox(d.box) })).filter(d => d.box)
    .sort((a, b) => b.score - a.score).slice(0, DETECTOR.maxDetections);
  return {
    schema: OBSERVATION_SCHEMA, source: { sha256: sourceSha256, kind: 'photo' },
    model: { provider: DETECTOR.provider, id: DETECTOR.id, revision: DETECTOR.revision,
      promptVersion: `object-detection-v1 · score ≥ ${DETECTOR.threshold}`, promptSha256: configSha256 },
    frames: [{ id: 'photo', sha256: frame.sha256, width: frame.width, height: frame.height, timestamp: null }],
    observations: kept.map((d, i) => ({ id: `object-${i + 1}`, frameId: 'photo', label: d.label.trim(), box: d.box,
      uncertainty: `Detector score ${d.score.toFixed(2)}, not a calibrated probability. COCO categories only; a missed object is not evidence of free space.` })),
  };
}
