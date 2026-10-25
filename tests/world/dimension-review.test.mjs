import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pointsSHA256, retainedSourceIndices, measurementContract, validateMeasurementReport, reportStatusText, measurementRows} from '../../brainsnn-r3f-app/public/world/dimension-review.mjs';
import {parsePLY, toArenaCloud, STRIDE} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cloud = () => ({units:'m',coordinateFrame:'right-handed-y-up',points:[[0,0,0,1,2,3],[3,0,0,4,5,6],[0,0,4,7,8,9]],scale:{source:'user-measured',metresPerUnit:1,selfReported:true,verified:false}});
const reading = (patch={}) => ({id:'held-one',label:'Visible landmark span',role:'held-out',pointIndices:[0,1],distanceMeters:3,uncertaintyMeters:.005,method:'tape',instrument:'Test tape',measuredOn:'2026-10-24',note:'Synthetic test reference',...patch});
const visual = rows => parsePLY(new TextEncoder().encode(`ply\nformat ascii 1.0\nelement vertex ${rows.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n${rows.map(r=>r.join(' ')).join('\n')}\n`).buffer).points;
function python(command,input) {
  const result=spawnSync('python3',['-c',command],{cwd:root,input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr); return result.stdout.trim();
}
function reportFromPython(c) {
  return JSON.parse(python('import json,sys; from robotics.world_worker.measurement_check import build_report; c=json.load(sys.stdin); print(json.dumps(build_report({"units":"m","scale":c["scale"],"objects":[],"walls":[]},c)))',c));
}

test('browser point fingerprint matches actual Python wire format, including negative zero',async()=>{
  const c=cloud(); c.points[0][0]=-0;
  // JSON does not retain -0, so use the same explicit assignment on the Python side.
  const expected=python('import json,sys; from robotics.world_worker.measurement_check import points_sha256; c=json.load(sys.stdin); c["points"][0][0]=-0.0; print(points_sha256(c))',c);
  assert.equal(await pointsSHA256(c),expected);
  const ordinary=cloud(); assert.notEqual(await pointsSHA256(c),await pointsSHA256(ordinary));
  for(const mutate of [v=>v.points.reverse(),v=>v.points[0][0]=.1,v=>v.points[1][5]++]) {
    const changed=cloud();mutate(changed);assert.notEqual(await pointsSHA256(changed),await pointsSHA256(ordinary));
  }
});

test('viewer references map through trim, transform and preserved colours to metric cloud order',()=>{
  const rows=Array.from({length:1000},(_,i)=>[(i%10)/10,(Math.floor(i/10)%10)/10,Math.floor(i/100)/10,10,20,30]);
  rows.push([400,-100,500,40,50,60]);
  const p=visual(rows), c=toArenaCloud(p,{metresPerUnit:2});
  const map=retainedSourceIndices(p,c);
  assert.equal(map.size,c.points.length);assert.equal(map.has(1000),false);
  const first=[...map.keys()][0];assert.ok(Number.isInteger(map.get(first)));
  const changed=structuredClone(c);changed.points[0][0]+=.01;
  assert.throws(()=>retainedSourceIndices(p,changed),/coordinates changed/);
  const colours=structuredClone(c);colours.points[0][3]++;
  assert.throws(()=>retainedSourceIndices(p,colours),/coordinates changed/);
});

test('default Arena thinning preserves original indices rather than confusing them with cloud indices',()=>{
  const n=50001,p=new Float32Array(n*STRIDE);
  for(let i=0;i<n;i++)p.set([i%250/1000,0,Math.floor(i/250)/1000,.01,.01,.01,0,0,0,1,0,0,0,1],i*STRIDE);
  const points=[];for(let i=0;i<n;i+=2)points.push([p[i*STRIDE],0,p[i*STRIDE+2],0,0,0]);
  const c={units:'m',coordinateFrame:'right-handed-y-up',points,fromSource:[[1,0,0,0],[0,1,0,0],[0,0,1,0]],provenance:{totalPoints:n,keptPoints:points.length,outliersDropped:0,thinned:true}};
  const map=retainedSourceIndices(p,c);
  assert.equal(map.get(2),1);assert.equal(map.has(1),false);assert.equal(map.get(50000),25000);
});

test('reference contract is an immutable copy accepted by the actual backend validator',async()=>{
  const c=cloud(),refs=[reading(),reading({id:'calibration',role:'calibration',pointIndices:[0,2],distanceMeters:4})];
  const before=JSON.stringify(c),contract=await measurementContract(c,refs,{absoluteMeters:.05,relative:.02});
  c.measurementChecks=contract;
  assert.equal(python('import json,sys; from robotics.world_worker.measurement_check import validate_checks; c=json.load(sys.stdin); print(len(validate_checks(c["measurementChecks"],c)["checks"]))',c),'2');
  refs[0].label='changed';assert.equal(contract.checks[0].label,'Visible landmark span');
  delete c.measurementChecks;assert.equal(JSON.stringify(c),before);
});

test('invalid readings, duplicate pairs across roles and VLM guesses are rejected before upload',async()=>{
  for(const patch of [{distanceMeters:NaN},{distanceMeters:true},{distanceMeters:0},{pointIndices:[0,99]},{pointIndices:[1,1]},{method:'model'},{instrument:''},{measuredOn:'2026-02-30'},{unknown:true},{label:'x'.repeat(121)}])await assert.rejects(measurementContract(cloud(),[reading(patch)]),JSON.stringify(patch));
  await assert.rejects(measurementContract(cloud(),[reading(),reading({id:'cal',role:'calibration',pointIndices:[1,0]})]),/same point pair/);
  await assert.rejects(measurementContract({...cloud(),units:'arbitrary'},[reading()]),/metric/);
  await assert.rejects(measurementContract(cloud(),[reading()],{absoluteMeters:.05,relative:Infinity}));
  await assert.rejects(measurementContract(cloud(),[]));
});

test('Python report displays held-out status and readonly rows without asserting element accuracy',async()=>{
  const c=cloud();c.measurementChecks=await measurementContract(c,[reading(),reading({id:'cal',role:'calibration',pointIndices:[0,2],distanceMeters:5})]);
  const report=reportFromPython(c), checked=await validateMeasurementReport(report,c);
  assert.equal(checked.status,'within-requested-tolerance');assert.equal(checked.summary.calibrationWithinTolerance,0);
  assert.equal(reportStatusText(checked),'Held-out spans meet your tolerance');
  assert.deepEqual(measurementRows(checked)[0],{id:'held-one',label:'Visible landmark span',role:'held-out',reference:'3.000 m',reconstructed:'3.000 m',error:'0.0 cm',within:true});
  checked.checks[0].label='edited display copy';assert.equal(report.checks[0].label,'Visible landmark span');
  const failed=cloud();failed.measurementChecks=await measurementContract(failed,[reading({distanceMeters:3.5})]);
  assert.equal((await validateMeasurementReport(reportFromPython(failed),failed)).status,'outside-requested-tolerance');
  const empty=reportFromPython(cloud());assert.equal((await validateMeasurementReport(empty)).status,'no-held-out');
});

test('stale or forged measurement reports fail closed',async()=>{
  const c=cloud();c.measurementChecks=await measurementContract(c,[reading()]);const report=reportFromPython(c);
  const changed=cloud();changed.points[0][0]=.1;await assert.rejects(validateMeasurementReport(report,changed),/another point cloud/);
  for(const mutate of [r=>r.metric_verified=true,r=>r.certified=true,r=>r.status='outside-requested-tolerance',r=>r.checks[0].absoluteErrorMeters=.3,r=>r.checks[0].cloudDistanceMeters=9,r=>r.summary.heldOutCount=10,r=>r.statusScope='entire-building']) {
    const bad=structuredClone(report);mutate(bad);await assert.rejects(validateMeasurementReport(bad,c));
  }
});


test('boundary comparisons use the backend relative floating tolerance',async()=>{
  const c=cloud();c.points[1][0]=400.0000000001;
  c.measurementChecks=await measurementContract(c,[reading({distanceMeters:200})],{absoluteMeters:0,relative:1});
  const report=reportFromPython(c);assert.equal(report.status,'within-requested-tolerance');
  assert.equal((await validateMeasurementReport(report,c)).status,'within-requested-tolerance');
});


test('the same point cloud cannot borrow a dimensional report from a stale scene artifact',async()=>{
  const c=cloud();c.measurementChecks=await measurementContract(c,[reading()]);
  const report=reportFromPython(c),sceneSha='a'.repeat(64);
  report.sourceFiles={scene:{sha256:sceneSha}};
  assert.equal((await validateMeasurementReport(report,c,sceneSha)).status,'within-requested-tolerance');
  assert.equal((await validateMeasurementReport(report,c,sceneSha.toUpperCase())).status,'within-requested-tolerance');
  await assert.rejects(validateMeasurementReport(report,c,'b'.repeat(64)),/another scene artifact/);
  await assert.rejects(validateMeasurementReport(report,c,'not-a-hash'),/another scene artifact/);
  delete report.sourceFiles;
  await assert.rejects(validateMeasurementReport(report,c,sceneSha),/another scene artifact/);
  assert.equal((await validateMeasurementReport(report,c)).status,'within-requested-tolerance');
});
