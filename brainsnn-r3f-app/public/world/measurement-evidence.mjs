/** Local human evidence only. No operation changes geometry or planning review flags. */
import {normalizeWorld} from './core.mjs';

export const EVIDENCE_SCHEMA='brainsnn.world.geometry-evidence.v1';
export const EVIDENCE_LIMITS=Object.freeze({bytes:256*1024,measurements:64,reviews:132});
const sessions=new WeakSet(), SHA=/^[a-f0-9]{64}$/;
const reasons=['geometry-edited','map-replaced','session-cleared'];
const copy=value=>JSON.parse(JSON.stringify(value));
function fail(message){throw new Error(message);}
function exact(value,keys,name){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(`Invalid ${name} fields.`);}
function text(value,max,name,empty=false){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))fail(`Enter ${name} (${max} characters maximum).`);return value;}
function number(value,min,max,name){if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${name} must be between ${min} and ${max}.`);return value;}
function size(value){if(new TextEncoder().encode(JSON.stringify(value)).byteLength>EVIDENCE_LIMITS.bytes)fail('Geometry evidence exceeds 256 KiB.');}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function document(session,binding){return {schema:EVIDENCE_SCHEMA,authority:'self-reported-unverified',metricVerified:false,certified:false,geometry:copy(session.geometry),binding,origin:session.origin,measurements:copy(session.measurements),reviews:copy(session.reviews)};}
function register(value){
  // Reserve the complete wire format, including a later stale/imported binding.
  size(document({...value,origin:'imported'},{status:'imported',currentGeometrySha256:'0'.repeat(64),reason:'geometry-edited'}));
  freeze(value);sessions.add(value);return value;
}
function known(value){if(!sessions.has(value))fail('Start or import a geometry worksheet first.');}
async function sha(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}

/** Fixed field order, normalized metres, sorted object IDs. Names/notes/review flags are not geometry. */
export function geometrySnapshot(input){
  const w=normalizeWorld(input);
  return {schema:w.schema,units:'m',provenance:w.provenance,sourceKind:w.geometrySource?.kind||'manual',width:w.width,depth:w.depth,
    floor:w.floor||[[0,0],[w.width,0],[w.width,w.depth],[0,w.depth]],start:w.start,
    objects:w.objects.map(({id,x,z,w,d,h,kind})=>({id,x,z,w,d,h,kind})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
}
function checkedSnapshot(value){
  exact(value,['schema','units','provenance','sourceKind','width','depth','floor','start','objects'],'geometry snapshot');
  if(value.units!=='m')fail('Map geometry must use metres.');
  text(value.sourceKind,160,'geometry source');
  if(!Array.isArray(value.objects))fail('Invalid geometry objects.');
  if(!Array.isArray(value.floor)||value.floor.some(p=>!Array.isArray(p)||p.length!==2))fail('Invalid floor coordinates.');
  value.objects.forEach(o=>exact(o,['id','x','z','w','d','h','kind'],'geometry object'));
  exact(value.start,['x','z'],'start');
  const normalized=geometrySnapshot({...value,geometrySource:{kind:value.sourceKind}});
  // Compare by fixed canonical construction after validation, not incoming JSON key order.
  if(value.provenance!==normalized.provenance||value.objects.some(o=>!['obstacle','unknown','no-go'].includes(o.kind)))fail('Invalid geometry provenance or object kind.');
  if(value.sourceKind!==normalized.sourceKind||value.objects.some(o=>!normalized.objects.some(n=>n.id===o.id)))fail('Geometry identifiers must already be normalized.');
  return normalized;
}
export async function geometrySHA256(world){return sha(geometrySnapshot(world));}
export function evidenceBinding(session,world){
  known(session);
  if(session.origin==='imported')return 'imported';
  if(session.invalidatedReason||!world)return 'stale';
  return JSON.stringify(geometrySnapshot(world))===JSON.stringify(session.geometry.snapshot)?'current':'stale';
}
export async function createGeometryEvidence(world){
  const snapshot=geometrySnapshot(world);
  return register({geometry:{sha256:await sha(snapshot),snapshot},origin:'local',invalidatedReason:null,measurements:[],reviews:[]});
}
export function invalidateGeometryEvidence(session,reason='geometry-edited'){
  known(session);if(!reasons.includes(reason))fail('Unknown evidence invalidation reason.');
  return register({...session,invalidatedReason:session.invalidatedReason||reason});
}
function editable(session,world){known(session);if(evidenceBinding(session,world)!=='current')fail('This worksheet is stale or imported. Export it, then start a worksheet for the current map.');}
function endpoint(value,snapshot){if(!Array.isArray(value)||value.length!==2)fail('Use two map coordinates per endpoint.');return [number(value[0],0,snapshot.width,'Endpoint X'),number(value[1],0,snapshot.depth,'Endpoint Z')];}
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('Enter a valid measurement date.');return value;}
function checkedMeasurement(value,snapshot){
  exact(value,['id','label','from','to','distanceMeters','uncertaintyMeters','method','instrument','measuredOn','note'],'measurement');
  if(!/^m-[a-zA-Z0-9-]{1,64}$/.test(value.id))fail('Invalid measurement ID.');
  const from=endpoint(value.from,snapshot),to=endpoint(value.to,snapshot);
  if(Math.hypot(to[0]-from[0],to[1]-from[1])<.001)fail('Measurement endpoints must be distinct.');
  if(!['tape','laser','manual-reference'].includes(value.method))fail('Choose a measurement method.');
  return {id:value.id,label:text(value.label,120,'measurement label'),from,to,distanceMeters:number(value.distanceMeters,.001,200,'Measured metres'),uncertaintyMeters:number(value.uncertaintyMeters,0,10,'Uncertainty in metres'),method:value.method,instrument:text(value.instrument,120,'instrument or reference'),measuredOn:date(value.measuredOn),note:text(value.note,600,'measurement note',true)};
}
export function measurementComparison(measurement){const mapDistanceMeters=Math.hypot(measurement.to[0]-measurement.from[0],measurement.to[1]-measurement.from[1]);return {mapDistanceMeters,discrepancyMeters:measurement.distanceMeters-mapDistanceMeters};}
export function addMeasurement(session,input,world){
  editable(session,world);
  if(session.measurements.length>=EVIDENCE_LIMITS.measurements)fail('Use at most 64 measurements per worksheet.');
  const value=checkedMeasurement(input,session.geometry.snapshot);
  if(session.measurements.some(m=>m.id===value.id))fail('Measurement IDs must be unique.');
  return register({...session,measurements:[...session.measurements,value]});
}
function checkedReview(value,snapshot){
  exact(value,['target','decision','note','reviewedAt'],'geometry review');
  if(value.target!=='floor'&&value.target!=='start'&&!snapshot.objects.some(o=>value.target==='object:'+o.id))fail('Review target is not in this map.');
  if(!['checked','needs-work'].includes(value.decision))fail('Choose checked or needs work.');
  if(typeof value.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.reviewedAt)||!Number.isFinite(Date.parse(value.reviewedAt))||new Date(value.reviewedAt).toISOString()!==value.reviewedAt)fail('Invalid review time.');
  return {target:value.target,decision:value.decision,note:text(value.note,600,'review note',true),reviewedAt:value.reviewedAt};
}
export function reviewGeometry(session,input,world){
  editable(session,world);const value=checkedReview(input,session.geometry.snapshot);
  const reviews=session.reviews.filter(r=>r.target!==value.target);
  if(reviews.length>=EVIDENCE_LIMITS.reviews)fail('Too many geometry review decisions.');
  return register({...session,reviews:[...reviews,value]});
}
export async function exportGeometryEvidence(session,world){
  known(session);
  const bindingStatus=evidenceBinding(session,world), currentGeometrySha256=world?await geometrySHA256(world):null;
  const value=document(session,{status:bindingStatus,currentGeometrySha256,reason:session.invalidatedReason});
  size(value);return value;
}
export async function importGeometryEvidence(raw){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>EVIDENCE_LIMITS.bytes)fail('Import geometry evidence JSON up to 256 KiB.');
  const value=JSON.parse(raw);
  exact(value,['schema','authority','metricVerified','certified','geometry','binding','origin','measurements','reviews'],'geometry evidence');
  if(value.schema!==EVIDENCE_SCHEMA||value.authority!=='self-reported-unverified'||value.metricVerified!==false||value.certified!==false)fail('Geometry evidence cannot assert metric verification or certification.');
  if(!['local','imported'].includes(value.origin))fail('Invalid evidence origin.');
  exact(value.geometry,['sha256','snapshot'],'geometry binding');
  const snapshot=checkedSnapshot(value.geometry.snapshot);
  if(!SHA.test(value.geometry.sha256)||await sha(snapshot)!==value.geometry.sha256)fail('Geometry snapshot SHA-256 does not match.');
  exact(value.binding,['status','currentGeometrySha256','reason'],'current geometry binding');
  if(!['current','stale','imported'].includes(value.binding.status)||(value.binding.currentGeometrySha256!==null&&!SHA.test(value.binding.currentGeometrySha256))||(value.binding.reason!==null&&!reasons.includes(value.binding.reason)))fail('Invalid evidence binding state.');
  if(!Array.isArray(value.measurements)||value.measurements.length>EVIDENCE_LIMITS.measurements||!Array.isArray(value.reviews)||value.reviews.length>EVIDENCE_LIMITS.reviews)fail('Geometry evidence has too many records.');
  const measurements=value.measurements.map(m=>checkedMeasurement(m,snapshot)),reviews=value.reviews.map(r=>checkedReview(r,snapshot));
  if(new Set(measurements.map(m=>m.id)).size!==measurements.length||new Set(reviews.map(r=>r.target)).size!==reviews.length)fail('Duplicate evidence records.');
  return register({geometry:{sha256:value.geometry.sha256,snapshot},origin:'imported',invalidatedReason:null,measurements,reviews});
}
