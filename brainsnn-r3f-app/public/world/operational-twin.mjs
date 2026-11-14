/** An authored operational overlay, bound to exact compiler scene bytes.
 * Geometry, scale, fit reports, IFC and robot routes are never modified here.
 * Documents are inert local text. Answers are excerpts, not model diagnoses.
 */
export const TWIN_SCHEMA='brainsnn.operational-twin.v1';
export const TWIN_BYTES=2*1024*1024;
export const TWIN_VALIDATION=Object.freeze({metricVerified:false,jointsMeasured:false,physicsValidated:false,physicalRobotValidated:false});
const SHA=/^[a-f0-9]{64}$/, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const fail=message=>{throw Error(message);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('Unsupported operational record fields.');};
const list=(v,max,name)=>{if(!Array.isArray(v)||v.length>max)fail(`${name} must be a list of at most ${max}.`);return v;};
const text=(v,max=160,empty=false)=>{if(typeof v!=='string'||v.length>max||(!empty&&!v.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v)||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))fail('Use bounded plain text.');return v;};
const recordId=v=>{text(v,64);if(!ID.test(v))fail('Record IDs need 1 to 64 alphanumeric, underscore or hyphen characters.');return v;};
const num=(v,lo,hi)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)fail(`Use a finite number from ${lo} to ${hi}.`);return v;};
const hash=v=>{if(typeof v!=='string'||!SHA.test(v))fail('An exact SHA-256 source digest is required.');return v;};
const vec=(v,lo,hi)=>{if(!Array.isArray(v)||v.length!==3)fail('Use three coordinates.');return v.map(n=>num(n,lo,hi));};
const unique=values=>new Set(values).size===values.length;
const bounded=value=>{let raw;try{raw=JSON.stringify(value,(_k,v)=>{if(typeof v==='number'&&!Number.isFinite(v))fail('Non-finite JSON.');return v;});}catch{fail('Use finite JSON records.');}if(new TextEncoder().encode(raw).length>TWIN_BYTES)fail('Operational overlay exceeds 2 MiB.');};
export async function sha256(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}

export function sceneBinding(scene,sceneSha256){
  const g=scene?.componentGraph;
  if(scene?.schema!=='brainsnn.scene.v1'||scene.units!=='m'||g?.schema!=='brainsnn.component-graph.v1')fail('Open a metric compiler scene with stable component IDs first.');
  hash(sceneSha256);hash(g.sourceSha256);hash(g.contentSha256);num(g.revision,0,1e6);
  if(!Number.isInteger(g.revision))fail('Invalid scene revision.');
  const inventory=sceneInventory(scene),ids=inventory.map(p=>p.componentId);
  list(g.components,1024,'Component graph');
  if(!ids.length||!unique(ids)||g.components.length!==ids.length||!unique(g.components.map(c=>c.componentId)))fail('Component graph does not match scene inventory.');
  for(const c of g.components){const p=inventory.find(p=>p.componentId===c.componentId);if(!p||p.kind!==c.kind||p.index!==c.index||p.sourceName!==c.sourceName)fail('Stale component graph.');}
  return {sceneSha256,sourceSha256:g.sourceSha256,contentSha256:g.contentSha256,revision:g.revision,units:'m',coordinateFrame:'right-handed-y-up'};
}

export function sceneInventory(scene){
  const inventory=[];
  for(const [field,kind] of [['walls','wall'],['objects','object'],['openings','opening']]){
    list(scene?.[field]??[],1024,'Scene components').forEach((p,index)=>{
      if(!object(p)||!UUID.test(p.componentId))fail('Missing or invalid stable component ID. Recompile with an updated worker.');
      const sourceName=text(kind==='opening'?p.id:p.name),label=text(p.label||sourceName);
      let centre=null,size=null,yaw=0;
      // Compiler footprint yaw points along +Z; right-handed render Y rotation points along -Z.
      if(p.centre!==undefined||p.size!==undefined){centre=vec(p.centre,-1e7,1e7);size=vec(p.size,.001,1e5);yaw=-num(p.yaw_degrees??0,-360,360);}
      else if(p.min&&p.max){const lo=vec(p.min,-1e7,1e7),hi=vec(p.max,-1e7,1e7);if(hi.some((v,i)=>v<=lo[i]))fail('Invalid component bounds.');centre=lo.map((v,i)=>(v+hi[i])/2);size=hi.map((v,i)=>v-lo[i]);}
      inventory.push({componentId:p.componentId,sourceName,label,kind,index,centre,size,yaw,floor:sourceName==='floor_observed'||p.label==='floor'});
    });
  }
  if(inventory.length>1024)fail('Use at most 1024 scene components.');
  return inventory;
}

