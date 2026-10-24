// Bind the archived hand-off to original PLY points with the site's parser,
// framing/drop/thinning rules and the saved source transform. No floor refit.
import {readFileSync} from 'node:fs';
import {parsePLY, frameBounds, STRIDE, ARENA_MAX_POINTS} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';
const [ply, json] = process.argv.slice(2), raw = readFileSync(ply);
const parsed = parsePLY(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
if (parsed.sampled || parsed.skipped) throw Error('Source PLY was sampled or contained invalid points; original binding is incomplete.');
const cloud = JSON.parse(readFileSync(json, 'utf8')), M = cloud.fromSource;
if (!Array.isArray(M) || M.length !== 3 || M.some(r => !Array.isArray(r) || r.length !== 4 || r.some(x => !Number.isFinite(x)))) throw Error('Invalid source transform.');
const points = parsed.points, box = frameBounds(points), kept = [];
for (let i = 0; i < points.length; i += STRIDE) {
  if ([0, 1, 2].every(j => points[i + j] >= box.min[j] && points[i + j] <= box.max[j])) kept.push(i);
}
const step = Math.max(1, Math.ceil(kept.length / ARENA_MAX_POINTS)), selected = kept.filter((_, i) => i % step === 0);
const provenance = {totalPoints: points.length / STRIDE, keptPoints: selected.length,
  outliersDropped: box.trimmed ? points.length / STRIDE - kept.length : 0, thinned: step > 1};
for (const [key, value] of Object.entries(provenance)) if (cloud.provenance?.[key] !== value) throw Error(`Source point provenance differs: ${key}`);
if (selected.length !== cloud.points.length) throw Error('Hand-off is not the selected original points.');
let maxError = 0;
for (let k = 0; k < selected.length; k++) {
  const i = selected[k], row = cloud.points[k];
  if (!Array.isArray(row) || row.length !== 6 || row.some(x => !Number.isFinite(x))) throw Error(`Invalid hand-off row ${k}`);
  for (let j = 0; j < 3; j++) {
    const expected = M[j][0] * points[i] + M[j][1] * points[i + 1] + M[j][2] * points[i + 2] + M[j][3];
    const error = Math.abs(expected - row[j]); maxError = Math.max(maxError, error);
    if (error > 1e-5) throw Error(`Hand-off differs from original transformed PLY at point ${k}`);
    if (Math.round(points[i + 6 + j] * 255) !== row[j + 3]) throw Error(`Original point colour differs at point ${k}`);
  }
}
console.log(JSON.stringify({verified: true, basis: 'original PLY through saved transform and site framing/thinning',
  points: selected.length, maxCoordinateDifferenceM: maxError, comparisonToleranceM: 1e-5}));
