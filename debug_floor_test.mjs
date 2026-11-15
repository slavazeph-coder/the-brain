import { computeFloorPlane } from './brainsnn-r3f-app/public/world/visual-geometry.mjs';

const floorZ = 1.5;
let passCount = 0;
for (let run = 0; run < 50; run++) {
  const pts = new Float32Array(3 * 200);
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = Math.random() * 10 - 5;
    pts[i + 1] = Math.random() * 10 - 5;
    pts[i + 2] = floorZ + (Math.random() - 0.5) * 0.1;
  }
  const r = computeFloorPlane(pts, 50);
  if (r.metricVerified) passCount++;
  if (!r.metricVerified) {
    console.log(`Run ${run}: FAIL - metricVerified=${r.metricVerified}, supportRatio=${r.supportRatio}, pointCount=${r.pointCount}`);
  }
}
console.log(`Passed ${passCount}/50 runs`);