export function createTwin(scene,sceneSha256){
  return {schema:TWIN_SCHEMA,source:sceneBinding(scene,sceneSha256),authorship:'operator-authored',
    assets:sceneInventory(scene).map(p=>({componentId:p.componentId,assetCode:'',label:p.label,parentComponentId:null,manufacturer:'',model:'',serial:'',location:'',notes:'',documentIds:[],spares:[],dependsOn:[]})),
    documents:[],joints:[],issues:[],validation:{...TWIN_VALIDATION}};
}
/** Compact bytes are the persistence contract, including through the app's download helper. */
export function serializeTwin(twin){bounded(twin);return JSON.stringify(twin);}
export function componentRestMatrix(part){
  const [x,y,z]=vec(part.centre,-1e7,1e7),angle=num(part.yaw,-360,360)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return [c,0,-s,0,0,1,0,0,s,0,c,0,x,y,z,1];
}
export async function makeDocument({id,title,revision,body,sourceUrl=''}){
  recordId(id);text(title);text(revision,80);text(body,60000);safeSourceUrl(sourceUrl);
  return {id,title,revision,body,sourceUrl,sha256:await sha256(body),origin:'operator-supplied-text'};
}
export function safeSourceUrl(value){
  text(value,2000,true);if(!value)return '';
  let url;try{url=new URL(value);}catch{fail('Use an HTTPS document source URL.');}
  if(url.protocol!=='https:'||url.username||url.password)fail('Use an HTTPS document source URL without credentials.');
  return value;
}
export async function validateTwin(value,scene,sceneSha256){
  bounded(value);keys(value,['schema','source','authorship','assets','documents','joints','issues','validation']);
  if(value.schema!==TWIN_SCHEMA||value.authorship!=='operator-authored')fail('Unsupported operational overlay.');
  const binding=sceneBinding(scene,sceneSha256);
  keys(value.source,Object.keys(binding));
  if(Object.keys(binding).some(k=>value.source[k]!==binding[k]))fail('Overlay belongs to different scene bytes, geometry revision or source. Rebind it explicitly after review.');
  keys(value.validation,Object.keys(TWIN_VALIDATION));
  if(Object.keys(TWIN_VALIDATION).some(k=>value.validation[k]!==false))fail('Operational overlays cannot claim verified geometry, measured joints or physical validation.');
  const inventory=sceneInventory(scene),ids=new Set(inventory.map(p=>p.componentId));
  const assets=list(value.assets,1024,'Assets'),docs=list(value.documents,64,'Documents'),joints=list(value.joints,64,'Joints'),issues=list(value.issues,256,'Issues');
  if(assets.length!==ids.size||!unique(assets.map(a=>a.componentId)))fail('Assets must match every scene component exactly once.');
  for(const d of docs){keys(d,['id','title','revision','body','sourceUrl','sha256','origin']);recordId(d.id);text(d.title);text(d.revision,80);text(d.body,60000);safeSourceUrl(d.sourceUrl);hash(d.sha256);if(d.origin!=='operator-supplied-text'||await sha256(d.body)!==d.sha256)fail('Document text changed without a matching digest.');}
  if(!unique(docs.map(d=>d.id)))fail('Document IDs must be unique.');
  const docIds=new Set(docs.map(d=>d.id)),assetById=new Map(assets.map(a=>[a.componentId,a]));
  for(const a of assets){
    keys(a,['componentId','assetCode','label','parentComponentId','manufacturer','model','serial','location','notes','documentIds','spares','dependsOn']);
    if(!ids.has(a.componentId))fail('Unknown component ID.');
    text(a.label);text(a.assetCode,80,true);for(const k of ['manufacturer','model','serial','location'])text(a[k],160,true);text(a.notes,2000,true);
    if(a.parentComponentId!==null&&(!ids.has(a.parentComponentId)||a.parentComponentId===a.componentId))fail('Select a different, existing assembly parent.');
    if(a.parentComponentId){const child=inventory.find(p=>p.componentId===a.componentId),parent=inventory.find(p=>p.componentId===a.parentComponentId);if(child.kind!=='object'||child.floor||parent.kind!=='object'||parent.floor)fail('Assemblies require non-floor object components.');}
    list(a.documentIds,64,'Linked documents');if(!unique(a.documentIds)||a.documentIds.some(id=>!docIds.has(id)))fail('Unknown or repeated linked document.');
    list(a.dependsOn,64,'Dependencies');if(!unique(a.dependsOn)||a.dependsOn.some(id=>!ids.has(id)||id===a.componentId))fail('Dependencies need other existing component IDs.');
    for(const s of list(a.spares,64,'Spare parts')){keys(s,['partNumber','description','quantity','documentId','locator']);text(s.partNumber,80);text(s.description);num(s.quantity,1,10000);if(!Number.isInteger(s.quantity))fail('Use a whole spare quantity.');text(s.locator,160);if(!a.documentIds.includes(s.documentId))fail('A spare needs a document linked to this asset and a source locator.');}
  }
  if(!unique(assets.filter(a=>a.assetCode).map(a=>a.assetCode.toLowerCase())))fail('Asset codes must be unique.');
  // Both assembly and dependency graphs must be acyclic, bounded by inventory size.
  for(const field of ['parentComponentId','dependsOn']){
    const complete=new Set(),visiting=new Set();
    function walk(id){if(visiting.has(id))fail(`Cyclic ${field} relationship.`);if(complete.has(id))return;visiting.add(id);const a=assetById.get(id),next=field==='dependsOn'?a.dependsOn:(a.parentComponentId?[a.parentComponentId]:[]);for(const n of next)walk(n);visiting.delete(id);complete.add(id);}
    assets.forEach(a=>walk(a.componentId));
  }
  if(!unique(joints.map(j=>j.componentId))||!unique(joints.map(j=>j.id)))fail('Use at most one joint per component, with unique joint IDs.');
  for(const j of joints){
    keys(j,['id','componentId','type','axis','originMeters','min','max','home','unit','authorship']);recordId(j.id);
    const p=inventory.find(p=>p.componentId===j.componentId);
    if(!p?.centre||p.floor||p.kind!=='object')fail('Joints require a bounded object, not a wall, opening or floor.');
    if(!['revolute','prismatic'].includes(j.type)||j.authorship!=='operator-authored'||j.unit!==(j.type==='revolute'?'degrees':'m'))fail('Unsupported authored joint.');
    const norm=Math.hypot(...vec(j.axis,-1,1));if(Math.abs(norm-1)>1e-6)fail('Joint axis must be a unit vector.');vec(j.originMeters,-1e7,1e7);
    const limit=j.type==='revolute'?360:100;num(j.min,-limit,limit);num(j.max,-limit,limit);num(j.home,j.min,j.max);if(j.min>=j.max)fail('Joint minimum must be below maximum.');
  }
  if(!unique(issues.map(i=>i.id)))fail('Issue IDs must be unique.');
  for(const i of issues){keys(i,['id','componentId','symptom','status','documentId','locator','note']);recordId(i.id);text(i.symptom,500);text(i.note,2000,true);text(i.locator,160,true);if(!ids.has(i.componentId)||!['open','resolved'].includes(i.status))fail('Issue needs an existing component and status.');if(i.documentId!==null&&(!assetById.get(i.componentId).documentIds.includes(i.documentId)||!i.locator))fail('Issue evidence needs a linked document and source locator.');}
  return structuredClone(value);
}

