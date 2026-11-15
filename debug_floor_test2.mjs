import { computeFloorPlane, STRIDE } from './brainsnn-r3f-app/public/world/visual-geometry.mjs';

console.log('STRIDE from module:', STRIDE);

const floorZ = 1.5;
let passCount = 0;
for (let run = 0; run < 50; run++) {
  const pts = new Float32Array(STRIDE * 200);
  for (let i = 0; i < pts.length; i += STRIDE) {
    pts[i] = Math.random() * 10 - 5;
    pts[i + 1] = Math.random() * 10 - 5;
    pts[i + 2] = floorZ + (Math.random() - 0.5) * 0.1;
    pts[i + 3] = pts[i + 6] = pts[i + 9] = 1;
    pts[i + 4] = pts[i + 5] = 1;
    pts[i + 7] = pts[i + 8] = pts[i + 10] = pts[i + 11] = pts[i + 12] = pts[i + 13] = 1;
  }
  const r = computeFloorPlane(pts, 50);
  if (r.metricVerified) passCount++;
  if (!r.metricVerified) {
    console.log(`Run ${run}: FAIL - metricVerified=${r.metricVerified}, supportRatio=${r.supportRatio}, pointCount=${r.pointCount}, len=${pts.length}, len%STRIDE=${pts.length % STRIDE}`);
  }
}
console.log(`Passed ${passCount}/50 runs`);
