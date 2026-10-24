import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_POINTS, STRIDE, parsePLY, parseSplat, fromDepth, toPLY, bounds, frameBounds, toArenaCloud, estimateFloor, fitFloorPlane, alignToFloor, parseVisualAsset } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

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

test('Arena hand-off keeps the core, turns COLMAP Y-up, and records every dropped point', () => {
  const rows = [];
  for (let i = 0; i < 1000; i++) rows.push(`${(i % 10) / 10} ${(Math.floor(i / 10) % 10) / 10} ${(Math.floor(i / 100) % 10) / 10} 200 100 50`);
  for (let i = 0; i < 10; i++) rows.push(`${500 + i} ${-300 - i} ${900 + i} 10 10 10`);
  const p = parsePLY(ascii(rows)).points;
  const cloud = toArenaCloud(p, { coordinateFrame: 'colmap', source: 'clip.mp4' });
  assert.equal(cloud.kind, 'colmap-sparse-point-cloud'); assert.equal(cloud.coordinateFrame, 'right-handed-y-up'); assert.equal(cloud.sourceFrame, 'colmap');
  assert.deepEqual(cloud.provenance, { totalPoints: 1010, keptPoints: 1000, outliersDropped: 10, thinned: false, floorAligned: true, floorTiltDegrees: 0, floorYawDegrees: cloud.provenance.floorYawDegrees, floorInlierFraction: 0.1, metricVerified: false });
  // The plane passes through the centre of the floor's height bin, so the floor layer sits within the fit tolerance
  // (1.5% of the frame radius) of y=0.
  const tol = 0.015 * Math.hypot(.9, .9, .9) / 2;
  assert.ok(cloud.points.every(r => r.length === 6 && r[1] >= -tol - 1e-9 && r[3] === 200), 'the floor layer sits at y=0 with the bulk above; colours are 0-255');
  assert.ok(cloud.points.filter(r => r[1] > tol).length === 900, 'every layer above the floor stays above it');
  // A Y-up source is passed through unchanged, and a large cloud is thinned under the Arena budget.
  const same = toArenaCloud(p.subarray(0, 2 * STRIDE)); assert.deepEqual(same.points[1].slice(0, 3), [...p.subarray(STRIDE, STRIDE + 3)]); assert.equal(same.provenance.outliersDropped, 0);
  const big = parsePLY(ascii(Array.from({ length: 2500 }, (_, i) => `${i % 50} ${Math.floor(i / 50)} 0 1 2 3`))).points;
  const thin = toArenaCloud(big, {}, 1000); assert.ok(thin.points.length <= 1000 && thin.provenance.thinned);
});

test('the hand-off records the exact transform from the reconstruction, through tilt, heading and scale', () => {
  // A COLMAP-frame room (y down), tilted and turned, so floor alignment and the heading turn both apply.
  let seed = 11; const r = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296, rows = [];
  for (let i = 0; i < 3000; i++) {
    let x = r() * 4 - 2, y = 0, z = r() * 6 - 3; if (i % 3 === 0) { x = 2; y = r() * 2.4; }
    [x, z] = [Math.cos(.5) * x + Math.sin(.5) * z, -Math.sin(.5) * x + Math.cos(.5) * z];
    rows.push(`${x + 1} ${-(y * Math.cos(.25) - z * Math.sin(.25)) + 1.5} ${-(y * Math.sin(.25) + z * Math.cos(.25)) + 4} 90 80 70`);
  }
  const p = parsePLY(ascii(rows)).points, cloud = toArenaCloud(p, { coordinateFrame: 'colmap', metresPerUnit: .4, measurement: { distance: 2, span: 5 } });
  assert.ok(cloud.provenance.floorAligned && cloud.provenance.floorYawDegrees !== 0);
  const { min, max } = frameBounds(p), M = cloud.fromSource, kept = [];
  for (let i = 0; i < p.length / STRIDE; i++) { const q = [0, 1, 2].map(j => p[i * STRIDE + j]); if (q.every((v, j) => v >= min[j] && v <= max[j])) kept.push(q); }
  assert.equal(kept.length, cloud.points.length);
  const worst = Math.max(...kept.flatMap((q, n) => M.map((row, i) => Math.abs(row[0] * q[0] + row[1] * q[1] + row[2] * q[2] + row[3] - cloud.points[n][i]))));
  assert.ok(worst < 1e-5, `largest difference ${worst}`); // float32 source coordinates
});

