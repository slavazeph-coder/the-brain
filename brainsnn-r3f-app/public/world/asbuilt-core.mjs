/** Prior IFC is context, never ground truth. All coordinates here are metres/Y-up. */
import {sha256,sceneBinding,sceneInventory,componentRestMatrix} from './operational-twin.mjs';
export const REVIEW_SCHEMA='brainsnn.asbuilt-review.v1', PRIOR_SCHEMA='brainsnn.ifc-prior.v1';
export const MAX_PRIOR_BYTES=16*1024*1024, MAX_COMPONENTS=1024, MAX_REVIEW_BYTES=1024*1024;
export const fail=m=>{throw Error(m);};
export const number=(n,lo,hi)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<lo||n>hi)fail(`Enter a finite number from ${lo} to ${hi}.`);return n;};
export const vector=v=>{if(!Array.isArray(v)||v.length!==3)fail('Use three metre coordinates.');return v.map(n=>number(n,-1e7,1e7));};
export const text=(v,max=160,empty=false)=>{if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v))fail('Use bounded plain text.');return v;};
const digest=v=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))fail('Exact source SHA-256 required.');return v;};
const list=(v,max)=>{if(!Array.isArray(v)||v.length>max)fail(`Use at most ${max} records.`);return v;};
const unique=xs=>new Set(xs).size===xs.length;
export const point=(m,p)=>[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]);
export const corners=(min,max)=>[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(bits=>bits.map((b,i)=>b?max[i]:min[i]));
export const bounds=points=>({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i])))});
export const centre=b=>b.min.map((n,i)=>(n+b.max[i])/2);
export const extent=b=>b.min.map((n,i)=>b.max[i]-n);
export function footprintHull(points){
  const sorted=[...new Map(points.map(p=>[p[0]+','+p[1],p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  if(sorted.length<=2)return sorted;
  const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lower=[],upper=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
  for(const p of [...sorted].reverse()){while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
export function registeredBounds(element,matrix){
  const pts=element.footprintXZ.map(([x,z])=>point(matrix,[x,element.min[1],z]));
  const b=bounds(pts);b.max[1]=element.max[1]+matrix[13];return b;
}
export function registrationMatrix(reg){
  if(!reg||!['operator-entered-rigid','operator-reviewed-same-frame'].includes(reg.method)||typeof reg.reviewed!=='boolean')fail('Use an explicitly reviewed rigid registration.');
  const translation=vector(reg.translationMeters),angle=number(reg.yawDegrees,-360,360)*Math.PI/180;
  text(reg.note,500,true);
  if(reg.method==='operator-reviewed-same-frame'&&(reg.yawDegrees!==0||translation.some(n=>n!==0)))fail('Same-frame registration must have no transform.');
  const c=Math.cos(angle),s=Math.sin(angle);
  return [c,0,s,0,0,1,0,0,-s,0,c,0,...translation,1];
}
export function validatePrior(prior){
  if(prior?.schema!==PRIOR_SCHEMA||prior.units!=='m'||prior.coordinateFrame!=='right-handed-y-up'||prior.geometry!=='world-axis-aligned-bounds')fail('Unsupported prior IFC inventory.');
  digest(prior.sourceSha256);text(prior.ifcSchema,24);number(prior.nativeLengthScale,1e-9,1e6);
  const rows=list(prior.elements,MAX_COMPONENTS);if(!rows.length||!unique(rows.map(e=>e.globalId)))fail('The IFC needs unique, nonempty GlobalIds.');
  for(const e of rows){if(typeof e.globalId!=='string'||!/^[0-3][0-9A-Za-z_$]{21}$/.test(e.globalId))fail('Invalid IFC GlobalId.');text(e.name);text(e.ifcClass,80);if(e.componentId!==null&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(e.componentId))fail('Invalid source component ID.');const lo=vector(e.min),hi=vector(e.max);if(hi.some((n,i)=>n<lo[i]))fail('Invalid IFC bounds.');list(e.footprintXZ,2048);if(!e.footprintXZ.length)fail('IFC footprint is empty.');for(const p of e.footprintXZ){if(!Array.isArray(p)||p.length!==2)fail('Invalid footprint point.');p.forEach(n=>number(n,-1e7,1e7));}}
  return prior;
}
export function currentInventory(scene,sceneSha){
  sceneBinding(scene,sceneSha);
  return sceneInventory(scene).map(p=>{
    const item=scene[p.kind==='wall'?'walls':p.kind==='object'?'objects':'openings'][p.index];
    const b=p.centre?bounds(corners(p.size.map(n=>-n/2),p.size.map(n=>n/2)).map(v=>point(componentRestMatrix(p),v))):null;
    return {...p,...b,ifcClass:item.ifcClass??(p.floor?'IfcSlab':p.kind==='wall'?'IfcWall':p.kind==='opening'?'IfcOpeningElement':'IfcBuildingElementProxy')};
  });
}
export function identityPairs(prior,current){
  const result=[],seen=new Set();
  for(const p of prior.elements){const c=p.componentId&&current.find(c=>c.componentId===p.componentId);if(c&&!seen.has(c.componentId)){result.push({priorGlobalId:p.globalId,currentComponentId:c.componentId,reviewed:false});seen.add(c.componentId);}}
  return result;
}
export function compareModels(prior,scene,sceneSha,{registration,pairs=[],toleranceMeters=.05,maxTranslationMeters=2,maxExtentDifferenceMeters=.05}={}){
  validatePrior(prior);const current=currentInventory(scene,sceneSha),matrix=registrationMatrix(registration);number(toleranceMeters,.001,1);number(maxTranslationMeters,.001,2);number(maxExtentDifferenceMeters,.001,.25);
  list(pairs,MAX_COMPONENTS);if(!unique(pairs.map(p=>p.priorGlobalId))||!unique(pairs.map(p=>p.currentComponentId)))fail('Correspondences must be one to one.');
  for(const p of pairs)if(!prior.elements.some(e=>e.globalId===p.priorGlobalId)||!current.some(c=>c.componentId===p.currentComponentId)||typeof p.reviewed!=='boolean')fail('Correspondence references a missing component.');
  const rows=prior.elements.map(p=>{
    const pair=pairs.find(pair=>pair.priorGlobalId===p.globalId),c=pair&&current.find(c=>c.componentId===pair.currentComponentId),b=registeredBounds(p,matrix),position=centre(b);
    if(!c?.centre)return {priorGlobalId:p.globalId,prior:p,current:c??null,registeredBounds:b,status:c?'unplaced-current':'prior-unmatched',eligible:false,reason:c?'Current component has no located geometry.':'Not matched in this capture. Removal is unproven.'};
    const delta=c.centre.map((n,i)=>n-position[i]),distance=Math.hypot(...delta),extentDifference=Math.max(...extent(b).map((n,i)=>Math.abs(n-extent(c)[i]))),floor=c.floor||p.ifcClass==='IfcSlab',structure=c.kind!=='object'||!['IfcFurniture','IfcFurnishingElement','IfcBuildingElementProxy'].includes(p.ifcClass)||p.provenance==='unknown',status=extentDifference>maxExtentDifferenceMeters?'bounds-differ':distance>toleranceMeters?'position-differs':'within-review-tolerance';
    const eligible=!!registration.reviewed&&!floor&&!structure&&distance>toleranceMeters&&distance<=maxTranslationMeters&&extentDifference<=maxExtentDifferenceMeters;
    return {priorGlobalId:p.globalId,prior:p,current:c,registeredBounds:b,deltaMeters:delta,distanceMeters:distance,extentDifferenceMeters:extentDifference,status,eligible,reviewed:pair.reviewed,reason:!registration.reviewed?'Review frame alignment first.':floor||structure?'Structural, hosted and floor geometry needs a dedicated modeling review.':extentDifference>maxExtentDifferenceMeters?'Bounds differ: placement alone cannot correct the geometry.':distance>maxTranslationMeters?'Displacement exceeds the bounded update limit.':distance<=toleranceMeters?'No placement update needed.':'Translation candidate only; check identity, capture and geometry.'};
  });
  return {schema:'brainsnn.asbuilt-comparison.v1',source:{priorIfcSha256:prior.sourceSha256,currentSceneSha256:sceneSha,componentRevision:scene.componentGraph.revision},registration:structuredClone(registration),toleranceMeters,maxTranslationMeters,maxExtentDifferenceMeters,rows,currentUnmatched:current.filter(c=>!pairs.some(p=>p.currentComponentId===c.componentId)),summary:{matched:pairs.length,priorUnmatched:rows.filter(r=>r.status==='prior-unmatched').length,unplaced:rows.filter(r=>r.status==='unplaced-current').length,positionDiffers:rows.filter(r=>r.status==='position-differs').length,boundsDiffer:rows.filter(r=>r.status==='bounds-differ').length},metricVerified:false,physicalRobotValidated:false,scope:'Model-to-model differences; prior IFC and user-entered scale are not independent truth.'};
}
export function reviewRequest(prior,scene,sceneSha,{registration,pairs,selected,brief,...limits}){
  const report=compareModels(prior,scene,sceneSha,{registration,pairs,...limits});
  list(selected,32);if(!selected.length||!unique(selected))fail('Select 1 to 32 reviewed translation candidates.');
  if(!registration.reviewed||!registration.note.trim())fail('Describe and review the frame alignment before exporting an update.');
  text(brief?.targets,500);text(brief?.intendedUse,500);number(brief?.accuracyTargetMeters,.001,1);if(brief.detail!=='observed-component-proxies')fail('This update handles observed component proxies, not a certified LOD.');
  for(const id of selected){const row=report.rows.find(r=>r.priorGlobalId===id);if(!row?.eligible||!row.reviewed)fail('Each selected update needs an eligible, explicitly reviewed correspondence.');}
  const request={schema:REVIEW_SCHEMA,source:report.source,registration:report.registration,toleranceMeters:report.toleranceMeters,maxTranslationMeters:report.maxTranslationMeters,maxExtentDifferenceMeters:report.maxExtentDifferenceMeters,pairs:structuredClone(pairs),selectedTranslations:[...selected],brief:structuredClone(brief),metricVerified:false,physicalRobotValidated:false};
  if(new TextEncoder().encode(JSON.stringify(request)).length>MAX_REVIEW_BYTES)fail('Review contract exceeds 1 MiB.');return request;
}
export function priorParts(prior,registration){
  const m=registrationMatrix(registration);return prior.elements.map(e=>{const b=registeredBounds(e,m);return {componentId:e.globalId,sourceName:e.name,label:e.name,centre:centre(b),size:extent(b).map(n=>Math.max(.001,n)),yaw:0,floor:e.ifcClass==='IfcSlab'};});
}
export function comparisonFrame(prior,scene,sceneSha,registration){
  const m=registrationMatrix(registration),pts=prior.elements.flatMap(e=>{const b=registeredBounds(e,m);return corners(b.min,b.max);});
  for(const c of currentInventory(scene,sceneSha))if(c.centre)pts.push(...corners(c.min,c.max));
  const b=bounds(pts);return {centre:centre(b),span:Math.max(...extent(b),1)};
}
export {sha256};