const stop=new Set('a an the what which where when how do does is are can i we it this that for to of and or with in on at me please tell show about maintain maintenance'.split(' '));
const terms=s=>new Set((s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{2,}/gu)||[]).filter(t=>!stop.has(t)));
export function answerQuestion(twin,componentId,question){
  text(question,500);const asset=twin.assets.find(a=>a.componentId===componentId);if(!asset)fail('Select a component first.');
  const query=terms(question),matches=[];
  for(const d of twin.documents.filter(d=>asset.documentIds.includes(d.id))){
    const lines=d.body.split('\n');
    for(let start=0;start<lines.length;start+=4){const excerpt=lines.slice(start,start+4).join('\n').slice(0,1400),words=terms(excerpt),hits=[...query].filter(t=>words.has(t));
      // Require specificity and adequate query coverage; never synthesize a procedure.
      if(hits.length&&hits.length>=Math.ceil(query.size/2))matches.push({documentId:d.id,title:d.title,revision:d.revision,sha256:d.sha256,sourceUrl:d.sourceUrl,lineStart:start+1,lineEnd:start+excerpt.split('\n').length,excerpt,score:hits.length/Math.sqrt(Math.max(words.size,1))});
    }
  }
  matches.sort((a,b)=>b.score-a.score||a.documentId.localeCompare(b.documentId)||a.lineStart-b.lineStart);
  return {status:matches.length?'source-excerpts':'not-found',componentId,question,citations:matches.slice(0,3),message:matches.length?'Exact excerpts from the linked text. Review the original revision before acting.':'No supported answer in this component’s linked documents. Add an approved source or ask its owner.'};
}
export function dependencyTrace(twin,componentId){
  const seen=new Set(),rows=[];
  function walk(id,depth){if(seen.has(id))return;seen.add(id);const a=twin.assets.find(a=>a.componentId===id);if(!a)return;rows.push({componentId:id,label:a.label,depth,openIssues:twin.issues.filter(i=>i.componentId===id&&i.status==='open').length});a.dependsOn.forEach(n=>walk(n,depth+1));}
  walk(componentId,0);return rows;
}
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply(a,b){return Array.from({length:16},(_,i)=>{const row=i%4,col=Math.floor(i/4);return [0,1,2,3].reduce((s,k)=>s+a[k*4+row]*b[col*4+k],0);});}
export function jointMatrix(j,value){
  num(value,j.min,j.max);const delta=value-j.home,[x,y,z]=j.axis;
  if(j.type==='prismatic'){const m=identity();m[12]=x*delta;m[13]=y*delta;m[14]=z*delta;return m;}
  const rad=delta*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),t=1-c;
  const m=[t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1];
  const a=identity(),b=identity();j.originMeters.forEach((v,i)=>{a[12+i]=v;b[12+i]=-v;});return multiply(multiply(a,m),b);
}
export function componentPoses(twin,values={}){
  const assets=new Map(twin.assets.map(a=>[a.componentId,a])),joints=new Map(twin.joints.map(j=>[j.componentId,j])),cache=new Map(),visiting=new Set();
  function pose(id){if(cache.has(id))return cache.get(id);if(visiting.has(id))fail('Cyclic assembly.');visiting.add(id);const a=assets.get(id),j=joints.get(id),parent=a?.parentComponentId?pose(a.parentComponentId):identity(),own=j?jointMatrix(j,Object.hasOwn(values,j.id)?values[j.id]:j.home):identity(),matrix=multiply(parent,own);cache.set(id,matrix);visiting.delete(id);return matrix;}
  return Object.fromEntries(twin.assets.map(a=>[a.componentId,pose(a.componentId)]));
}
const csv=v=>{let s=String(v??'');if(/^[\s]*[=+\-@]/u.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
export function assetRegisterCSV(twin){
  const columns=['componentId','assetCode','label','parentComponentId','manufacturer','model','serial','location','sourceSceneSha256','sceneRevision','partNumber','description','quantity','documentId','sourceLocator'];
  const rows=twin.assets.flatMap(a=>(a.spares.length?a.spares:[{}]).map(s=>[a.componentId,a.assetCode,a.label,a.parentComponentId,a.manufacturer,a.model,a.serial,a.location,twin.source.sceneSha256,twin.source.revision,s.partNumber,s.description,s.quantity,s.documentId,s.locator]));
  return [columns,...rows].map(r=>r.map(csv).join(',')).join('\r\n')+'\r\n';
}
