import test from 'node:test';
import assert from 'node:assert/strict';
import {hashBytes,jsonBytes,localizationBinding,validateLocalizationMap,validateLocalizationRecording,validateLocalizationSample,validateLocalizationTelemetry,validateMotionPreview} from '../../brainsnn-r3f-app/public/world/layer-preview.mjs';

// Authored contract fixtures. These are neither real scan captures nor motion
// demonstrations, and passing their checks makes no physical accuracy claim.
const digest='a'.repeat(64),other='b'.repeat(64);
const identity=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const sceneToMap=[[1,0,0,0],[0,0,-1,0],[0,1,0,0],[0,0,0,1]];
const runtime={engine:'lidar_localization_ros2',upstreamCommit:'6e21b7ed9e2e5c5ba1452eb63db5c9402862625b',origin:'authored-ros2-test'};
const copy=value=>structuredClone(value);
function mapFixture(){return {
  schema:'brainsnn.localization-map.v1',units:'m',mapSha256:digest,revisionSha256:other,
  source:{mode:'scan-local',scanSha256:digest,sceneSha256:null,cloudPointsSha256:null,componentRevision:null},
  frames:{sourceFrame:'right-handed-y-up',sceneFrame:'right-handed-y-up',mapFrame:'map',baseFrame:'base_link',sourceToScene:copy(identity),sceneToMap:copy(sceneToMap),sourceToMap:copy(sceneToMap)},
  measurement:{basis:'authored-test-geometry',units:'m',independentlyVerified:false},
  upstream:{repository:'https://github.com/rsasaki0109/lidar_localization_ros2',commit:runtime.upstreamCommit,ndtCommit:'17ce1e19831447a1f5bc5a68a4522fa8087f8933'},
  validation:{metricVerified:false,physicalRobotValidated:false,localizationValidated:false},
  artifacts:{'localization-map.pcd':{sha256:digest,bytes:1200},'localization-map.ply':{sha256:other,bytes:900}},
};}
function sampleFixture(offset=0){const timestampNs=String(1_000_000_000_000_000_000n+BigInt(offset)*100_000_000n);return {
  timestampNs,t:offset/10,position:[offset/20,0,0],quaternion:[0,0,0,1],covariance:Array(36).fill(0),state:'tracking',
  diagnostics:{level:0,failureCategory:'healthy',reinitializationRequested:false,statusTimestampNs:timestampNs,poseSource:'pcl_pose'},
};}
function recordingFixture(){return {
  schema:'brainsnn.localization-recording.v1',binding:localizationBinding(mapFixture(),digest),runtime:copy(runtime),
  validation:{physicalRobotValidated:false,accuracyVerified:false,producerAttested:false},samples:[sampleFixture(),sampleFixture(1)],
  rejectedMessages:0,stoppedReason:null,
};}
function telemetryFixture(){return {schema:'brainsnn.localization-telemetry.v1',binding:localizationBinding(mapFixture(),digest),runtime:copy(runtime),state:'tracking',reason:null,sample:sampleFixture()};}
function motionFixture(){return {
  schema:'brainsnn.motion-preview.v1',role:'motion-reference',units:'m',coordinate_frame:'right-handed-y-up',source_sha256:digest,
  runtime_commit:'cbdb2b494a2af82137bf9b6f15122d60167281c4',model_sha256:digest,configuration_sha256:other,csv_sha256:digest,
  robot_control_enabled:false,physics_executed:false,frame_count:2,fps:30,duration_seconds:1/30,frame_times_seconds:[0,1/30],
  human:{joint_names:['root','head'],parents:[-1,0],positions:[[[0,0,0],[0,1,0]],[[.1,0,0],[.1,1,0]]]},
  robot:{target:'unitree_g1',joint_names:['root','head'],parents:[-1,0],positions:[[[0,0,0],[0,.9,0]],[[.08,0,0],[.08,.9,0]]]},
  joint_order:Array.from({length:29},(_,i)=>`authored_joint_${i}`),joint_angles_rad:[Array(29).fill(0),Array(29).fill(.1)],
};}

