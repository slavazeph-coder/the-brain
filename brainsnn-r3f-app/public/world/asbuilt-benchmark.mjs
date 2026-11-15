/** Detection is scored independently from placement. No distance cutoff hides a misplaced detection. */
import {currentInventory,number,vector,text,fail} from './asbuilt-core.mjs';
const median=xs=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),n=s.length;return n%2?s[(n-1)/2]:(s[n/2-1]+s[n/2])/2;};
function assign(cost){
  if(!cost.length||!cost[0].length)return [];
  if(cost.length>cost[0].length)return assign(cost[0].map((_v,j)=>cost.map(r=>r[j]))).map(([a,b])=>[b,a]);
  const n=cost.length,m=cost[0].length,u=Array(n+1).fill(0),v=Array(m+1).fill(0),p=Array(m+1).fill(0),way=Array(m+1).fill(0);
  for(let i=1;i<=n;i++){
    p[0]=i;let j0=0;const min=Array(m+1).fill(Infinity),used=Array(m+1).fill(false);
    do{used[j0]=true;const i0=p[j0];let delta=Infinity,j1=0;for(let j=1;j<=m;j++)if(!used[j]){const cur=cost[i0-1][j-1]-u[i0]-v[j];if(cur<min[j]){min[j]=cur;way[j]=j0;}if(min[j]<delta){delta=min[j];j1=j;}}for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}else min[j]-=delta;j0=j1;}while(p[j0]!==0);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  return p.slice(1).flatMap((i,j)=>i?[[i-1,j]]:[]);
}
export function scoreReference(scene,sceneSha,reference,referenceSha,{priorIfcSha256=null}={}){
  const inventory=currentInventory(scene,sceneSha);
  if(reference?.schema!=='brainsnn.component-reference.v1'||reference.units!=='m'||reference.coordinateFrame!=='right-handed-y-up'||reference.sceneSha256!==sceneSha||reference.frameReviewed!==true)fail('Reference needs metres, the exact scene hash and an explicitly reviewed common frame.');
  if(!/^[a-f0-9]{64}$/.test(referenceSha))fail('Reference byte SHA-256 required.');
  if(!['synthetic-fixture','operator-supplied-reference'].includes(reference.origin))fail('Declare the reference origin.');
  text(reference.method,300);text(reference.instrument,160);text(reference.measuredOn,40);
  if(reference.usedForModeling!==false||reference.usedForRegistration!==false||reference.isPriorModel!==false)fail('Held-out scoring refuses a modeling, registration or prior-model reference.');
  const forbidden=new Set([sceneSha,scene.componentGraph.sourceSha256,priorIfcSha256].filter(Boolean));
  if(reference.derivedFromSha256!==null||forbidden.has(referenceSha)||forbidden.has(reference.sourceSha256))fail('Reference leakage: do not validate a model with its own source, output or prior.');
  if(!/^[a-f0-9]{64}$/.test(reference.sourceSha256))fail('Reference source digest required.');
  const tolerance=number(reference.toleranceMeters,.001,1),refs=reference.components;
  if(!Array.isArray(refs)||!refs.length||refs.length>256||new Set(refs.map(r=>r.id)).size!==refs.length)fail('Provide 1 to 256 uniquely identified reference components.');
  for(const r of refs){text(r.id,80);text(r.class,160);vector(r.centreMeters);number(r.uncertaintyMeters,0,1);if(!['horizontal','3d','exclude'].includes(r.positionMode))fail('Declare horizontal, 3D or excluded position scoring.');}
  if(inventory.length>256)fail('Benchmark one slice of at most 256 predicted components.');
  const predictions=inventory.map(p=>({id:p.componentId,class:p.kind==='wall'?'wall':p.floor?'floor':p.label,centre:p.centre})),classes=[...new Set([...predictions.map(p=>p.class),...refs.map(r=>r.class)])].sort(),matches=[],byClass=[];
  for(const cls of classes){
    const gt=refs.filter(r=>r.class===cls),pred=predictions.filter(p=>p.class===cls),distance=(g,p)=>!p.centre?1e12:Math.hypot(...g.centreMeters.map((n,i)=>g.positionMode==='horizontal'&&i===1?0:n-p.centre[i]));
    const assignments=assign(gt.map(g=>pred.map(p=>distance(g,p))));
    for(const [i,j] of assignments){const g=gt[i],p=pred[j],error=g.positionMode==='exclude'||!p.centre?null:distance(g,p);matches.push({referenceId:g.id,predictionId:p.id,class:cls,positionMode:g.positionMode,positionErrorMeters:error,referenceUncertaintyMeters:g.uncertaintyMeters,located:!!p.centre,withinRequestedTolerance:error===null?null:error<=tolerance});}
    byClass.push({class:cls,truePositives:assignments.length,falseNegatives:gt.length-assignments.length,falsePositives:pred.length-assignments.length});
  }
  const tp=matches.length,fn=refs.length-tp,fp=predictions.length-tp,errors=matches.filter(m=>m.positionErrorMeters!==null).map(m=>m.positionErrorMeters),within=matches.filter(m=>m.withinRequestedTolerance===true).length,positionReferenceCount=refs.filter(r=>r.positionMode!=='exclude').length;
  return {schema:'brainsnn.component-benchmark.v1',source:{sceneSha256:sceneSha,referenceSha256:referenceSha,referenceSourceSha256:reference.sourceSha256,priorIfcSha256},reference:{origin:reference.origin,method:reference.method,instrument:reference.instrument,measuredOn:reference.measuredOn,authority:'Operator declaration, not independently attested'},
    detection:{truePositives:tp,falseNegatives:fn,falsePositives:fp,precision:tp+fp?tp/(tp+fp):null,recall:tp/(tp+fn),f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null},
    position:{toleranceMeters:tolerance,referenceCount:positionReferenceCount,locatedMatchedCount:errors.length,unlocatedMatchedCount:matches.filter(m=>!m.located&&m.positionMode!=='exclude').length,medianErrorMeters:median(errors),meanErrorMeters:errors.length?errors.reduce((a,b)=>a+b)/errors.length:null,withinToleranceCount:within,withinToleranceRecall:positionReferenceCount?within/positionReferenceCount:null},
    byClass,matches,metricVerified:false,physicalRobotValidated:false,
    scope:reference.origin==='synthetic-fixture'?'Authored fixture regression only; not physical accuracy.':'Agreement with operator-supplied held-out components in the declared frame; not general survey accuracy.',
    limitations:['Class-conditioned minimum-cost matching counts recognition even when placement is wrong.','Bounding-centre errors do not validate surfaces, thickness, orientation or MEP connectivity.','A user-entered reconstruction scale is not promoted to a measured scale.','Reference uncertainty is retained separately; it is not used to loosen the requested tolerance.']};
}
