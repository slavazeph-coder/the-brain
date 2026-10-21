import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POINTS, STRIDE, parsePLY, parseSplat, fromDepth, toPLY, bounds, frameBounds, parseVisualAsset } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const ascii = (rows = ['0 0 0 255 0 0', '1 2 3 0 128 255'], props = 'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue', count = rows.length) => new TextEncoder().encode(`ply\nformat ascii 1.0\nelement vertex ${count}\n${props}\nend_header\n${rows.join('\n')}\n`).buffer;

test('framing bounds ignore far reconstruction outliers without removing them', () => {
  // 1,000 points in a unit cube plus 10 triangulated far outliers: full extent is dominated by outliers.
  const rows = [];
  for (let i = 0; i < 1000; i++) rows.push(`${(i % 10) / 10} ${(Math.floor(i / 10) % 10) / 10} ${(Math.floor(i / 100) % 10) / 10} 200 100 50`);
  for (let i = 0; i < 10; i++) rows.push(`${500 + i} ${-300 - i} ${900 + i} 10 10 10`);
  const p = parsePLY(ascii(rows));
  assert.equal(p.points.length / STRIDE, 1010, 'outliers remain in the point buffer');
  const full = bounds(p.points), frame = frameBounds(p.points);
  assert.ok(full.radius > 500, 'full extent is dominated by outliers');
  assert.ok(frame.trimmed === true && frame.radius < 1.5, `framing radius ${frame.radius} should cover the dense core only`);
  assert.ok(frame.center.every(v => Math.abs(v - .45) < .1), 'framing centre sits in the core');
  assert.ok(p.points[3] < .1, `display footprint ${p.points[3]} derives from the core, not the outlier extent`);
  // Without outliers the exact extent is kept and nothing is marked trimmed.
  const clean = parsePLY(ascii(rows.slice(0, 1000)));
  assert.equal(frameBounds(clean.points).trimmed, undefined);
  assert.deepEqual(frameBounds(clean.points).max, bounds(clean.points).max);
  // Tiny clouds never trim.
  assert.deepEqual(frameBounds(parsePLY(ascii()).points), bounds(parsePLY(ascii()).points));
});

