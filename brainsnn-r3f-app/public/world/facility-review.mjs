/** View-only facility review. Source geometry and engineering exports are immutable. */
import {sceneBinding,sceneInventory} from './operational-twin.mjs';
import {pointsSHA256} from './dimension-review.mjs';

const fail=message=>{throw Error(message);};
const finite=(v,lo,hi,name)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail(`Invalid ${name}.`);return v;};
const plain=(v,max,name)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/u.test(v))fail(`Invalid ${name}.`);return v;};
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const sortedJSON=v=>JSON.stringify(v,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value);
export const FACILITY_SCHEMA='brainsnn.facility-review.v1';
export const FACILITY_VALIDATION=Object.freeze({metricVerified:false,surveyValidated:false,physicsValidated:false,physicalRobotValidated:false});

/** Include rotated component envelopes AND retained points in a common source frame. */
export function facilityFrame(parts,points){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const add=p=>p.forEach((v,i)=>{finite(v,-1e7,1e7,'frame coordinate');min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});
  points.forEach(p=>add(p.slice(0,3)));
  for(const p of parts){if(!p.centre||!p.size)continue;const a=p.yaw*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])add([p.centre[0]+c*x*p.size[0]+s*z*p.size[2],p.centre[1]+y*p.size[1],p.centre[2]-s*x*p.size[0]+c*z*p.size[2]]);
  }
  if(!min.every(Number.isFinite))fail('No source geometry to review.');
  return {min,max,centre:min.map((v,i)=>(v+max[i])/2),span:Math.max(...max.map((v,i)=>v-min[i]),1)};
}

export async function createFacilityReview(scene,cloud,sceneSha){
  // Clone before the first await so callers cannot mutate the evidence during hashing.
  const source=structuredClone(scene),capture=structuredClone(cloud),binding=sceneBinding(source,sceneSha);
  if(capture.coordinateFrame!=='right-handed-y-up')fail('Use the original Y-up metric source cloud.');
  if(sortedJSON(source.scale??null)!==sortedJSON(capture.scale??null))fail('Scale metadata differs between this scene and source cloud.');
  const hash=await pointsSHA256(capture);
  if(source.cloudPointsSha256!==hash||binding.sourceSha256!==hash)fail('Source point hash does not match this scene and component graph.');
  const parts=sceneInventory(source),frame=facilityFrame(parts,capture.points);
  return freeze({binding,parts,frame,cloudPoints:capture.points,pointCount:capture.points.length,
    sourceLabel:String(source.source??capture.source??'Source reconstruction'),scale:structuredClone(source.scale??null),
    limits:{maxPoints:50000,maxComponents:1024,pointMembership:'Not complete per-component segmentation',representation:'Compiled component envelopes and retained source points'},
    validation:{...FACILITY_VALIDATION}});
}

function checkedState(review,state){
  if(!state||!['scan','model','overlay'].includes(state.mode))fail('Choose scan, model or overlay.');
  const opacity=finite(state.opacity,0,1,'model opacity'),query=plain(state.query??'',160,'search'),kind=state.kind??'all';
  if(!['all','wall','object','opening'].includes(kind))fail('Invalid component kind.');
  const selectedId=state.selectedId??null;
  if(selectedId!==null&&!review.parts.some(p=>p.componentId===selectedId))fail('Selected component belongs to another scene.');
  if(typeof state.isolate!=='boolean'||(state.isolate&&!selectedId))fail('Select a component before isolating it.');
  const replayCount=finite(state.replayCount,0,review.parts.length,'assembly count');if(!Number.isInteger(replayCount))fail('Assembly count must be an integer.');
  const section=state.section;if(!section||typeof section.enabled!=='boolean')fail('Invalid section.');
  const min=finite(section.min,review.frame.min[1],review.frame.max[1],'section minimum'),max=finite(section.max,review.frame.min[1],review.frame.max[1],'section maximum');
  if(min>max)fail('Section minimum exceeds its maximum.');
  return {mode:state.mode,opacity,query,kind,selectedId,isolate:state.isolate,section:{enabled:section.enabled,min,max},replayCount};
}

export function presentation(review,state){
  const s=checkedState(review,state),query=s.query.toLocaleLowerCase(),revealed=new Set(review.parts.slice(0,s.replayCount).map(p=>p.componentId));
  const visibleIds=review.parts.filter(p=>revealed.has(p.componentId)&&(s.kind==='all'||p.kind===s.kind)&&`${p.label} ${p.sourceName} ${p.componentId}`.toLocaleLowerCase().includes(query)&&(!s.isolate||p.componentId===s.selectedId)).map(p=>p.componentId);
  return {mode:s.mode,opacity:s.opacity,visibleIds,clip:s.section.enabled?{min:[review.frame.min[0],s.section.min,review.frame.min[2]],max:[review.frame.max[0],s.section.max,review.frame.max[2]]}:null};
}

function cameraView(value){
  if(!value||!Array.isArray(value.target)||value.target.length!==3)fail('Invalid camera view.');
  return {yaw:finite(value.yaw,-1e6,1e6,'view yaw'),pitch:finite(value.pitch,-Math.PI/2,Math.PI/2,'view pitch'),zoom:finite(value.zoom,.000001,1e6,'view zoom'),target:value.target.map(v=>finite(v,-1e7,1e7,'view target'))};
}

export function makeReceipt(review,state){
  const controls=checkedState(review,state),shown=presentation(review,state),bookmarks=state.bookmarks??[];
  if(!Array.isArray(bookmarks)||bookmarks.length>12)fail('Keep at most 12 bookmarks.');
  const receipt={schema:FACILITY_SCHEMA,source:structuredClone(review.binding),authorship:'operator-authored-view-review',
    scale:structuredClone(review.scale),sourceLabel:review.sourceLabel,pointCount:review.pointCount,componentCount:review.parts.length,
    controls,visibleComponentIds:shown.visibleIds,clip:shown.clip,view:state.view?cameraView(state.view):null,
    bookmarks:bookmarks.map(b=>({name:plain(b.name,80,'bookmark name'),view:cameraView(b.view)})),
    assembly:{kind:'completed-model-assembly-playback',order:'compiler-inventory-order',executionTimingAvailable:false},
    displayFrame:{...structuredClone(review.frame),sourceCoordinatesPreserved:true,renderOriginOnly:true},
    limits:structuredClone(review.limits),validation:{...FACILITY_VALIDATION},
    scope:'View-only review of retained source points and compiled envelopes. Overlay agreement is internal fit, not survey accuracy. Scale metadata is preserved without verification. IFC, Rhino, names, quantities and robot routes are unchanged. No physical robot validation.'};
  if(new TextEncoder().encode(JSON.stringify(receipt)).length>256*1024)fail('Facility review exceeds 256 KiB.');
  return receipt;
}
