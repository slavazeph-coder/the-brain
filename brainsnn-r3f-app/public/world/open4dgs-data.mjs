import { MAX_FILE_BYTES, parsePLY, STRIDE } from './visual-geometry.mjs';
import { readOpen4DGSTrigs } from './open4dgs-trigs.mjs';

export const MAX_OPEN4DGS_METADATA_BYTES = 128 * 1024;
export const MAX_OPEN4DGS_FRAME_BYTES = MAX_FILE_BYTES;
export const MAX_OPEN4DGS_SEQUENCE_BYTES = 512 * 1024 * 1024;
export const MAX_OPEN4DGS_FRAMES = 1800;
export const MAX_OPEN4DGS_POINTS = 20_000;
const MAX_FRAME_NUMBER = 9_999_999;
const MAX_SOURCE_POINTS = 10_000_000;

export function validPlayback(fps, frameCount) {
  return Number.isFinite(fps) && fps >= 1 && fps <= 240 &&
    Number.isInteger(frameCount) && frameCount >= 2 && frameCount <= MAX_OPEN4DGS_FRAMES;
}

function validateMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Use Open4DGS export_meta.json.');
  const {fps, start_frame: start, n_frames: count, per_frame_counts: counts} = value;
  if (!validPlayback(fps, count) || !Number.isInteger(start) || start < 0 || start + count - 1 > MAX_FRAME_NUMBER ||
      !Array.isArray(counts) || counts.length !== count ||
      !counts.every(n => Number.isInteger(n) && n > 0 && n <= MAX_SOURCE_POINTS)) {
    throw Error(`Invalid Open4DGS frame timing or counts. Use 2–${MAX_OPEN4DGS_FRAMES} frames at 1–240 FPS.`);
  }
  if (Object.hasOwn(value, 'n_primitives_total') &&
      (!Number.isInteger(value.n_primitives_total) || value.n_primitives_total > MAX_SOURCE_POINTS ||
        counts.some(n => n > value.n_primitives_total))) throw Error('Open4DGS frame counts exceed the source primitive count.');
  return Object.freeze({fps, start_frame: start, n_frames: count, per_frame_counts: Object.freeze(counts.slice())});
}

/** Metadata emitted by ASU's trigs-export-plys. Checkpoint paths are ignored. */
export function parseOpen4DGSMetadata(text) {
  if (typeof text !== 'string' || !text.length || text.length > MAX_OPEN4DGS_METADATA_BYTES ||
      new TextEncoder().encode(text).length > MAX_OPEN4DGS_METADATA_BYTES) throw Error('Use a non-empty export_meta.json up to 128 KiB.');
  let value;
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw Error('Open4DGS export_meta.json is not valid JSON.'); }
  return validateMetadata(value);
}

export function frameIndex(index, count) {
  if (!Number.isInteger(index) || index < 0 || index >= count) throw Error('Frame is outside the selected sequence.');
  return index;
}

/** A lazy reader for ASU's numbered, uncompressed Gaussian PLY frames. */
export function createOpen4DGSSequence(files, metadata) {
  const {fps, start_frame: startFrame, n_frames: frameCount, per_frame_counts: counts} = validateMetadata(metadata);
  const selected = Array.from(files ?? []);
  if (selected.length !== frameCount) throw Error(`Select all ${frameCount} PLY frames listed by export_meta.json.`);

  const names = new Map();
  let bytes = 0;
  for (const file of selected) {
    if (!/^frame_\d{6,7}\.ply$/.test(file?.name) || names.has(file.name) || typeof file.arrayBuffer !== 'function') {
      throw Error('Use unique Open4DGS frame_XXXXXX.ply files.');
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_OPEN4DGS_FRAME_BYTES) {
      throw Error(`Open4DGS frames may be at most ${MAX_OPEN4DGS_FRAME_BYTES / 1024 ** 2} MiB each.`);
    }
    bytes += file.size;
    if (bytes > MAX_OPEN4DGS_SEQUENCE_BYTES) throw Error('This Open4DGS sequence exceeds 512 MiB. Export a shorter section.');
    names.set(file.name, file);
  }

  const ordered = counts.map((_, index) => {
    const name = `frame_${String(startFrame + index).padStart(6, '0')}.ply`;
    if (!names.has(name)) throw Error(`Open4DGS frame ${name} is missing.`);
    return names.get(name);
  });

  return Object.freeze({kind: 'ply-sequence', fps, startFrame, frameCount, bytes, durationSeconds: frameCount / fps,
    async loadFrame(index) {
      frameIndex(index, frameCount);
      const file = ordered[index];
      const buffer = await file.arrayBuffer();
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) throw Error(`Could not read ${file.name}.`);
      const parsed = parsePLY(buffer, {maxPoints: MAX_OPEN4DGS_POINTS});
      if (parsed.kind !== 'gaussian-splat') throw Error(`${file.name} needs full Gaussian scale, rotation, colour and opacity data.`);
      if (parsed.total !== counts[index]) throw Error(`${file.name} has a different Gaussian count than export_meta.json.`);
      return {index, frameNumber: startFrame + index, timeSeconds: (startFrame + index) / fps,
        points: parsed.points, total: parsed.total, visible: parsed.points.length / STRIDE,
        sampled: parsed.sampled, skipped: parsed.skipped};
    },
  });
}

export { MAX_OPEN4DGS_TRIGS_BYTES } from './open4dgs-trigs.mjs';
export function openOpen4DGSTrigs(file) {
  return readOpen4DGSTrigs(file, {validPlayback, frameIndex, maxPoints: MAX_OPEN4DGS_POINTS});
}
