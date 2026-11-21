import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {runKitchenPin} from '../../brainsnn-r3f-app/public/world/kitchen-pin-physics.mjs';

const req=createRequire(new URL('../../brainsnn-r3f-app/package.json',import.meta.url));
const {default:init}=await import(pathToFileURL(req.resolve('@mujoco/mujoco')));
const mj=await init();

test('two friction pads lift a free rolling pin and release it on a real tray',()=>{
  const placed=runKitchenPin(mj,'grip'), miss=runKitchenPin(mj,'open');
  assert.equal(placed.schema,'brainsnn.kitchen-pin.v1');
  assert.equal(placed.engine.version,'4.0.1');
  assert.equal(placed.modelXML,miss.modelXML);
  assert.match(placed.modelXML,/<freejoint\/>/);
  assert.doesNotMatch(placed.modelXML,/<weld|mocap=/);
  assert.equal(placed.score.reason,'placed');
  assert.ok(placed.score.liftMeters>.1);
  assert.ok(placed.score.settledTraySeconds>1);
  assert.ok(placed.frames.some(f=>f.contacts.left && f.contacts.right && f.pin[2]>.1));
  assert.deepEqual(placed.frames.at(-1).contacts,{left:false,right:false,tray:true});
  assert.ok(Math.abs(placed.frames.at(-1).pin[0]-.18)<.01);
  assert.equal(miss.score.reason,'no-gripped-lift');
  assert.equal(miss.score.settledTraySeconds,0);
  assert.equal(miss.score.liftMeters,0);
  assert.equal(miss.frames.some(f=>f.contacts.tray),false);
  for(let i=0;i<120;i++) {
    assert.deepEqual(placed.frames[i].action.slice(0,2),miss.frames[i].action.slice(0,2));
    assert.deepEqual(miss.frames[i].action.slice(2),[0,0]);
  }
  assert.throws(()=>runKitchenPin(mj,'llm'));
});

test('exported kitchen observations at 20 Hz match independent replay of every applied action',()=>{
  const ep=runKitchenPin(mj);
  const model=mj.MjModel.from_xml_string(ep.modelXML), data=new mj.MjData(model);
  const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9);
  try {
    assert.equal(model.nu,4);
    assert.equal(ep.frames.length,121);
    assert.equal(ep.frames.at(-1).action,null);
    mj.mj_forward(model,data);
    const n=ep.sampleIntervalSeconds/ep.timestepSeconds;
    for (const f of ep.frames) {
      near(f.time,data.time);
      f.position.forEach((v,i)=>near(v,data.qpos[i]));
      f.velocity.forEach((v,i)=>near(v,data.qvel[i]));
      if(f.action) {
        data.ctrl.set(f.action);
        for(let k=0;k<n;k++) mj.mj_step(model,data);
      }
    }
  } finally {data.delete();model.delete();}
});
