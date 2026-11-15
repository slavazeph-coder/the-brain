/** Reviewed appearance subsets and derived variants. No BIM, metric or collision qualification is performed. */
import { bounds, STRIDE, MAX_POINTS } from './visual-geometry.mjs';

export const OBJECTIFY_LIMITS = Object.freeze({objects:32,instances:64,points:MAX_POINTS,jsonBytes:4*1024**2,variants:16});
const SCHEMA='brainsnn.appearance-objects.v1', CONTEXTS=new WeakMap(), C0=.28209479177387814;
const CLAIMS=Object.freeze({automaticSegmentationExecuted:false,completeObjectVerified:false,metricScaleVerified:false,
  physicalAccuracyVerified:false,collisionProxyValidated:false,physicalRobotValidated:false,higherOrderShPreserved:false});
const fail=message=>{throw Error(message);};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed,label)=>{if(!object(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail(`Unsupported ${label} fields.`);};
const integer=(value,min,max,label)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(`Invalid ${label}.`);return value;};
const text=(value,max,label)=>{if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f\u007f]/u.test(value))fail(`Invalid ${label}.`);return value;};
const vector=(value,label,limit=1e6)=>{if(!Array.isArray(value)||value.length!==3||value.some(n=>!Number.isFinite(n)||Math.abs(n)>limit))fail(`Use three finite ${label} values within ±${limit}.`);return value.map(n=>n===0?0:n);};
const copied=value=>structuredClone(value);
const yaw=value=>{if(!Number.isFinite(value)||Math.abs(value)>36000)fail('Use a finite yaw within ±36000 degrees.');return ((value%360)+540)%360-180;};
const identity=instance=>!instance.hidden&&instance.yawDegrees===0&&instance.translation.every(n=>n===0);
const id=(prefix,n)=>`${prefix}-${String(n).padStart(6,'0')}`;
const idNumber=(value,prefix)=>{if(typeof value!=='string'||!new RegExp(`^${prefix}-[0-9]{6}$`).test(value))fail(`Invalid ${prefix} ID.`);return Number(value.slice(prefix.length+1));};
const bool=(value,label)=>{if(typeof value!=='boolean')fail(`Invalid ${label}.`);return value;};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function data(context){const d=CONTEXTS.get(context);if(!d)fail('Open a local appearance asset first.');return d;}
export async function objectifySha256(value){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
function canonicalFloats(points){const bytes=new Uint8Array(points.length*4),view=new DataView(bytes.buffer);for(let i=0;i<points.length;i++)view.setFloat32(i*4,points[i],true);return bytes;}
function canonicalIndices(indices){const bytes=new Uint8Array(indices.length*4),view=new DataView(bytes.buffer);for(let i=0;i<indices.length;i++)view.setUint32(i*4,indices[i],true);return bytes;}
function sampleBounds(points,indices){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const index of indices)for(let j=0;j<3;j++){const v=points[index*STRIDE+j];min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);}
  const center=min.map((n,i)=>(n+max[i])/2),size=min.map((n,i)=>max[i]-n);
  return {min,max,center,size};
}
function finishedBounds(min,max){return {min,max,center:min.map((v,i)=>(v+max[i])/2),size:min.map((v,i)=>max[i]-v)};}
function poseTerms(group,instance){const a=instance.yawDegrees*Math.PI/180;return {group,instance,c:Math.cos(a),s:Math.sin(a),ch:Math.cos(a/2),sh:Math.sin(a/2)};}
function positioned(x,y,z,pose){const {group,instance,c,s}=pose,dx=x-group.pivot[0],dz=z-group.pivot[2];
  return [Math.fround(group.pivot[0]+c*dx+s*dz+instance.translation[0]),Math.fround(y+instance.translation[1]),Math.fround(group.pivot[2]-s*dx+c*dz+instance.translation[2])];}
// Eight corners bound a rigidly transformed base AABB without visiting every hidden sample.
function conservativeBounds(base,pose){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let corner=0;corner<8;corner++){const xyz=positioned(...base.min.map((v,i)=>corner&(1<<i)?base.max[i]:v),pose);
    for(let j=0;j<3;j++){min[j]=Math.min(min[j],xyz[j]);max[j]=Math.max(max[j],xyz[j]);}}
  return finishedBounds(min,max);
}

