import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  OBJECTIFY_LIMITS, createObjectifyContext, getObjectifyBase, createObjectDocument, resetObjectDocument,
  addObject, updateObject, duplicateObject, removeObject, composeObjectDocument,
  serializeObjectDocument, parseObjectDocument, seededObjectVariants, exportObjectVariant, objectifySha256,
} from '../../brainsnn-r3f-app/public/world/objectify-core.mjs';
import { parsePLY, parseSplat, STRIDE, MAX_POINTS } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const source = { name:'capture.ply',bytes:2048,sha256:'a'.repeat(64) };
const bytes = array => Buffer.from(array.buffer,array.byteOffset,array.byteLength);
const near = (actual,expected,tolerance=1e-6) => assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} != ${expected} ±${tolerance}`);
const xyz = (points,i) => Array.from(points.subarray(i*STRIDE,i*STRIDE+3));
function fixture(count=4) {
  const points = new Float32Array(count*STRIDE);
  for(let i=0;i<count;i++)points.set([i%100,Math.floor(i/100)%100,Math.floor(i/10000),.02,.04,.08,.2,.4,.8,.7,0,0,0,1],i*STRIDE);
  return points;
}
async function context({points=fixture(),kind='gaussian-splat',sourceIndices,total,displayTransform='identity',...rest}={}) {
  sourceIndices ??= Uint32Array.from({length:points.length/STRIDE},(_,i)=>i*3+2);
  total ??= sourceIndices.at(-1)+1;
  return createObjectifyContext({source,points,sourceIndices,total,kind,displayTransform,...rest});
}
function group(ctx,{indices=[0,1],reviewed=true,name='Reviewed chair'}={}) {
  return addObject(ctx,createObjectDocument(ctx),{name,indices,reviewed});
}
function header(buffer){return new TextDecoder().decode(new Uint8Array(buffer).subarray(0,payloadOffset(buffer)));}
function payloadOffset(buffer){const view=new Uint8Array(buffer),marker=new TextEncoder().encode('end_header\n');
  for(let i=0;i<=view.length-marker.length;i++)if(marker.every((v,j)=>view[i+j]===v))return i+marker.length;
  assert.fail('Missing binary PLY header');
}

test('immutable source context, identity grouping and reset retain every original float bit and source ID',async()=>{
  const points=fixture(),original=points.slice(),sourceIndices=Uint32Array.from([2,5,8,11]);points[0]=-0;original[0]=-0;
  const ctx=await context({points,sourceIndices});
  points.fill(0);sourceIndices.fill(0);
  const copy=getObjectifyBase(ctx);copy.points.fill(0);copy.sourceIndices.fill(0);
  const initial=composeObjectDocument(ctx,createObjectDocument(ctx));
  assert.deepEqual(bytes(initial.points),bytes(original));assert.deepEqual([...initial.sourceIndices],[2,5,8,11]);
  assert.deepEqual([...initial.previewIndices],[0,1,2,3]);assert.deepEqual([...initial.instanceIds],[0,0,0,0]);
  const {document,id}=group(ctx);assert.deepEqual(bytes(composeObjectDocument(ctx,document).points),bytes(original));
  const moved=updateObject(ctx,document,id,{translation:[3,1,-2],yawDegrees:43});
  assert.notDeepEqual(bytes(composeObjectDocument(ctx,moved).points),bytes(original));
  assert.deepEqual(bytes(composeObjectDocument(ctx,resetObjectDocument(ctx)).points),bytes(original));
  assert.equal(ctx.source.parserVersion,'visual-geometry-v2');assert.equal(Object.isFrozen(ctx.source),true);
  assert.equal(ctx.source.previewSha256.length,64);assert.equal(ctx.source.sourceIndicesSha256.length,64);
});

test('reviewed yaw and translation move the actual selected samples and rotate anisotropic covariance, leaving background exact',async()=>{
  const points=fixture();points.set([0,1,0],0);points.set([2,1,0],STRIDE);
  // Original local X axis points along global +Y after a 90 degree Z rotation.
  for(const i of [0,1])points.set([0,0,Math.SQRT1_2,Math.SQRT1_2],i*STRIDE+10);
  const ctx=await context({points}),{document,id}=group(ctx);
  const edited=updateObject(ctx,document,id,{translation:[3,2,4],yawDegrees:90}),rendered=composeObjectDocument(ctx,edited);
  assert.deepEqual(xyz(rendered.points,0),[4,3,5]);assert.deepEqual(xyz(rendered.points,1),[4,3,3]);
  assert.deepEqual(bytes(rendered.points.subarray(2*STRIDE)),bytes(points.subarray(2*STRIDE)));
  assert.deepEqual([...rendered.sourceIndices],[2,5,8,11]);assert.deepEqual([...rendered.instanceIds],[1,1,0,0]);
  const [x,y,z,w]=rendered.points.subarray(10,14);
  // Quaternion rotation matrix columns are the principal covariance axes.
  const axisX=[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)];
  const axisY=[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)];
  const axisZ=[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)];
  for(const [actual,expected] of [[axisX,[0,1,0]],[axisY,[0,0,1]],[axisZ,[1,0,0]]])actual.forEach((v,i)=>near(v,expected[i]));
  assert.deepEqual([...rendered.points.subarray(3,10)],[...points.subarray(3,10)]);
  assert.deepEqual(rendered.objects[0].bounds,{min:[4,3,3],max:[4,3,5],center:[4,3,4],size:[0,0,2]});
  assert.deepEqual(document.instances[0].translation,[0,0,0]);
  const translated=composeObjectDocument(ctx,updateObject(ctx,document,id,{translation:[1,2,3]}));
  assert.deepEqual(bytes(translated.points.subarray(3,14)),bytes(points.subarray(3,14)));
});

test('manual candidates need review before pose, hiding or copying; rejected edits are atomic',async()=>{
  const ctx=await context(),{document,id}=group(ctx,{reviewed:false});const before=serializeObjectDocument(ctx,document);
  for(const patch of [{translation:[1,0,0]},{yawDegrees:10},{hidden:true}])assert.throws(()=>updateObject(ctx,document,id,patch),/Review the selected object/);
  assert.throws(()=>duplicateObject(ctx,document,id),/Review/);assert.equal(serializeObjectDocument(ctx,document),before);
  const named=updateObject(ctx,document,id,{name:'Manual candidate'});assert.equal(named.objects[0].name,'Manual candidate');
  const reviewed=updateObject(ctx,named,id,{reviewed:true,translation:[1,0,0]});
  assert.throws(()=>updateObject(ctx,reviewed,id,{reviewed:false}),/Review/);
  const copied=duplicateObject(ctx,updateObject(ctx,named,id,{reviewed:true}),id);
  assert.throws(()=>updateObject(ctx,copied.document,id,{reviewed:false}),/Review/);
  assert.throws(()=>updateObject(ctx,reviewed,id,{scale:[2,2,2]}),/Unsupported object update/);
});

test('disjoint exact masks, stable IDs and source membership survive hidden primaries and visible copies',async()=>{
  const ctx=await context(),{document,id}=group(ctx,{indices:[1,0]}),copy=duplicateObject(ctx,document,id,{translation:[0,2,0]});
  assert.deepEqual(copy.document.objects[0].indices,[0,1]);assert.equal(id,'object-000001');assert.equal(copy.id,'instance-000002');
  const hidden=updateObject(ctx,copy.document,id,{hidden:true}),out=composeObjectDocument(ctx,hidden);
  assert.deepEqual([...out.previewIndices],[2,3,0,1]);assert.deepEqual([...out.sourceIndices],[8,11,2,5]);assert.deepEqual([...out.instanceIds],[0,0,2,2]);
  assert.equal(out.objects[1].tag,2);assert.equal(out.objects[1].objectId,id);assert.equal(out.objects[0].boundsKind,'conservative-transformed-base-AABB');
  assert.throws(()=>addObject(ctx,document,{indices:[1,2]}),/overlap/);
  for(const indices of [[0,0],[-1],[4],[],[.2]])assert.throws(()=>addObject(ctx,document,{indices}));
  const removed=removeObject(ctx,copy.document,copy.id);assert.equal(removed.instances.length,1);
  assert.throws(()=>removeObject(ctx,removed,removed.instances[0].id),/Remove the object group/);
  const restored=removeObject(ctx,hidden,id);assert.deepEqual(bytes(composeObjectDocument(ctx,restored).points),bytes(getObjectifyBase(ctx).points));
  const next=addObject(ctx,restored,{indices:[2]});assert.equal(next.id,'object-000002');
});

test('enforces visible 100k, object and instance limits without treating hidden instances as rendered geometry',async()=>{
  const ctx=await context({points:fixture(MAX_POINTS)}),one=group(ctx,{indices:[0]});
  assert.throws(()=>duplicateObject(ctx,one.document,one.id),/100,000 visible/);
  const hidden=updateObject(ctx,one.document,one.id,{hidden:true}),copy=duplicateObject(ctx,hidden,one.id,{hidden:false});
  assert.equal(composeObjectDocument(ctx,copy.document).stats.visiblePoints,MAX_POINTS);
  const small=await context({points:fixture(100)});let doc=createObjectDocument(small);
  for(let i=0;i<32;i++)doc=addObject(small,doc,{indices:[i],reviewed:true}).document;
  assert.throws(()=>addObject(small,doc,{indices:[33],reviewed:true}),/at most 32/);
  while(doc.instances.length<64)doc=duplicateObject(small,doc,doc.objects[0].id,{hidden:true}).document;
  assert.throws(()=>duplicateObject(small,doc,doc.objects[0].id,{hidden:true}),/at most 32 objects and 64 instances/);
  assert.equal(OBJECTIFY_LIMITS.points,100000);
});

test('64 hidden 100k-sample instances use corner proxies, never millions of sample or covariance transformations',async t=>{
  const ctx=await context({points:fixture(MAX_POINTS)});let {document,id}=group(ctx,{indices:Array.from({length:MAX_POINTS},(_,i)=>i)});
  document=updateObject(ctx,document,id,{hidden:true,yawDegrees:27});
  while(document.instances.length<64)document=duplicateObject(ctx,document,id,{hidden:true,translation:[document.instances.length,0,0]}).document;
  const start=performance.now(),out=composeObjectDocument(ctx,document);
  t.diagnostic(`64 hidden × 100k membership compose: ${(performance.now()-start).toFixed(1)} ms on this runner; no timing assertion`);
  assert.equal(out.points.length,0);assert.equal(out.stats.boundsPointEvaluations,0);assert.equal(out.stats.hiddenBoundsCornerEvaluations,512);
  assert.equal(out.objects.length,64);assert.equal(out.objects[63].boundsKind,'conservative-transformed-base-AABB');
  assert.ok(out.objects[63].bounds.min.every(Number.isFinite));
});

test('seeded variants reproduce seed zero exactly, change with seed, bound perturbations and clear metadata after manual changes',async()=>{
  const ctx=await context(),{document,id}=group(ctx);const options={seed:0,count:3,translationRange:[.5,0,.25],yawRangeDegrees:20};
  const a=seededObjectVariants(ctx,document,options),b=seededObjectVariants(ctx,document,options);
  assert.deepEqual(a,b);assert.notDeepEqual(a,seededObjectVariants(ctx,document,{...options,seed:1}));
  assert.equal(a[0].variation.seed,0);assert.equal(a[2].variation.index,2);assert.equal(a[0].variation.baseRevision,document.revision);
  for(const variant of a){const pose=variant.instances[0];assert.ok(Math.abs(pose.translation[0])<=.5);assert.equal(pose.translation[1],0);assert.ok(Math.abs(pose.translation[2])<=.25);assert.ok(Math.abs(pose.yawDegrees)<=20);}
  assert.deepEqual(a[0].instances,seededObjectVariants(ctx,document,{...options,count:1})[0].instances);
  const zero=seededObjectVariants(ctx,document,{seed:0,count:1,translationRange:[0,0,0],yawRangeDegrees:0})[0];
  assert.deepEqual(bytes(composeObjectDocument(ctx,zero).points),bytes(getObjectifyBase(ctx).points));
  assert.equal(updateObject(ctx,a[0],id,{name:'Edited after seed'}).variation,null);
  assert.throws(()=>seededObjectVariants(ctx,document,{count:17}),/variation count/);
  assert.throws(()=>seededObjectVariants(ctx,document,{seed:-1}),/variation seed/);
  assert.throws(()=>seededObjectVariants(ctx,group(ctx,{reviewed:false}).document),/Review/);
});

test('JSON re-import is bound to exact file, preview, source IDs and display orientation and rejects malformed claims and shapes',async()=>{
  const ctx=await context(),{document}=group(ctx),serialized=serializeObjectDocument(ctx,document);
  assert.deepEqual(parseObjectDocument(ctx,serialized),document);
  for(const field of ['sha256','previewSha256','sourceIndicesSha256','parserVersion','displayTransform']){const changed=JSON.parse(serialized);changed.source[field]='different';assert.throws(()=>parseObjectDocument(ctx,JSON.stringify(changed)),/different source/);}
  const flipped=await context({displayTransform:'flip-y-z'});assert.throws(()=>parseObjectDocument(flipped,serialized),/different source/);
  const changedPoints=fixture();changedPoints[0]=99;const changed=await context({points:changedPoints});assert.throws(()=>parseObjectDocument(changed,serialized),/different source/);
  const invalid=[d=>{d.claims.metricScaleVerified=true;},d=>{delete d.claims.completeObjectVerified;},d=>{d.extra='x';},d=>{d.objects[0].indices=[0,0];},d=>{d.objects[0].pivot=[100,0,0];},d=>{d.instances[0].translation=[null,0,0];},d=>{d.instances[0].objectId='object-999999';},d=>{d.nextObject=1;},d=>{d.instances.push({...d.instances[0]});},d=>{d.objects=Array(33).fill(d.objects[0]);},d=>{d.instances=Array(65).fill(d.instances[0]);},d=>{d.variation={seed:0,index:2,count:1,translationRange:[0,0,0],yawRangeDegrees:0,algorithm:'mulberry32-v1',baseRevision:1};}];
  for(const alter of invalid){const d=JSON.parse(serialized);alter(d);assert.throws(()=>parseObjectDocument(ctx,JSON.stringify(d)));}
  assert.throws(()=>parseObjectDocument(ctx,' '.repeat(OBJECTIFY_LIMITS.jsonBytes+1)),/4 MiB/);
  assert.throws(()=>parseObjectDocument(ctx,'💡'.repeat(OBJECTIFY_LIMITS.jsonBytes/2)),/4 MiB/);
  assert.throws(()=>parseObjectDocument(ctx,'{"bad":'),/not valid JSON/);
  assert.equal(serializeObjectDocument(ctx,document),serialized);
});

test('context rejects ambiguous source membership, old parser and unnormalized covariance rotations',async()=>{
  await assert.rejects(context({sourceIndices:Uint32Array.from([2,5,5,11])}),/unique, increasing/);
  await assert.rejects(context({sourceIndices:Uint32Array.from([2,5,8])}),/match every/);
  await assert.rejects(context({parserVersion:'visual-geometry-v1'}),/visual-geometry-v2/);
  await assert.rejects(context({sourceIndices:Uint32Array.from([2,5,8,11]),total:11}),/within the source/);
  const points=fixture();points[13]=2;await assert.rejects(context({points}),/normalized/);
  await assert.rejects(context({displayTransform:'flip-y'}),/Unsupported display/);
});

test('poses outside parser coordinate range fail atomically before compose, including hidden poses',async()=>{
  const points=fixture();points[0]=1e7;points[STRIDE]=1e7;const ctx=await context({points}),{document,id}=group(ctx);
  for(const hidden of [false,true])assert.throws(()=>updateObject(ctx,document,id,{hidden,translation:[1,0,0]}),/coordinate range/);
  assert.deepEqual(document.instances[0].translation,[0,0,0]);
});

test('point-cloud export remains plain XYZ/RGB with actual vertex and instance provenance, byte-bound receipt and no physics claims',async()=>{
  const ctx=await context({kind:'point-cloud'}),{document,id}=group(ctx),posed=updateObject(ctx,document,id,{translation:[0,1,0]});
  const exported=await exportObjectVariant(ctx,posed),parsed=parsePLY(exported.buffer),h=header(exported.buffer),offset=payloadOffset(exported.buffer),view=new DataView(exported.buffer);
  assert.match(h,/format binary_little_endian/);assert.doesNotMatch(h,/property float scale_0/);assert.equal(parsed.kind,'point-cloud');
  assert.match(h,new RegExp(`brainsnn_parent_sha256 ${source.sha256}`));assert.match(h,new RegExp(`brainsnn_edit_manifest_sha256 ${exported.receipt.editManifestSha256}`));
  assert.equal(exported.buffer.byteLength,offset+4*23);assert.equal(view.getUint32(offset+15,true),2);assert.equal(view.getUint32(offset+19,true),1);assert.equal(view.getUint32(offset+2*23+19,true),0);
  assert.equal(exported.receipt.variantArtifact.sha256,await objectifySha256(exported.buffer));assert.equal(exported.receipt.editManifestSha256,await objectifySha256(exported.manifestText));
  assert.equal(exported.receipt.originalSourcePreserved,true);assert.equal(exported.receipt.sourceGeometryChanged,true);assert.equal(exported.receipt.metricScaleVerified,false);assert.equal(exported.receipt.physicalRobotValidated,false);
  assert.equal(exported.receipt.objects[0].proxy.validated,false);assert.deepEqual(exported.receipt.objects[0].physicalProperties,{mass:null,friction:null,inertia:null});assert.equal(exported.receipt.objects[0].bimClass,null);
  assert.equal(exported.receipt.variantArtifact.format,'point-cloud-ply');
  const rendered=composeObjectDocument(ctx,posed).points;for(let i=0;i<4;i++){assert.deepEqual(xyz(parsed.points,i),xyz(rendered,i));for(let j=6;j<9;j++)near(parsed.points[i*STRIDE+j],rendered[i*STRIDE+j],1/255);}
});

test('Gaussian export round-trips rotated anisotropic scales, DC appearance, opacity and WXYZ rotations as binary PLY',async()=>{
  const points=fixture();points.set([.1,.2,.9,Math.sqrt(.14)],10);const norm=Math.hypot(...points.subarray(10,14));for(let j=10;j<14;j++)points[j]/=norm;
  const ctx=await context({points}),{document,id}=group(ctx),posed=updateObject(ctx,document,id,{yawDegrees:37,translation:[.5,-.5,2]});
  const result=await exportObjectVariant(ctx,posed),parsed=parsePLY(result.buffer),rendered=composeObjectDocument(ctx,posed).points,h=header(result.buffer),offset=payloadOffset(result.buffer),view=new DataView(result.buffer);
  assert.equal(parsed.kind,'gaussian-splat');assert.equal(result.buffer.byteLength,offset+4*64);assert.equal(result.receipt.higherOrderShPreserved,false);assert.match(h,/no higher-order SH/);
  for(let i=0;i<rendered.length;i++){const component=i%STRIDE;near(parsed.points[i],rendered[i],component>=3&&component<=5?rendered[i]*1e-6:1e-6);}
  near(view.getFloat32(offset+10*4,true),rendered[13]);near(view.getFloat32(offset+11*4,true),rendered[10]);
  assert.equal(view.getUint32(offset+56,true),2);assert.equal(view.getUint32(offset+60,true),1);
  const again=await exportObjectVariant(ctx,posed);assert.deepEqual(Buffer.from(result.buffer),Buffer.from(again.buffer));assert.deepEqual(result.receipt,again.receipt);
  assert.equal(result.receipt.variantArtifact.sha256,await objectifySha256(result.buffer));
});

test('Gaussian PLY boundary scales survive re-import; valid SPLAT scales outside that range fail clearly instead of truncating covariance',async()=>{
  for(const scale of [1e-8,10000]){
    const raw=new ArrayBuffer(32),view=new DataView(raw);[0,0,0,scale,scale,scale].forEach((v,i)=>view.setFloat32(i*4,v,true));new Uint8Array(raw).set([128,128,128,255,255,128,128,128],24);
    const parsed=parseSplat(raw),ctx=await context({...parsed,sourceIndices:parsed.sourceIndices,total:parsed.total});
    assert.equal(parsed.points[3],Math.fround(scale));await assert.rejects(exportObjectVariant(ctx,createObjectDocument(ctx)),/scales outside the supported PLY preview range/);
    assert.ok(serializeObjectDocument(ctx,createObjectDocument(ctx)).includes('previewSha256'));
  }
  const points=fixture(2);points.fill(Math.fround(Math.exp(-12)),3,6);points.fill(Math.fround(Math.exp(8)),STRIDE+3,STRIDE+6);
  points[9]=0;points[STRIDE+9]=1;const ctx=await context({points}),result=await exportObjectVariant(ctx,createObjectDocument(ctx)),parsed=parsePLY(result.buffer);
  assert.deepEqual([...parsed.points.subarray(3,6)],[...points.subarray(3,6)]);assert.deepEqual([...parsed.points.subarray(STRIDE+3,STRIDE+6)],[...points.subarray(STRIDE+3,STRIDE+6)]);
  near(parsed.points[9],0,3e-9);near(parsed.points[STRIDE+9],1,3e-9);
});

test('all-hidden export is refused and hidden proxy receipts explicitly identify conservative bounds',async()=>{
  const ctx=await context(),{document,id}=group(ctx,{indices:[0,1,2,3]});const hidden=updateObject(ctx,document,id,{hidden:true});
  await assert.rejects(exportObjectVariant(ctx,hidden),/no visible samples/);
  const partial=group(ctx,{indices:[0]}),withHidden=updateObject(ctx,partial.document,partial.id,{hidden:true,yawDegrees:45}),result=await exportObjectVariant(ctx,withHidden);
  assert.equal(result.receipt.objects[0].visible,false);assert.equal(result.receipt.objects[0].proxy.kind,'conservative-transformed-base-AABB-proposal');
  assert.equal(result.receipt.backgroundCompletion,'unknown-no-inpainting');
});
