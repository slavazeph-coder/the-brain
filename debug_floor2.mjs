import { computeFloorPlane, STRIDE } from './brainsnn-r3f-app/public/world/visual-geometry.mjs';

// Run the function multiple times and print its internal state
for (let run = 0; run < 5; run++) {
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
  const r = computeFloorPlane(pts, 50);
  console.log(`Run ${run}: metricVerified=${r.metricVerified}, floorZ=${r.floorZ.toFixed(4)}, pointCount=${r.pointCount}, supportRatio=${r.supportRatio?.toFixed(4)}`);
}

// Now test with a truly uniform Z (range < 1e-6)
const pts2 = new Float32Array(STRIDE * 200);
for (let i = 0; i < pts2.length; i += STRIDE) {
  pts2[i] = Math.random() * 10 - 5;
  pts2[i + 1] = Math.random() * 10 - 5;
  pts2[i + 2] = 1.5;  // exact uniform
  pts2[i + 3] = pts2[i + 6] = pts2[i + 9] = 1;
  pts2[i + 4] = pts2[i + 5] = 1;
  pts2[i + 7] = pts2[i + 8] = pts2[i + 10] = pts2[i + 11] = pts2[i + 12] = pts2[i + 13] = 1;
}
const r2 = computeFloorPlane(pts2, 50);
console.log(`\nUniform Z (exact): metricVerified=${r2.metricVerified}, floorZ=${r2.floorZ.toFixed(4)}, pointCount=${r2.pointCount}`);