/** Copies and privately retains the exact bounded parser preview and its original vertex identifiers. */
export async function createObjectifyContext({source,points,sourceIndices,kind,total,sampled,skipped=0,displayTransform='identity',parserVersion='visual-geometry-v2'}={}){
  keys(source,['name','bytes','sha256'],'source');
  text(source.name,256,'source filename');integer(source.bytes,1,64*1024**2,'source byte count');
  if(typeof source.sha256!=='string'||!/^[a-f0-9]{64}$/u.test(source.sha256))fail('Use the original source SHA-256.');
  if(!['point-cloud','gaussian-splat'].includes(kind))fail('Use a parsed point cloud or Gaussian asset.');
  if(!['identity','flip-y-z'].includes(displayTransform))fail('Unsupported display orientation.');
  if(parserVersion!=='visual-geometry-v2')fail('Use the parser with original source vertex IDs, visual-geometry-v2.');
  bounds(points);const base=points.slice(),count=base.length/STRIDE;
  if(!(sourceIndices instanceof Uint32Array)||sourceIndices.length!==count)fail('Original source vertex IDs must match every retained sample.');
  const ids=sourceIndices.slice();total??=count;integer(total,count,10000000,'source point count');integer(skipped,0,total,'omitted sample count');
  if(sampled!==undefined&&typeof sampled!=='boolean')fail('Invalid preview sampling flag.');
  for(let i=0;i<ids.length;i++){if(ids[i]>=total||(i&&ids[i]<=ids[i-1]))fail('Source vertex IDs must be unique, increasing and within the source.');
    if(Math.abs(Math.hypot(...base.subarray(i*STRIDE+10,i*STRIDE+14))-1)>1e-4)fail('Parsed Gaussian rotations must be normalized.');}
  const binding={name:source.name,bytes:source.bytes,sha256:source.sha256,kind,parserVersion,
    indexSpace:'retained-preview-v1',displayTransform,total,retained:count,sampled:sampled??total>count,skipped,
    previewSha256:await objectifySha256(canonicalFloats(base)),sourceIndicesSha256:await objectifySha256(canonicalIndices(ids))};
  const b=sampleBounds(base,Array.from({length:count},(_,i)=>i));
  const context=Object.freeze({source:freeze(copied(binding)),kind,pointCount:count,bounds:freeze(b)});
  CONTEXTS.set(context,{base,ids,binding});return context;
}
export function getObjectifyBase(context){const d=data(context);return {points:d.base.slice(),sourceIndices:d.ids.slice()};}
export function createObjectDocument(context){data(context);return {schema:SCHEMA,source:copied(context.source),revision:0,nextObject:1,nextInstance:1,objects:[],instances:[],variation:null,claims:{...CLAIMS}};}
export const resetObjectDocument=createObjectDocument;