test('plain xyz/rgb stays an unverified point cloud and preserves source colour', () => {
  const p = parsePLY(ascii());
  assert.equal(p.kind, 'point-cloud'); assert.equal(p.total, 2); assert.equal(p.metricVerified, false); assert.equal(p.collisionGeometry, null);
  assert.deepEqual([...p.points.slice(STRIDE, STRIDE + 3)], [1, 2, 3]);
  assert.ok(Math.abs(p.points[STRIDE + 7] - 128/255) < 1e-6);
  assert.deepEqual(bounds(p.points).max, [1, 2, 3]);
});
test('binary cloud export round trips positions and retains plain-cloud provenance', () => {
  const initial = parsePLY(ascii()), p = parsePLY(toPLY(initial.points));
  assert.equal(p.kind, 'point-cloud'); assert.deepEqual([...p.points.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...p.points.slice(STRIDE, STRIDE + 3)], [1, 2, 3]);
  assert.ok(Math.abs(p.points[STRIDE+7] - initial.points[STRIDE+7]) < 1/255);
});
test('binary big endian and normalized float colors are read correctly', () => {
  const header = new TextEncoder().encode('ply\nformat binary_big_endian 1.0\nelement vertex 1\nproperty double x\nproperty float y\nproperty int32 z\nproperty float red\nproperty float green\nproperty float blue\nend_header\n');
  const buffer = new ArrayBuffer(header.length+28), view = new DataView(buffer); new Uint8Array(buffer).set(header);
  view.setFloat64(header.length, 2); view.setFloat32(header.length+8, 3); view.setInt32(header.length+12, 4);
  [.2,.4,.6].forEach((v,j)=>view.setFloat32(header.length+16+j*4,v));
  const p=parsePLY(buffer); assert.deepEqual([...p.points.slice(0,3)],[2,3,4]); assert.ok(Math.abs(p.points[6]-.2)<1e-6);
});
test('Gaussian classification requires full trained-parameter layout and DC decoding', () => {
  const props = ['x','y','z','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3','opacity','f_dc_0','f_dc_1','f_dc_2'].map(n=>`property float ${n}`).join('\n');
  const p=parsePLY(ascii(['0 0 0 -2 -2 -2 1 0 0 0 0 1 0 -1'],props));
  assert.equal(p.kind,'gaussian-splat'); assert.ok(Math.abs(p.points[3]-Math.exp(-2))<1e-6); assert.equal(p.points[9],.5); assert.equal(p.points[13],1);
  assert.ok(p.points[6]>.78 && p.points[8]<.22);
  assert.throws(()=>parsePLY(ascii(['0 0 0 0'],'property float x\nproperty float y\nproperty float z\nproperty float opacity')),/Incomplete Gaussian/);
});
test('untrusted PLY metadata and records fail closed', () => {
  for (const value of [new ArrayBuffer(0), new TextEncoder().encode('not ply').buffer]) assert.throws(()=>parsePLY(value));
  assert.throws(()=>parsePLY(ascii(['0 1 2'],'property float x\nproperty float y\nproperty float x')),/Duplicate/);
  assert.throws(()=>parsePLY(ascii(['0 1 2'],'property list uchar float x')),/scalar/);
  assert.throws(()=>parsePLY(ascii(['0 0 0 1 1 1'],undefined,2)),/Truncated/);
  assert.throws(()=>parsePLY(ascii(['NaN 0 0 1 1 1'])),/no usable/);
  assert.throws(()=>parsePLY(ascii(['0 0 0 1 1'])),/Malformed/);
  assert.throws(()=>parsePLY(ascii([],undefined,10000001)),/count/);
  const valid=toPLY(parsePLY(ascii()).points); assert.throws(()=>parsePLY(valid.slice(0,-2)),/Truncated/);
  assert.throws(()=>parseVisualAsset(valid,'model.glb'),/uncompressed/);
});
test('PLY handles CRLF and ignores face data after vertex records', () => {
  const text=new TextDecoder().decode(ascii()).replace('end_header','element face 1\nproperty list uchar int vertex_indices\nend_header')+'3 0 1 0\n';
  assert.equal(parsePLY(new TextEncoder().encode(text.replaceAll('\n','\r\n')).buffer).total,2);
});
test('large binary clouds are uniformly sampled under the fixed display budget', () => {
  const n=MAX_POINTS+1, h=new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`), b=new ArrayBuffer(h.length+n*12);new Uint8Array(b).set(h);
  const p=parsePLY(b); assert.equal(p.sampled,true);assert.ok(p.points.length/STRIDE<=MAX_POINTS);assert.equal(p.total,n);
});
test('splat records reject malformed positions and normalize quaternion', () => {
  const b=new ArrayBuffer(32),v=new DataView(b);[1,2,3,.1,.2,.3].forEach((n,i)=>v.setFloat32(i*4,n,true));
  [255,128,64,200,255,128,128,128].forEach((n,i)=>v.setUint8(24+i,n));
  const p=parseSplat(b);assert.equal(p.kind,'gaussian-splat');assert.equal(p.points[13],1);assert.ok(p.points[9]>.78);
  assert.throws(()=>parseSplat(b.slice(0,31)),/32-byte/);v.setFloat32(0,NaN,true);assert.throws(()=>parseSplat(b),/no usable/);
});
test('depth produces Y-up source-camera points with relative inverse depth, not metres', () => {
  const rgba=new Uint8Array(4*4*4).fill(255),depth=new Float32Array(16).map((_,i)=>i);
  const p=fromDepth(rgba,4,4,depth,4,4);
  assert.equal(p.length/STRIDE,16);assert.ok(p[1]>0);assert.ok(p[2]<-5);assert.ok(p[15*STRIDE+2]>=-1.01);
  assert.equal(parsePLY(toPLY(p)).kind,'point-cloud');
  assert.throws(()=>fromDepth(rgba,4,4,new Float32Array(16).fill(1),4,4),/no usable depth/);
  assert.throws(()=>fromDepth(rgba,4,4,new Float32Array(16).fill(NaN),4,4),/invalid pixels/);
  assert.throws(()=>fromDepth(rgba,8193,4,depth,4,4),/dimensions/);
});
test('transparent images and invalid point arrays cannot produce a successful empty preview', () => {
  const rgba=new Uint8Array(4*4*4),depth=new Float32Array(16).map((_,i)=>i);
  assert.throws(()=>fromDepth(rgba,4,4,depth,4,4),/No visible pixels/);
  assert.throws(()=>bounds(new Float32Array(STRIDE-1)),/Invalid/);
  const p=parsePLY(ascii()).points;p[0]=NaN;assert.throws(()=>bounds(p),/finite/);
  const q=parsePLY(ascii()).points;q.fill(0,10,14);assert.throws(()=>bounds(q),/rotation/);
});