test('map and recording retain the exact source, scene and map binding',()=>{
  const map=mapFixture(),expected=localizationBinding(map,digest),recording=recordingFixture();
  assert.equal(validateLocalizationMap(map),map);assert.equal(validateLocalizationRecording(recording,expected),recording);
  for(const key of Object.keys(expected)){
    const changed=copy(recording);changed.binding[key]=typeof expected[key]==='number'?expected[key]+1:expected[key]===null?digest:`${expected[key]}-changed`;
    assert.throws(()=>validateLocalizationRecording(changed,expected),/another map or revision/);
  }
  const extra=copy(recording);extra.binding.other=digest;assert.throws(()=>validateLocalizationRecording(extra,expected));
});
test('scene-bound maps preserve a composed rigid translation and revision',()=>{
  const map=mapFixture();map.source={mode:'scene-bound',scanSha256:digest,sceneSha256:other,cloudPointsSha256:digest,componentRevision:7};
  map.frames.sourceToScene[0][3]=3;map.frames.sourceToMap[0][3]=3;
  assert.equal(validateLocalizationMap(map),map);assert.equal(localizationBinding(map,other).componentRevision,7);
});
test('map transforms reject scale, reflection, bad composition and hidden scan-local registration',()=>{
  const mutations=[m=>{m.frames.sourceToScene[0][0]=2;},m=>{m.frames.sourceToMap[0][0]=-1;},m=>{m.frames.sourceToMap[1][3]=2;},m=>{m.frames.sourceToScene[0][3]=2;m.frames.sourceToMap[0][3]=2;},m=>{m.frames.sceneToMap[1][2]=1;},m=>{m.frames.sourceToScene[0][0]=NaN;}];
  for(const mutate of mutations){const map=mapFixture();mutate(map);assert.throws(()=>validateLocalizationMap(map));}
});
test('map imports reject borrowed scenes, artifact hash mismatches and physical certification claims',()=>{
  const mutations=[m=>{m.source.sceneSha256=other;},m=>{m.artifacts['localization-map.pcd'].sha256=other;},m=>{m.artifacts['localization-map.ply'].bytes=33*1024*1024;},m=>{m.measurement.independentlyVerified=true;},m=>{m.measurement.basis='generated-appearance';},m=>{m.measurement.units='cm';},m=>{m.upstream.commit='0'.repeat(40);},m=>{m.upstream.ndtCommit='0'.repeat(40);},...['metricVerified','physicalRobotValidated','localizationValidated'].map(k=>m=>{m.validation[k]=true;})];
  for(const mutate of mutations){const map=mapFixture();mutate(map);assert.throws(()=>validateLocalizationMap(map));}
});
test('recording timing preserves nanosecond strings and rejects stale or inconsistent timestamps',()=>{
  const mutations=[r=>{r.samples[0].timestampNs=1e18;},r=>{r.samples[1].timestampNs=r.samples[0].timestampNs;},r=>{r.samples[1].timestampNs='999999999999999999';},r=>{r.samples[1].t=.2;},r=>{r.samples[0].t=-1;}];
  for(const mutate of mutations){const r=recordingFixture();mutate(r);assert.throws(()=>validateLocalizationRecording(r,recordingFixture().binding));}
});
test('poses reject nonfinite points, unnormalized quaternions and negative covariance',()=>{
  const mutations=[s=>{s.position[0]=Infinity;},s=>{s.position=[0,0];},s=>{s.quaternion=[0,0,0,0];},s=>{s.quaternion[3]=1.01;},s=>{s.covariance[7]=-1;},s=>{s.covariance[0]=NaN;}];
  for(const mutate of mutations){const sample=sampleFixture();mutate(sample);assert.throws(()=>validateLocalizationSample(sample));}
});
test('tracking requires fresh, complete measured-pose diagnostics',()=>{
  const mutations=[s=>{delete s.diagnostics;},s=>{s.diagnostics.statusTimestampNs='999999999000000000';},s=>{s.diagnostics.level=2;},s=>{s.diagnostics.reinitializationRequested=true;},s=>{s.diagnostics.failureCategory='poor_alignment';},s=>{s.diagnostics.poseSource='odom_bridge_pose';},s=>{s.diagnostics.level=true;},s=>{s.diagnostics.failureCategory='x'.repeat(81);}];
  for(const mutate of mutations){const sample=sampleFixture();mutate(sample);assert.throws(()=>validateLocalizationSample(sample));}
});
test('odometry-only remains visibly distinct from measured tracking',()=>{
  const sample=sampleFixture();sample.state='odometry-only';sample.diagnostics.poseSource='odom_bridge_pose';assert.equal(validateLocalizationSample(sample),sample);
  for(const state of ['weak','lost','tracking']){const changed=copy(sample);changed.state=state;assert.throws(()=>validateLocalizationSample(changed));}
});
test('recordings reject unsupported runtimes and invented physical or producer validation',()=>{
  for(const key of ['physicalRobotValidated','accuracyVerified','producerAttested']){const r=recordingFixture();r.validation[key]=true;assert.throws(()=>validateLocalizationRecording(r,r.binding));}
  for(const key of ['engine','upstreamCommit','origin']){const r=recordingFixture();r.runtime[key]='unsupported';assert.throws(()=>validateLocalizationRecording(r,r.binding));}
});
test('telemetry is source-bound and cannot keep a healthy pose while stale or stopped',()=>{
  const v=telemetryFixture();assert.equal(validateLocalizationTelemetry(v,v.binding),v);
  for(const state of ['stale','stopped']){const stale=copy(v);stale.state=state;stale.sample=null;assert.equal(validateLocalizationTelemetry(stale,v.binding),stale);stale.sample=sampleFixture();assert.throws(()=>validateLocalizationTelemetry(stale,v.binding));}
  const otherMap=copy(v);otherMap.binding.mapSha256=other;assert.throws(()=>validateLocalizationTelemetry(otherMap,v.binding));
  const disagree=copy(v);disagree.state='weak';assert.throws(()=>validateLocalizationTelemetry(disagree,v.binding));
});
test('motion preview preserves timed human and G1 reference skeletons',()=>{
  const motion=motionFixture();assert.equal(validateMotionPreview(motion),motion);
});
test('motion imports reject malformed skeletons, timing, dimensions and nonfinite data',()=>{
  const mutations=[m=>{m.human.parents=[1,0];},m=>{m.robot.parents=[-1,1];},m=>{m.human.joint_names=['root','root'];},m=>{m.robot.positions[0][0][1]=NaN;},m=>{m.robot.positions.pop();},m=>{m.joint_angles_rad[0].pop();},m=>{m.frame_times_seconds[1]=1;},m=>{m.duration_seconds=3;},m=>{m.fps=0;}];
  for(const mutate of mutations){const motion=motionFixture();mutate(motion);assert.throws(()=>validateMotionPreview(motion));}
});
test('motion imports reject changed runtime/profile and unsupported execution claims',()=>{
  const mutations=[m=>{m.runtime_commit=digest;},m=>{m.robot.target='other_robot';},m=>{m.source_sha256='missing';},m=>{m.coordinate_frame='right-handed-z-up';},m=>{m.robot_control_enabled=true;},m=>{m.physics_executed=true;}];
  for(const mutate of mutations){const motion=motionFixture();mutate(motion);assert.throws(()=>validateMotionPreview(motion));}
});
test('local JSON imports enforce byte limits and retain exact SHA-256',async()=>{
  const bytes=new TextEncoder().encode('{"ok":true}');assert.deepEqual(jsonBytes(bytes.buffer,20),{ok:true});assert.throws(()=>jsonBytes(bytes.buffer,2));assert.throws(()=>jsonBytes(Uint8Array.from([255]).buffer));
  assert.equal(await hashBytes(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