function mask(indices,count){
  if(!Array.isArray(indices)&&!(indices instanceof Uint32Array))fail('Select retained preview samples first.');
  if(!indices.length||indices.length>count)fail('An object needs a non-empty bounded selection.');
  const result=Array.from(indices);for(const i of result)integer(i,0,count-1,'selected sample index');
  result.sort((a,b)=>a-b);for(let i=1;i<result.length;i++)if(result[i]===result[i-1])fail('Object selections cannot repeat samples.');return result;
}
/** Validates untrusted documents against one immutable preview before composing or applying changes. */
export function validateObjectDocument(context,value){
  const d=data(context);keys(value,['schema','source','revision','nextObject','nextInstance','objects','instances','variation','claims'],'object document');
  if(value.schema!==SCHEMA)fail('Use a BrainSNN appearance object document, version 1.');
  keys(value.source,Object.keys(d.binding),'source binding');
  if(Object.keys(d.binding).some(k=>value.source[k]!==d.binding[k]))fail('The object document belongs to a different source, parser preview or display orientation.');
  keys(value.claims,Object.keys(CLAIMS),'qualification');
  if(Object.keys(CLAIMS).some(k=>value.claims[k]!==false))fail('Appearance objects cannot claim verified segmentation, scale, physics, collision or robot validation.');
  integer(value.revision,0,999999,'edit revision');integer(value.nextObject,1,999999,'next object ID');integer(value.nextInstance,1,999999,'next instance ID');
  if(!Array.isArray(value.objects)||value.objects.length>OBJECTIFY_LIMITS.objects||!Array.isArray(value.instances)||value.instances.length>OBJECTIFY_LIMITS.instances)fail('Use at most 32 objects and 64 instances.');
  const owners=new Uint8Array(context.pointCount),objects=[],objectIds=new Set(),baseBounds=new Map();let maxObject=0;
  for(const o of value.objects){
    keys(o,['id','name','indices','reviewed','pivot'],'object');const n=idNumber(o.id,'object');if(!n||objectIds.has(o.id))fail('Object IDs must be unique.');maxObject=Math.max(maxObject,n);objectIds.add(o.id);
    const indices=mask(o.indices,context.pointCount);for(const i of indices){if(owners[i])fail('Base object selections must not overlap.');owners[i]=1;}
    const b=sampleBounds(d.base,indices),pivot=b.center;baseBounds.set(o.id,b);
    if(!Array.isArray(o.pivot)||o.pivot.length!==3||o.pivot.some((v,i)=>v!==pivot[i]))fail('Object pivot must match its original selection centre.');
    objects.push({id:o.id,name:text(o.name,120,'object name'),indices,reviewed:bool(o.reviewed,'selection review'),pivot});
  }
  const instances=[],instanceIds=new Set(),primaries=new Map();let maxInstance=0,visible=context.pointCount-owners.reduce((n,v)=>n+v,0);
  for(const p of value.instances){
    keys(p,['id','objectId','translation','yawDegrees','hidden','primary'],'instance');const n=idNumber(p.id,'instance');if(!n||instanceIds.has(p.id))fail('Instance IDs must be unique.');maxInstance=Math.max(maxInstance,n);instanceIds.add(p.id);
    const o=objects.find(o=>o.id===p.objectId);if(!o)fail('Every instance needs an existing object.');
    const instance={id:p.id,objectId:o.id,translation:vector(p.translation,'translation'),yawDegrees:yaw(p.yawDegrees),hidden:bool(p.hidden,'visibility'),primary:bool(p.primary,'primary instance')};
    const extent=conservativeBounds(baseBounds.get(o.id),poseTerms(o,instance));
    if([...extent.min,...extent.max].some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))fail('This pose exceeds the supported coordinate range. Reduce the translation or yaw.');
    if(instance.primary){if(primaries.has(o.id))fail('Every object needs exactly one primary instance.');primaries.set(o.id,instance.id);}
    if(!o.reviewed&&(!identity(instance)||!instance.primary))fail('Review the selected object before moving, hiding or duplicating it.');
    if(!instance.hidden)visible+=o.indices.length;instances.push(instance);
  }
  if(objects.some(o=>!primaries.has(o.id)))fail('Every object needs exactly one primary instance.');
  if(value.nextObject<=maxObject||value.nextInstance<=maxInstance)fail('Object counters must follow all existing IDs.');
  if(visible>OBJECTIFY_LIMITS.points)fail('This variant exceeds the 100,000 visible-sample budget. Hide an instance or use a smaller source.');
  let variation=null;
  if(value.variation!==undefined&&value.variation!==null){const v=value.variation;keys(v,['seed','index','count','translationRange','yawRangeDegrees','algorithm','baseRevision'],'variation');
    integer(v.seed,0,0xffffffff,'variation seed');integer(v.count,1,16,'variation count');integer(v.index,0,v.count-1,'variation index');integer(v.baseRevision,0,value.revision,'base revision');
    const range=vector(v.translationRange,'variation range');if(range.some(n=>n<0)||v.algorithm!=='mulberry32-v1'||!Number.isFinite(v.yawRangeDegrees)||v.yawRangeDegrees<0||v.yawRangeDegrees>180)fail('Invalid seeded variation metadata.');
    variation={seed:v.seed,index:v.index,count:v.count,translationRange:range,yawRangeDegrees:v.yawRangeDegrees,algorithm:v.algorithm,baseRevision:v.baseRevision};}
  return {schema:SCHEMA,source:copied(d.binding),revision:value.revision,nextObject:value.nextObject,nextInstance:value.nextInstance,objects,instances,variation,claims:{...CLAIMS}};
}
function edited(context,doc,change){const next=validateObjectDocument(context,doc);if(next.revision>=999999)fail('Start a fresh object document after this many edits.');next.variation=null;change(next);next.revision++;return validateObjectDocument(context,next);}
function selection(doc,value){const instance=doc.instances.find(p=>p.id===value)||doc.instances.find(p=>p.objectId===value&&p.primary);if(!instance)fail('Select an existing object instance.');return {instance,group:doc.objects.find(o=>o.id===instance.objectId)};}
export function addObject(context,doc,{name='Object',indices,reviewed=false}={}){
  let objectId;
  const document=edited(context,doc,next=>{if(next.objects.length>=32)fail('Use at most 32 reviewed object groups.');
    const chosen=mask(indices,context.pointCount);objectId=id('object',next.nextObject++);
    next.objects.push({id:objectId,name,indices:chosen,reviewed,pivot:sampleBounds(data(context).base,chosen).center});
    next.instances.push({id:id('instance',next.nextInstance++),objectId,translation:[0,0,0],yawDegrees:0,hidden:false,primary:true});});
  return {document,id:objectId};
}
export function updateObject(context,doc,value,patch={}){
  keys(patch,['name','reviewed','translation','yawDegrees','hidden'],'object update');
  return edited(context,doc,next=>{const {instance,group}=selection(next,value);
    if(patch.name!==undefined)group.name=patch.name;if(patch.reviewed!==undefined)group.reviewed=patch.reviewed;
    for(const key of ['translation','yawDegrees','hidden'])if(patch[key]!==undefined)instance[key]=copied(patch[key]);});
}
export function duplicateObject(context,doc,value,patch={}){
  keys(patch,['translation','yawDegrees','hidden'],'duplicate pose');let instanceId;
  const document=edited(context,doc,next=>{const {instance,group}=selection(next,value);if(!group.reviewed)fail('Review the selected object before duplicating it.');
    instanceId=id('instance',next.nextInstance++);next.instances.push({...copied(instance),...copied(patch),id:instanceId,primary:false});});
  return {document,id:instanceId};
}
export function removeObject(context,doc,value){return edited(context,doc,next=>{
  const group=next.objects.find(o=>o.id===value);if(group){next.objects=next.objects.filter(o=>o.id!==value);next.instances=next.instances.filter(p=>p.objectId!==value);return;}
  const {instance}=selection(next,value);if(instance.primary)fail('Remove the object group to restore its original samples, or hide this primary instance.');next.instances=next.instances.filter(p=>p.id!==value);
});}
export function composeObjectDocument(context,value){
  const doc=validateObjectDocument(context,value),d=data(context),owner=new Int16Array(context.pointCount).fill(-1);
  doc.objects.forEach((o,i)=>o.indices.forEach(n=>{owner[n]=i;}));
  const groups=new Map(doc.objects.map(o=>[o.id,o])),baseBounds=new Map(doc.objects.map(o=>[o.id,sampleBounds(d.base,o.indices)]));
  const poses=new Map(doc.instances.map((instance,index)=>[instance.id,{...poseTerms(groups.get(instance.objectId),instance),tag:index+1,min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}]));
  const primaries=new Map(doc.instances.filter(p=>p.primary).map(p=>[p.objectId,p]));
  const owned=doc.objects.reduce((n,o)=>n+o.indices.length,0),visible=context.pointCount-owned+doc.instances.reduce((n,p)=>n+(p.hidden?0:groups.get(p.objectId).indices.length),0);
  const points=new Float32Array(visible*STRIDE),sourceIndices=new Uint32Array(visible),previewIndices=new Uint32Array(visible),instanceIds=new Uint32Array(visible);
  let cursor=0,backgroundPoints=0,boundsPointEvaluations=0;
  function append(index,instance){const at=cursor*STRIDE,from=index*STRIDE;points.set(d.base.subarray(from,from+STRIDE),at);
    if(instance){const pose=poses.get(instance.id),{sh,ch}=pose;
      if(!identity(instance))points.set(positioned(d.base[from],d.base[from+1],d.base[from+2],pose),at);
      if(instance.yawDegrees!==0){
        const qx=d.base[from+10],qy=d.base[from+11],qz=d.base[from+12],qw=d.base[from+13];
        const x=ch*qx+sh*qz,y=ch*qy+sh*qw,z=ch*qz-sh*qx,w=ch*qw-sh*qy,norm=Math.hypot(x,y,z,w);
        points[at+10]=x/norm;points[at+11]=y/norm;points[at+12]=z/norm;points[at+13]=w/norm;}
      for(let j=0;j<3;j++){pose.min[j]=Math.min(pose.min[j],points[at+j]);pose.max[j]=Math.max(pose.max[j],points[at+j]);}
      boundsPointEvaluations++;instanceIds[cursor]=pose.tag;
    }
    sourceIndices[cursor]=d.ids[index];previewIndices[cursor]=index;cursor++;
  }
  for(let i=0;i<context.pointCount;i++){if(owner[i]<0){append(i,null);backgroundPoints++;}else{const instance=primaries.get(doc.objects[owner[i]].id);if(!instance.hidden)append(i,instance);}}
  for(const instance of doc.instances)if(!instance.primary&&!instance.hidden)for(const i of groups.get(instance.objectId).indices)append(i,instance);
  if(points.length)bounds(points);
  const objects=doc.instances.map((instance,index)=>{const group=groups.get(instance.objectId),pose=poses.get(instance.id);
    const b=instance.hidden?conservativeBounds(baseBounds.get(group.id),pose):finishedBounds(pose.min,pose.max);
    return {...copied(instance),tag:index+1,name:group.name,reviewed:group.reviewed,pivot:group.pivot.slice(),bounds:b,boundsKind:instance.hidden?'conservative-transformed-base-AABB':'sample-centre-AABB',pointCount:group.indices.length};});
  return {points,sourceIndices,previewIndices,instanceIds,objects,
    stats:{sourcePoints:context.pointCount,visiblePoints:visible,objectCount:doc.objects.length,instanceCount:doc.instances.length,backgroundPoints,boundsPointEvaluations,
      hiddenBoundsCornerEvaluations:doc.instances.filter(p=>p.hidden).length*8,hiddenInstances:doc.instances.filter(p=>p.hidden).length,hasEdits:doc.instances.some(p=>!p.primary||!identity(p))}};
}
export function serializeObjectDocument(context,value){return JSON.stringify(validateObjectDocument(context,value),null,2)+'\n';}
export function parseObjectDocument(context,text){
  if(typeof text!=='string'||text.length>OBJECTIFY_LIMITS.jsonBytes||new TextEncoder().encode(text).byteLength>OBJECTIFY_LIMITS.jsonBytes)fail('Object JSON must be no larger than 4 MiB.');
  let value;try{value=JSON.parse(text);}catch{fail('Object document is not valid JSON.');}return validateObjectDocument(context,value);
}
export function seededObjectVariants(context,value,{seed=1,count=4,translationRange=[.25,0,.25],yawRangeDegrees=15}={}){
  const doc=validateObjectDocument(context,value);integer(seed,0,0xffffffff,'variation seed');integer(count,1,16,'variation count');
  const range=vector(translationRange,'variation range');if(range.some(n=>n<0)||!Number.isFinite(yawRangeDegrees)||yawRangeDegrees<0||yawRangeDegrees>180)fail('Use non-negative translation ranges and yaw range up to 180 degrees.');
  if(!doc.objects.some(o=>o.reviewed))fail('Review an object before generating layout variations.');
  let state=seed>>>0;const random=()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  return Array.from({length:count},(_,index)=>edited(context,doc,next=>{for(const instance of next.instances){const group=next.objects.find(o=>o.id===instance.objectId);if(!group.reviewed||instance.hidden)continue;instance.translation=instance.translation.map((n,i)=>n+(random()*2-1)*range[i]);instance.yawDegrees=yaw(instance.yawDegrees+(random()*2-1)*yawRangeDegrees);}
    next.variation={seed,index,count,translationRange:range.slice(),yawRangeDegrees,algorithm:'mulberry32-v1',baseRevision:doc.revision};}));
}

