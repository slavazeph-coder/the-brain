import test from 'node:test';
import assert from 'node:assert/strict';
import {auditSurfaces, MAX_AUDIT_TRIANGLES} from '../../brainsnn-r3f-app/public/world/surface-audit.mjs';
const quad={positions:[0,0,0,1,0,0,1,1,0,0,1,0],indices:[0,1,2,0,2,3]};
test('an open planar patch has four boundary edges and no false sharp seam',()=>{
  const before=structuredClone(quad),report=auditSurfaces([quad]),m=report.meshes[0];
  assert.equal(m.boundaryEdges,4);assert.equal(m.sharpEdges,0);assert.equal(m.faceAngleP95Degrees,0);
  assert.equal(m.closedManifoldCandidate,false);assert.equal(report.metricVerified,false);assert.deepEqual(quad,before);
  assert.match(report.geometricContinuity,/not certified/);
});
test('exact coincident split vertices join within one mesh, while separate components stay separate',()=>{
  const split={positions:[0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0]};
  assert.equal(auditSurfaces([split]).totals.boundaryEdges,4);
  const separate=[{positions:split.positions.slice(0,9)},{positions:split.positions.slice(9)}];
  assert.equal(auditSurfaces(separate).totals.boundaryEdges,6);
  split.positions[9]=1e-9;
  assert.equal(auditSurfaces([split]).totals.boundaryEdges,6,'no silent near-position welding');
});
test('a 90-degree crease is reported, winding, degeneracy and non-manifold defects stay visible',()=>{
  const crease={positions:[0,0,0,1,0,0,0,1,0,0,0,1],indices:[0,1,2,1,0,3]};
  assert.equal(auditSurfaces([crease]).totals.sharpEdges,1);
  const broken={...crease,indices:[0,1,2,0,1,3,0,1,2,0,0,1]};
  const t=auditSurfaces([broken]).totals;
  assert.ok(t.nonManifoldEdges>0);assert.equal(t.degenerateTriangles,1);assert.equal(t.duplicateTriangles,1);
  const flipped={...quad,indices:[0,1,2,0,3,2]};
  assert.equal(auditSurfaces([flipped]).totals.windingConflicts,1);
});
test('a consistently oriented tetrahedron is only a closed-manifold candidate',()=>{
  const r=auditSurfaces([{positions:[0,0,0,1,0,0,0,1,0,0,0,1],indices:[0,2,1,0,1,3,0,3,2,1,2,3]}]);
  assert.equal(r.meshes[0].closedManifoldCandidate,true);assert.equal(r.collisionReady,false);
  assert.match(r.scope,/No self-intersection/);
});
test('malformed or oversized meshes refuse a report rather than returning partial success',()=>{
  assert.throws(()=>auditSurfaces([{...quad,indices:[0,1,99]}]),/outside/);
  assert.throws(()=>auditSurfaces([{positions:[NaN,0,0,1,0,0,0,1,0]}]),/Invalid/);
  assert.throws(()=>auditSurfaces([{positions:quad.positions,indices:new Uint32Array((MAX_AUDIT_TRIANGLES+1)*3)}]),/No partial/);
  assert.throws(()=>auditSurfaces([{positions:[]}]),/requires/);
});
