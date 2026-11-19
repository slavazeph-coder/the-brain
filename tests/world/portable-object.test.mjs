import test from 'node:test';
import assert from 'node:assert/strict';
import {createObjectDocument, createObjectifyContext, addObject, updateObject, objectifySha256} from '../../brainsnn-r3f-app/public/world/objectify-core.mjs';
import {makePortableObject, readPortableObject, composePortableObject} from '../../brainsnn-r3f-app/public/world/portable-object.mjs';
import {mountPortableObject} from '../../brainsnn-r3f-app/public/world/portable-object-ui.mjs';
import {MAX_POINTS, parseVisualAsset, STRIDE} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const A = {name:'first.ply', sha256:'a'.repeat(64), bytes:2048};
const B = {name:'second.ply', sha256:'b'.repeat(64), bytes:4096};
const row = (x, y, z) => [x, y, z, .05, .1, .15, .125, .5, .75, .8, 0, 0, 0, 1];
const equalNear = (value, expected, epsilon = 1e-5) => {
  assert.equal(value.length, expected.length);
  for (const [i, n] of Array.from(value).entries()) assert.ok(Math.abs(n - expected[i]) < epsilon, `${i}: ${n} ≠ ${expected[i]}`);
};

async function selection(kind = 'gaussian-splat', reviewed = true) {
  const points = new Float32Array([...row(0, 0, 0), ...row(2, 1, 0), ...row(4, 2, 2), ...row(6, 0, 1)]);
  const context = await createObjectifyContext({
    source:A, points, sourceIndices:Uint32Array.of(1,8,14,21), kind, total:36,
    displayTransform:'flip-y-z', sampled:true,
  });
  const added = addObject(context, createObjectDocument(context), {name:'Blue Chair', indices:[1,2], reviewed});
  const id = added.document.instances[0].id;
  return {context, document:added.document, id, points};
}

function target(kind = 'gaussian-splat', count = 3) {
  const points = new Float32Array(count * STRIDE);
  for (let i = 0; i < count; i++) points.set(row(i, 0, -1), i * STRIDE);
  return {source:B, points, displayTransform:'identity', parsed:{
    kind, total:count + 1, sourceIndices:Uint32Array.from({length:count}, (_, i) => i + 1),
    parserMetadata:{version:'visual-geometry-v2'},
  }};
}

const pose = {anchor:[5, .25, 8], yawDegrees:90, scale:2};

function plySourceRows(buffer, stride, attributes) {
  const header = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 2048)));
  const start = header.indexOf('end_header\n') + 'end_header\n'.length;
  const view = new DataView(buffer);
  const rows = [];
  for (let at = start; at < buffer.byteLength; at += stride) {
    rows.push([view.getUint8(at + attributes * 4), view.getUint32(at + attributes * 4 + 1, true)]);
  }
  return rows;
}

test('portable Gaussian preserves a reviewed posed subset, scale, yaw, two source bindings and exact exported bytes', async () => {
  const selected = await selection();
  const edits = updateObject(selected.context, selected.document, selected.id, {translation:[4,0,6], yawDegrees:90});
  const sourceBefore = selected.points.slice();
  const snapshot = await makePortableObject(selected.context, edits, selected.id);
  assert.equal(snapshot.filename, 'blue-chair.brainobject');
  const portable = await readPortableObject(snapshot.buffer);
  assert.equal(portable.count, 2);
  assert.equal(portable.sourceSha256, A.sha256);
  assert.equal(portable.sha256, await objectifySha256(snapshot.buffer));
  const destination = target();
  const original = destination.points.slice();
  const composed = await composePortableObject(destination, portable, pose);
  const {receipt, buffer} = composed;
  const meta = receipt.portableObject.manifest;
  assert.equal(meta.source.orientation, 'flip-y-z');
  assert.equal(meta.source.sha256, A.sha256);
  assert.equal(meta.object.revision, edits.revision);
  assert.equal(meta.object.boundariesReviewed, true);
  assert.equal(receipt.destination.sha256, B.sha256);
  assert.equal(receipt.artifact.sha256, await objectifySha256(buffer));
  assert.equal(receipt.collisionChecked, false);
  assert.equal(receipt.realWorldScaleVerified, false);
  assert.equal(receipt.units, 'destination-local-unverified');
  const replay = await composePortableObject(destination, portable, pose);
  assert.equal(replay.receipt.artifact.sha256, receipt.artifact.sha256);
  assert.deepEqual(plySourceRows(buffer, 61, 14), [[0,1],[0,2],[0,3],[1,8],[1,14]]);
  const points = parseVisualAsset(buffer, composed.name).points;
  equalNear(points.subarray(0, STRIDE * 3), original);
  equalNear(points.subarray(STRIDE * 3, STRIDE * 3 + 3), [7,.25,10]);
  equalNear(points.subarray(STRIDE * 4, STRIDE * 4 + 3), [3,2.25,6]);
  equalNear(points.subarray(STRIDE * 4 + 3, STRIDE * 4 + 6), [.1,.2,.3]);
  assert.ok(Math.abs(points[STRIDE * 4 + 11]) > .99999);
  assert.deepEqual(destination.points, original);
  assert.deepEqual(selected.points, sourceBefore);
});

test('point cloud placement preserves exact colors and all object samples at the viewer limit', async () => {
  const selected = await selection('point-cloud');
  const snapshot = await makePortableObject(selected.context, selected.document, selected.id);
  const portable = await readPortableObject(snapshot.buffer);
  const composed = await composePortableObject(target('point-cloud', MAX_POINTS), portable, pose);
  const parsed = parseVisualAsset(composed.buffer, composed.name);
  assert.equal(parsed.kind, 'point-cloud');
  assert.equal(parsed.total, MAX_POINTS);
  assert.equal(parsed.sampled, false);
  assert.equal(composed.receipt.destination.used, MAX_POINTS - 2);
  assert.equal(composed.receipt.destination.sampling, 'evenly-spaced-retained-indices');
  equalNear(parsed.points.slice(-8, -5), [.125,.5,.75]);
});