/** Writes an explicitly lossy retained-preview PLY, never overwrites or claims fidelity to the full source. */
export async function exportObjectVariant(context,value){
  const doc=validateObjectDocument(context,value),composed=composeObjectDocument(context,doc);if(!composed.stats.visiblePoints)fail('This variant has no visible samples to export.');
  const manifestText=serializeObjectDocument(context,doc),manifestSha256=await objectifySha256(manifestText),gaussian=context.kind==='gaussian-splat';
  // The current PLY preview parser clamps log-scales to [-12, 8]. Refuse unsupported
  // SPLAT scales instead of silently changing covariance when this file is reopened.
  if(gaussian){const minimum=Math.fround(Math.exp(-12)),maximum=Math.fround(Math.exp(8));
    for(let i=0;i<composed.points.length;i+=STRIDE)for(let j=3;j<6;j++)if(composed.points[i+j]<minimum||composed.points[i+j]>maximum)fail('Gaussian scales outside the supported PLY preview range exp(-12)..exp(8). Keep the original source and export the edit manifest instead.');}
  const floats=gaussian?['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']:['x','y','z'];
  const properties=[...floats.map(n=>`property float ${n}`),...(!gaussian?['red','green','blue'].map(n=>`property uchar ${n}`):[]),'property uint source_index','property uint object_instance'];
  const header=new TextEncoder().encode(['ply','format binary_little_endian 1.0','comment BrainSNN authored derived retained-preview appearance; arbitrary units',
    `comment brainsnn_parent_sha256 ${context.source.sha256}`,`comment brainsnn_edit_manifest_sha256 ${manifestSha256}`,
    'comment no higher-order SH; no unseen-surface completion; no collision or metric certification',`element vertex ${composed.stats.visiblePoints}`,...properties,'end_header',''].join('\n'));
  const stride=gaussian?64:23,buffer=new ArrayBuffer(header.byteLength+stride*composed.stats.visiblePoints),bytes=new Uint8Array(buffer),view=new DataView(buffer);bytes.set(header);
  for(let i=0;i<composed.stats.visiblePoints;i++){
    const row=composed.points.subarray(i*STRIDE,(i+1)*STRIDE),at=header.byteLength+i*stride;
    let values=Array.from(row.subarray(0,3));
    if(gaussian){const alpha=Math.max(1e-9,Math.min(1-1e-9,row[9])),q=Array.from(row.subarray(10,14)),norm=Math.hypot(...q);
      values.push(...Array.from(row.subarray(6,9),n=>(n-.5)/C0),Math.log(alpha/(1-alpha)),...Array.from(row.subarray(3,6),n=>Math.log(n)),q[3]/norm,q[0]/norm,q[1]/norm,q[2]/norm);}
    values.forEach((n,j)=>view.setFloat32(at+j*4,n,true));let offset=values.length*4;
    if(!gaussian){for(let j=0;j<3;j++)view.setUint8(at+offset+j,Math.round(row[6+j]*255));offset+=3;}
    view.setUint32(at+offset,composed.sourceIndices[i],true);view.setUint32(at+offset+4,composed.instanceIds[i],true);
  }
  const artifact={name:'authored-variant.ply',format:gaussian?'gaussian-ply-dc-preview':'point-cloud-ply',bytes:buffer.byteLength,sha256:await objectifySha256(buffer),pointCount:composed.stats.visiblePoints};
  const receipt={schema:'brainsnn.appearance-variant-receipt.v1',source:copied(context.source),editManifestSha256:manifestSha256,variantArtifact:artifact,
    revision:doc.revision,variation:copied(doc.variation),provenance:'authored-variant',originalSourcePreserved:true,sourceGeometryChanged:true,units:'arbitrary',coordinateFrame:'right-handed-y-up',
    backgroundCompletion:'unknown-no-inpainting',...CLAIMS,
    objects:composed.objects.map(o=>({instanceId:o.id,objectId:o.objectId,name:o.name,reviewedSelection:o.reviewed,visible:!o.hidden,pointCount:o.pointCount,
      translation:o.translation,yawDegrees:o.yawDegrees,proposedBounds:o.bounds,proxy:{kind:o.hidden?'conservative-transformed-base-AABB-proposal':'sample-centre-AABB-proposal',validated:false,includesGaussianTails:false},
      physicalProperties:{mass:null,friction:null,inertia:null},bimClass:null})),
    limitations:['Membership identifies retained preview samples, not independently verified complete objects.','The preview may be sampled and omit invalid source rows.',
      'Gaussian export retains normalized DC appearance and covariance parameters only; higher-order SH is omitted and no relighting is performed.',
      'Moving or hiding samples exposes unknown uncaptured space. No inpainting or physical collision reconstruction is performed.',
      'Bounds are sample-centre proposals in arbitrary units, not certified collision meshes, BIM components or independently measured dimensions.',
      'Appearance changes do not update IFC, occupancy, robot routes or the original source asset.']};
  return {buffer,receipt,manifest:doc,manifestText,name:artifact.name,kind:context.kind};
}
