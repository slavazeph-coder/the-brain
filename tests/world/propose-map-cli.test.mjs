import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {STRIDE,toPLY} from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';
import {importWorld} from '../../brainsnn-r3f-app/public/world/import-world.mjs';
import {planWorld,planningGate,usdScene,ROBOTS} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {parseMeasure} from '../../brainsnn-r3f-app/scripts/world-propose-map.mjs';
import {K,toColmap,room} from './fixtures/synthetic-room.mjs';

const CLI=fileURLToPath(new URL('../../brainsnn-r3f-app/scripts/world-propose-map.mjs',import.meta.url));

// The worker's two artifacts for the synthetic room: a binary PLY and reconstruction.json.
function artifacts(){
  const dir=mkdtempSync(join(tmpdir(),'world-cli-')),r=room(),cloud=new Float32Array(r.points.length*STRIDE);
  r.points.forEach((p,i)=>{cloud.set(p,i*STRIDE);cloud.set([.01,.01,.01,.6,.6,.6,1,0,0,0,1],i*STRIDE+3);});
  writeFileSync(join(dir,'sparse-preview.ply'),Buffer.from(toPLY(cloud)));
  writeFileSync(join(dir,'reconstruction.json'),JSON.stringify({...r.reconstruction,pipeline:'synthetic-fixture'}));
  return {dir,at:name=>join(dir,name)};
}
const run=(...args)=>spawnSync(process.execPath,[CLI,...args],{encoding:'utf8'});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');

test('the CLI turns worker artifacts into an unreviewed map that World Builder imports and gates',()=>{
  const {dir,at}=artifacts();
  try{
    const out=run('--points',at('sparse-preview.ply'),'--evidence',at('reconstruction.json'),'--out',at('world.json'),'--report',at('proposal.json'),'--name','Synthetic room');
    assert.equal(out.status,0,out.stderr);
    assert.match(out.stdout,/assumed 1\.35 m phone height.*Unreviewed/);
    const world=JSON.parse(readFileSync(at('world.json'),'utf8')),report=JSON.parse(readFileSync(at('proposal.json'),'utf8'));
    assert.equal(world.name,'Synthetic room');assert.equal(world.provenance,'observed');
    assert.equal(world.scaleReviewed,false);assert.equal(world.mapReviewed,false);
    assert.equal(world.geometrySource.kind,'reconstruction-proposal');
    assert.ok(Math.abs(report.metresPerUnit*K-1)<.03,`scale ${report.metresPerUnit}`);
    assert.equal(report.inputs.points.sha256,sha(at('sparse-preview.ply')));
    assert.equal(report.inputs.evidence.sha256,sha(at('reconstruction.json')));
    assert.equal(report.inputs.evidence.pipeline,'synthetic-fixture');
    // World Builder accepts the file, keeps the review gate closed and refuses simulation export until reviewed.
    const imported=importWorld(world,'world.json');
    assert.match(planningGate(imported),/scale/);
    assert.throws(()=>usdScene(imported));
    const reviewed={...imported,scaleReviewed:true,mapReviewed:true};
    assert.ok(planWorld(reviewed,{...ROBOTS.cleaner,margin:.05}).distance>5);
    assert.match(usdScene(reviewed),/PhysicsCollisionAPI/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a measured pair on the command line sets the scale exactly',()=>{
  const {dir,at}=artifacts(),a=toColmap([2,1,6]),b=toColmap([2.9,1,6]);
  try{
    const out=run('--points',at('sparse-preview.ply'),'--evidence',at('reconstruction.json'),'--out',at('world.json'),'--report',at('proposal.json'),'--measure',`${a};${b};0.9`);
    assert.equal(out.status,0,out.stderr);
    assert.match(out.stdout,/measured 0\.9 m scale/);
    const report=JSON.parse(readFileSync(at('proposal.json'),'utf8'));
    assert.equal(report.scaleSource,'measured-pair');
    assert.ok(Math.abs(report.metresPerUnit*K-1)<1e-9,`scale ${report.metresPerUnit}`);
    assert.deepEqual(report.measurement.a,a);
    assert.equal(JSON.parse(readFileSync(at('world.json'),'utf8')).scaleReviewed,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('bad invocations fail with a reason and write nothing',()=>{
  const {dir,at}=artifacts();
  try{
    const missing=run('--points',at('sparse-preview.ply'));
    assert.equal(missing.status,1);assert.match(missing.stderr,/Usage/);
    const both=run('--points',at('sparse-preview.ply'),'--evidence',at('reconstruction.json'),'--out',at('world.json'),'--camera-height','1.4','--measure','0,0,0;1,0,0;1');
    assert.equal(both.status,1);assert.match(both.stderr,/either --measure or --camera-height/);
    writeFileSync(at('bad.json'),'not json');
    const bad=run('--points',at('sparse-preview.ply'),'--evidence',at('bad.json'),'--out',at('world.json'));
    assert.equal(bad.status,1);assert.match(bad.stderr,/bad\.json is not JSON/);
    const far=run('--points',at('sparse-preview.ply'),'--evidence',at('reconstruction.json'),'--out',at('world.json'),'--camera-height','4');
    assert.equal(far.status,1);assert.match(far.stderr,/Camera height/);
    assert.throws(()=>readFileSync(at('world.json')),/ENOENT/);
  }finally{rmSync(dir,{recursive:true,force:true});}
  assert.throws(()=>parseMeasure('1,2;3,4,5;1'),/three comma-separated/);
  assert.throws(()=>parseMeasure('1,2,3;4,5,6'),/--measure must be/);
  assert.deepEqual(parseMeasure(' 1,2,3 ; 4,5,6 ; 0.9 '),{a:[1,2,3],b:[4,5,6],distance:.9});
});
