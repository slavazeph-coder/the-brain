/** Discrete, per-mesh topology and face-normal checks. Never a NURBS continuity certificate. */
export const MAX_AUDIT_TRIANGLES = 200000;
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

export function auditSurfaces(parts, { sharpDegrees = 30 } = {}) {
  if (!Array.isArray(parts) || !parts.length || parts.length > 5000 || !Number.isFinite(sharpDegrees) || sharpDegrees < 1 || sharpDegrees > 179)
    throw Error('Use bounded triangle meshes and a sharp-edge threshold from 1 to 179 degrees.');
  let total = 0;
  for (const p of parts) {
    if (!p?.positions || p.positions.length < 9 || p.positions.length % 3 || !(p.indices?.length ?? p.positions.length / 3) || (p.indices?.length ?? p.positions.length / 3) % 3)
      throw Error('Surface inspection requires triangle positions and complete triangle indices.');
    total += (p.indices?.length ?? p.positions.length / 3) / 3;
  }
  if (total > MAX_AUDIT_TRIANGLES) throw Error(`Surface audit supports at most ${MAX_AUDIT_TRIANGLES.toLocaleString('en')} triangles. Export a smaller inspection copy. No partial audit was reported.`);
  const meshes = parts.map((p, part) => {
    const positions = p.positions, vertices = positions.length / 3, ids = [], unique = new Map(), points = [];
    for (let i = 0; i < vertices; i++) {
      const point = Array.from(positions.slice(i * 3, i * 3 + 3));
      if (!point.every(v => Number.isFinite(v) && Math.abs(v) <= 10000000)) throw Error('Invalid surface coordinates.');
      const key = point.map(v => Object.is(v, -0) ? 0 : v).join(',');
      if (!unique.has(key)) { unique.set(key, unique.size); points.push(point); }
      ids.push(unique.get(key));
    }
    const edges = new Map(), faces = new Set();
    let degenerateTriangles = 0, duplicateTriangles = 0, boundaryEdges = 0, nonManifoldEdges = 0, windingConflicts = 0, sharpEdges = 0;
    const indices = p.indices ?? Array.from({length:vertices}, (_, i) => i), angles = [];
    for (let i = 0; i < indices.length; i += 3) {
      const raw = Array.from(indices.slice(i, i + 3));
      if (raw.some(v => !Number.isSafeInteger(v) || v < 0 || v >= vertices)) throw Error('Surface index is outside its vertex buffer.');
      const tri = raw.map(v => ids[v]), [a,b,c] = tri.map(v => points[v]);
      const n = cross(sub(b,a), sub(c,a)), length = Math.hypot(...n);
      if (!length || new Set(tri).size < 3) { degenerateTriangles++; continue; }
      const faceKey = [...tri].sort((a,b)=>a-b).join(',');
      if (faces.has(faceKey)) duplicateTriangles++; else faces.add(faceKey);
      const normal = n.map(v => v / length);
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k+1)%3], key = a < b ? `${a},${b}` : `${b},${a}`;
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push({normal, direction:a < b ? 1 : -1});
      }
    }
    for (const uses of edges.values()) {
      if (uses.length === 1) boundaryEdges++;
      else if (uses.length > 2) nonManifoldEdges++;
      else {
        if (uses[0].direction === uses[1].direction) windingConflicts++;
        const angle = Math.acos(Math.max(-1, Math.min(1, dot(uses[0].normal, uses[1].normal)))) * 180 / Math.PI;
        angles.push(angle); if (angle >= sharpDegrees) sharpEdges++;
      }
    }
    angles.sort((a,b)=>a-b);
    return {part, name:String(p.name || `Mesh ${part+1}`).slice(0,120), triangles:indices.length/3,
      exactPositionVertices:unique.size, boundaryEdges, nonManifoldEdges, windingConflicts, degenerateTriangles, duplicateTriangles, sharpEdges,
      faceAngleP95Degrees:angles.length ? angles[Math.floor((angles.length-1)*.95)] : null,
      closedManifoldCandidate:boundaryEdges+nonManifoldEdges+windingConflicts+degenerateTriangles+duplicateTriangles === 0};
  });
  const fields = ['triangles','boundaryEdges','nonManifoldEdges','windingConflicts','degenerateTriangles','duplicateTriangles','sharpEdges'];
  return {schema:'brainsnn.surface-audit.v1', status:'complete', meshes,
    totals:Object.fromEntries(fields.map(k=>[k,meshes.reduce((s,m)=>s+m[k],0)])), sharpDegrees,
    weld:'Exact coincident positions within each mesh only. Separate meshes are never welded.',
    scope:'Triangle topology and adjacent face-normal angles. Open boundaries and sharp edges may be intentional. No self-intersection or inter-mesh gap test.',
    geometricContinuity:'G0/G1/G2/G3 not certified; analytic NURBS derivatives are unavailable in a GLB mesh.',
    metricVerified:false, collisionReady:false, physicalRobotValidated:false};
}