test('floor estimate finds the dense low band of a room and declines a facade-only scan', () => {
  // Room: 400 floor points on y=0 over a 6 x 4 footprint, 200 wall points up to y=3 along x=0, a few ceiling points.
  const room = [];
  for (let i = 0; i < 400; i++) room.push([(i % 20) / 19 * 6, 0.02 * Math.random(), Math.floor(i / 20) / 19 * 4, 1, 2, 3]);
  for (let i = 0; i < 200; i++) room.push([0, 0.2 + (i / 200) * 2.8, (i % 20) / 19 * 4, 1, 2, 3]);
  for (let i = 0; i < 20; i++) room.push([i / 19 * 6, 3, 2, 1, 2, 3]);
  const floor = estimateFloor(room);
  assert.ok(Math.abs(floor.y) < 0.15, `floor y ${floor.y} should sit near 0`);
  assert.ok(Math.abs(floor.width - 6) < 0.4 && Math.abs(floor.depth - 4) < 0.3, `footprint ${floor.width} x ${floor.depth}`);
  assert.ok(floor.support > 0.6 && floor.units === 'arbitrary' && floor.origin.every(v => Math.abs(v) < 0.4));
  // Facade only: points spread evenly over a vertical wall have no dominant low band worth more than a few percent.
  const facade = Array.from({ length: 600 }, (_, i) => [(i % 30) / 29 * 5, Math.floor(i / 30) / 19 * 3, 0, 1, 2, 3]);
  assert.ok(estimateFloor(facade).support < 0.2, 'no floor band on a facade');
  assert.equal(estimateFloor(room.slice(0, 10)), null);
  // The Arena hand-off carries the estimate.
  const p = parsePLY(ascii(room.map(r => r.join(' ')))).points;
  assert.ok(toArenaCloud(p).floorEstimate.support > 0.6);
});

