import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSitToStand, compareVerticalForce } from '../../brainsnn-r3f-app/public/world/movement-trial.mjs';

const frames = angles => angles.map((kneeFlexionDegrees,i) => ({timeSeconds:i/10,kneeFlexionDegrees}));
const oneRise = [90,89,88,70,60,45,29,23,18,18];
const near = (actual, expected) => assert.ok(Math.abs(actual-expected) < 1e-9, `${actual} differs from ${expected}`);
function trace(kind, knots, offsetSeconds=0) {
  return {kind,label:kind+' fixture',offsetSeconds,samples:knots.map(([timeSeconds,verticalForceN])=>({timeSeconds,verticalForceN}))};
}

test('chair rise candidates require two sustained holds, report observed crossing times, and re-arm after sitting',()=>{
  const trial = analyzeSitToStand(frames([...oneRise, 45, 55, 75, ...oneRise, 21, 25, 29]));
  assert.equal(trial.repetitions.length,2);
  const first = trial.repetitions[0];
  assert.equal(first.startSeconds,.3);
  assert.equal(first.standSeconds,.6);
  near(first.durationSeconds,.3);
  assert.equal(first.excursionDegrees,41);
  assert.equal(trial.interruptions,0);
  assert.equal(trial.validFrames,trial.totalFrames);
  assert.equal(analyzeSitToStand(frames([18,18,20,25,23,18,18])).repetitions.length,0);
  assert.equal(analyzeSitToStand(frames([90,89,88,25,25,25])).repetitions.length,0);
  assert.equal(analyzeSitToStand(frames([90,89,88,65,45,25])).repetitions.length,0);
});

test('a missing, low-confidence or unsampled interval cannot connect the seated and standing poses',()=>{
  const ordinary=frames(oneRise);
  for (const modified of [
    ordinary.map((f,i)=>i===4?{...f,kneeFlexionDegrees:null}:f),
    ordinary.map((f,i)=>i===4?{...f,confidence:.2}:f),
    ordinary.map((f,i)=>i>=4?{...f,timeSeconds:f.timeSeconds+.7}:f),
  ]) {
    const result=analyzeSitToStand(modified);
    assert.equal(result.repetitions.length,0);
    assert.equal(result.interruptions,1);
  }
  assert.throws(()=>analyzeSitToStand(ordinary,{standingDegrees:90}));
  assert.throws(()=>analyzeSitToStand([...ordinary,ordinary.at(-1)]));
  assert.throws(()=>analyzeSitToStand([{timeSeconds:0,kneeFlexionDegrees:NaN}]));
  assert.throws(()=>analyzeSitToStand([{timeSeconds:0,kneeFlexionDegrees:84,confidence:-.1}]));
});

test('force integrals respect sign crossings and are invariant to uneven resampling',()=>{
  const reference=trace('measured',[[0,100],[.001,100],[.05,100],[.2,100],[2,100]]);
  const coarse=trace('modelled',[[0,90],[2,110]]);
  const dense=trace('modelled',[[0,90],[.02,90.2],[.1,91],[.4,94],[1,100],[1.8,108],[2,110]]);
  for (const model of [coarse,dense]) {
    const result=compareVerticalForce(model,reference);
    assert.equal(result.status,'compared');
    near(result.biasN,0);
    near(result.maeN,5);
    near(result.rmseN,Math.sqrt(100/3));
  }
});

test('compare only the shared force interval in video time and the chosen contact-matched window',()=>{
  const model=trace('modelled',[[-1,12],[1,16],[4,22]],2);
  const reference=trace('measured',[[1,10],[2,12],[3,14]],1);
  const common=compareVerticalForce(model,reference);
  assert.equal(common.startSeconds,2); assert.equal(common.endSeconds,4);
  near(common.biasN,4); near(common.maeN,4); near(common.rmseN,4);
  const restricted=compareVerticalForce(model,reference,{startSeconds:2.25,endSeconds:3});
  near(restricted.durationSeconds,.75); near(restricted.rmseN,4);
  for (const startSeconds of [4,5]) {
    const empty=compareVerticalForce(model,reference,{startSeconds});
    assert.equal(empty.status,'no-overlap'); assert.equal(empty.rmseN,null); assert.equal(empty.durationSeconds,0);
  }
});

test('comparisons require explicitly declared model/reference provenance and valid times',()=>{
  const knots=[[0,12],[1,13]], model=trace('modelled',knots), reference=trace('measured',knots);
  assert.throws(()=>compareVerticalForce(reference,model));
  assert.throws(()=>compareVerticalForce(model,reference,{endSeconds:0}));
  assert.throws(()=>compareVerticalForce(model,trace('measured',[[0,100],[0,110]])));
  assert.throws(()=>compareVerticalForce(model,trace('synthetic',knots)));
  const synthetic=trace('synthetic',knots);
  assert.throws(()=>compareVerticalForce(synthetic,synthetic));
  const example=compareVerticalForce(synthetic,synthetic,{synthetic:true});
  assert.equal(example.synthetic,true); assert.equal(example.rmseN,0);
});
