import { computeFloorPlane, STRIDE } from './brainsnn-r3f-app/public/world/visual-geometry.mjs';

// Reproduce the test scenario
const pts = new Float32Array(STRIDE * 200);
const floorZ = 1.5;
for (let i = 0; i < pts.length; i += STRIDE) {
  pts[i] = Math.random() * 10 - 5;
  pts[i + 1] = Math.random() * 10 - 5;
  pts[i + 2] = floorZ + (Math.random() - 0.5) * 0.1;
  pts[i + 3] = pts[i + 6] = pts[i + 9] = 1;
  pts[i + 4] = pts[i + 5] = 1;
  pts[i + 7] = pts[i + 8] = pts[i + 10] = pts[i + 11] = pts[i + 12] = pts[i + 13] = 1;
}

// Manually trace through computeFloorPlane
const n = pts.length / STRIDE;
const zs = [];
for (let i = 0; i < pts.length; i += STRIDE) {
  const z = pts[i + 2];
  if (Number.isFinite(z)) zs.push(z);
}
zs.sort((a, b) => a - b);
const lo = zs[Math.floor(zs.length * 0.1)];
const hi = zs[Math.floor(zs.length * 0.9)];
const range = hi - lo;

console.log(`n=${n}, zs.length=${zs.length}, minPoints=50`);
console.log(`zs range: [${zs[0].toFixed(4)}, ${zs[zs.length-1].toFixed(4)}]`);
console.log(`lo=${lo.toFixed(6)}, hi=${hi.toFixed(6)}, range=${range.toFixed(6)}`);
console.log(`range < 1e-6? ${range < 1e-6}`);

// Histogram path
const bins = 64;
const binWidth = range / bins;
const counts = new Int32Array(bins);
for (let i = 0; i < zs.length; i++) {
  const b = Math.min(bins - 1, Math.floor((zs[i] - lo) / binWidth));
  counts[b]++;
}
let maxBin = 0, maxCount = 0;
for (let b = 0; b < bins; b++) {
  if (counts[b] > maxCount) { maxCount = counts[b]; maxBin = b; }
}
const floorZ_calc = lo + (maxBin + 0.5) * binWidth;
const threshold = binWidth * 0.5;
const floorPoints = [];
for (let i = 0; i < zs.length; i++) {
  if (Math.abs(zs[i] - floorZ_calc) < threshold) floorPoints.push(zs[i]);
}
const supportRatio = floorPoints.length / zs.length;

console.log(`\nHistogram path:`);
console.log(`bins=64, binWidth=${binWidth.toFixed(6)}`);
console.log(`maxBin=${maxBin}, maxCount=${maxCount}`);
console.log(`floorZ=${floorZ_calc.toFixed(6)}, threshold=${threshold.toFixed(6)}`);
console.log(`floorPoints.length=${floorPoints.length}, zs.length=${zs.length}`);
console.log(`supportRatio=${supportRatio.toFixed(4)} (>= 0.15? ${supportRatio >= 0.15})`);
console.log(`floorPoints.length >= 10? ${floorPoints.length >= 10}`);
console.log(`metricVerified = ${supportRatio >= 0.15 && floorPoints.length >= 10}`);

// Run the function
const r = computeFloorPlane(pts, 50);
console.log(`\nFunction result: metricVerified=${r.metricVerified}, floorZ=${r.floorZ}, pointCount=${r.pointCount}, supportRatio=${r.supportRatio}`);