test('only reviewed visible selected objects export, with malformed packages and incompatible destinations rejected', async () => {
  const unreviewed = await selection('gaussian-splat', false);
  await assert.rejects(makePortableObject(unreviewed.context, unreviewed.document, unreviewed.id), /reviewed boundaries/);
  const seen = await selection();
  const hidden = updateObject(seen.context, seen.document, seen.id, {hidden:true});
  await assert.rejects(makePortableObject(seen.context, hidden, seen.id), /visible object/);
  const {buffer} = await makePortableObject(seen.context, seen.document, seen.id);
  await assert.rejects(readPortableObject(buffer.slice(0, -1)), /manifest/);
  const corrupted = buffer.slice(0);
  const bytes = new Uint8Array(corrupted);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(readPortableObject(corrupted), /manifest/);
  const portable = await readPortableObject(buffer);
  await assert.rejects(composePortableObject({...target(), source:A}, portable, pose), /second scan/);
  await assert.rejects(composePortableObject(target('point-cloud'), portable, pose), /same appearance type/);
  await assert.rejects(composePortableObject(target(), portable, {...pose, scale:0}), /scale/);
  await assert.rejects(composePortableObject(target(), portable, {...pose, anchor:[Infinity,0,0]}), /finite position/);
});

function portablePanel() {
  const keys = ['file','pose','x','y','z','scale','yaw','status','place','clear','ply','receipt','restore'];
  const nodes = Object.fromEntries(keys.map(key => [key, {value:'', get valueAsNumber() { return Number(this.value); }}]));
  const picker = nodes.file;
  picker.files = [];
  Object.defineProperty(picker, 'value', {set(value) { if (value === '') this.files = []; }});
  const destination = target();
  const stage = {artifact:null, restorations:0};
  const view = mountPortableObject({
    root:{querySelector:selector => nodes[selector.slice('[data-portable-'.length, -1)]},
    getDestination:() => destination,
    onStage(next, current) { assert.ok(current()); stage.artifact = next; },
    onRestore() { stage.artifact = null; stage.restorations++; },
  });
  view.setDestination(destination);
  function selectFile(file) {
    picker.files = file ? [file] : [];
    return picker.onchange();
  }
  return {nodes, view, stage, selectFile};
}

function packageFile(buffer) {
  return {size:buffer.byteLength, arrayBuffer:async () => buffer};
}

test('invalid or oversized picker replacements preserve a staged composite, pose and exports', async () => {
  const {context, document, id:instanceId} = await selection();
  const panel = portablePanel();
  const {nodes, view, stage, selectFile} = panel;
  await view.capture({context, document, instanceId, download:false}, () => true);
  nodes.x.value = '3.5';
  await nodes.place.onclick();
  const original = stage.artifact;
  assert.equal(original.receipt.placement.anchor[0], 3.5);
  const valid = (await makePortableObject(context, document, instanceId)).buffer;
  const corrupt = valid.slice(0);
  new Uint8Array(corrupt)[corrupt.byteLength - 1] ^= 1;
  for (const candidate of [packageFile(new ArrayBuffer(16)), packageFile(corrupt),
    {size:64*1024**2, arrayBuffer:() => assert.fail('Read an oversized file')}]) {
    await selectFile(candidate);
    assert.match(nodes.status.textContent, /could not be opened.*Current object: Blue Chair/u);
    assert.equal(stage.artifact, original);
    assert.equal(stage.restorations, 0);
    assert.equal(nodes.x.value, '3.5');
    assert.equal(nodes.ply.disabled, false);
    assert.equal(nodes.receipt.disabled, false);
    assert.equal(nodes.restore.disabled, false);
    assert.equal(nodes.place.disabled, false);
  }
  await selectFile(null);
  await selectFile(packageFile(valid));
  assert.equal(stage.artifact, original);
});

test('only the newest replacement wins, and clearing cancels reads and shelf saves', async () => {
  const {context, document, id:instanceId} = await selection();
  const {view, nodes, selectFile, stage} = portablePanel();
  const valid = (await makePortableObject(context, document, instanceId)).buffer;
  const renamed = updateObject(context, document, instanceId, {name:'New chair'});
  const latest = (await makePortableObject(context, renamed, instanceId)).buffer;
  await selectFile(packageFile(valid));
  await nodes.place.onclick();
  let finishRead;
  const delayedFile = {size:valid.byteLength, arrayBuffer:() => new Promise(resolve => { finishRead = resolve; })};
  const interrupted = selectFile(delayedFile);
  await selectFile(packageFile(new ArrayBuffer(16)));
  finishRead(latest);
  await interrupted;
  assert.match(nodes.status.textContent, /Current object: Blue Chair/u);
  assert.equal(stage.restorations, 0);
  const slower = selectFile(delayedFile);
  await selectFile(packageFile(latest));
  finishRead(valid);
  await slower;
  assert.match(nodes.status.textContent, /New chair/u);
  assert.equal(stage.restorations, 1);
  assert.equal(nodes.receipt.disabled, true);
  const pendingRead = selectFile(delayedFile);
  view.clear();
  finishRead(valid);
  await pendingRead;
  assert.equal(nodes.pose.hidden, true);
  const pendingShelf = view.capture({context, document, instanceId, download:false}, () => true);
  view.clear();
  await assert.rejects(pendingShelf, /selection changed/u);
  assert.match(nodes.status.textContent, /Keep a reviewed object/u);
  assert.equal(nodes.place.disabled, true);
});