test('a tilted room is gravity-aligned on its fitted floor plane before the estimate and the hand-off', () => {
  const room = [];
  for (let i = 0; i < 1500; i++) room.push([(i % 50) / 49 * 6, 0.02 * Math.random(), Math.floor(i / 50) / 29 * 4, 1, 2, 3]);
  for (let i = 0; i < 600; i++) room.push([i % 2 ? 0 : 6, 0.1 + (i / 600) * 2.6, (i % 30) / 29 * 4, 1, 2, 3]);
  // Roll the whole room 25° about X (a phone pointing down) and lift it: Y is no longer up.
  const a = 25 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const tilted = room.map(r => [r[0], r[1] * c - r[2] * s + 3, r[1] * s + r[2] * c + 1, r[3], r[4], r[5]]);
  const plane = fitFloorPlane(tilted);
  assert.ok(plane.inlierFraction > 0.5, `floor inliers ${plane.inlierFraction}`);
  assert.ok(Math.abs(Math.acos(Math.abs(plane.normal[1])) * 180 / Math.PI - 25) < 2, `tilt ${Math.acos(Math.abs(plane.normal[1])) * 180 / Math.PI}`);
  const upright = alignToFloor(tilted, plane), floor = estimateFloor(upright);
  assert.ok(Math.abs(floor.y) < 0.1 && floor.support > 0.6, `floor y ${floor.y} support ${floor.support}`);
  assert.ok(Math.abs(floor.width - 6) < 0.3 && Math.abs(floor.depth - 4) < 0.3, `footprint ${floor.width} x ${floor.depth}`);
  assert.ok(upright.filter(r => r[1] > 0.1).length > 500, 'walls stand above the floor, not below it');
  const cloud = toArenaCloud(parsePLY(ascii(tilted.map(r => r.join(' ')))).points);
  assert.ok(cloud.provenance.floorAligned && Math.abs(cloud.provenance.floorTiltDegrees - 25) < 2 && Math.abs(cloud.floorEstimate.y) < 0.1);
  // One stray point under the floor leaves empty height bins between it and the floor; the floor must still be found.
  const stray = [...tilted, [3, 3 - 0.6 * c, 1 - 0.6 * s, 1, 2, 3]], gapped = fitFloorPlane(stray);
  assert.ok(gapped.inlierFraction > 0.5, `floor inliers with a stray point ${gapped.inlierFraction}`);
  assert.ok(toArenaCloud(parsePLY(ascii(stray.map(r => r.join(' ')))).points).provenance.floorAligned, 'a stray point does not stop the alignment');
  // Heading: the same room yawed 40° comes back squared, long side along Z, so the footprint box is the room again.
  const y = 40 * Math.PI / 180, cy = Math.cos(y), sy = Math.sin(y);
  const yawed = room.map(r => [r[0] * cy + r[2] * sy, r[1], -r[0] * sy + r[2] * cy, r[3], r[4], r[5]]);
  const squared = toArenaCloud(parsePLY(ascii(yawed.map(r => r.join(' ')))).points), f = squared.floorEstimate;
  assert.ok(Math.abs(Math.abs(squared.provenance.floorYawDegrees) - 40) < 3 || Math.abs(Math.abs(squared.provenance.floorYawDegrees) - 50) < 3, `yaw ${squared.provenance.floorYawDegrees}`);
  const sides = [f.width, f.depth].sort((a, b) => a - b);
  assert.ok(Math.abs(sides[0] - 4) < 0.3 && Math.abs(sides[1] - 6) < 0.3, `squared footprint ${f.width} x ${f.depth}`);
  // A wall scan gets no alignment: no horizontal slice of it carries floor-like support.
  const facade = Array.from({ length: 600 }, () => [Math.random() * 5, Math.random() * 3, 0.01 * Math.random(), 1, 2, 3]);
  const wall = toArenaCloud(parsePLY(ascii(facade.map(r => r.join(' ')))).points);
  assert.equal(wall.provenance.floorAligned, false); assert.ok((wall.provenance.floorInlierFraction ?? 0) < 0.1);
});

test('a user-measured distance turns the Arena hand-off into metres, scaling points and floor alike', () => {
  const room = [];
  for (let i = 0; i < 1000; i++) room.push([(i % 40) / 39 * 3, 0.01 * Math.random(), Math.floor(i / 40) / 24 * 2, 1, 2, 3]);
  for (let i = 0; i < 400; i++) room.push([i % 2 ? 0 : 3, 0.05 + (i / 400) * 1.3, (i % 20) / 19 * 2, 1, 2, 3]);
  const p = parsePLY(ascii(room.map(r => r.join(' ')))).points;
  const raw = toArenaCloud(p), metric = toArenaCloud(p, { metresPerUnit: 2, measurement: { distance: 4, span: 2 } });
  assert.equal(raw.units, 'arbitrary'); assert.equal(raw.scale, null); assert.equal(raw.floorEstimate.units, 'arbitrary');
  assert.equal(metric.units, 'm'); assert.deepEqual(metric.scale, { source: 'user-measured', metresPerUnit: 2, distance: 4, spanUnits: 2, selfReported: true, verified: false });
  assert.ok(Math.abs(metric.floorEstimate.width - 2 * raw.floorEstimate.width) < 1e-6 && Math.abs(metric.floorEstimate.depth - 2 * raw.floorEstimate.depth) < 1e-6);
  assert.equal(metric.floorEstimate.units, 'm'); assert.equal(metric.points.length, raw.points.length);
  const span = rows => Math.max(...rows.map(r => r[0])) - Math.min(...rows.map(r => r[0]));
  assert.ok(Math.abs(span(metric.points) - 2 * span(raw.points)) < 1e-6, 'coordinates scale by metresPerUnit');
  // Nonsense scales are ignored rather than applied.
  for (const bad of [0, -1, NaN, Infinity]) assert.equal(toArenaCloud(p, { metresPerUnit: bad }).units, 'arbitrary');
  // A measured scale of exactly one metre per unit is still a measurement, not arbitrary units.
  assert.equal(toArenaCloud(p, { metresPerUnit: 1 }).units, 'm');
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
