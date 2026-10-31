import test from 'node:test';
import assert from 'node:assert/strict';
import {automaticReviewArtifact} from '../../brainsnn-r3f-app/public/world/artifact-review.mjs';
const visual=(name,size=1024)=>({name,size,kind:'visual'});
const evidence=name=>({name,size:1024,kind:'evidence'});

test('scene compilation opens the model when an evidence heatmap precedes it',()=>{
  const artifacts=[evidence('fit-heatmap.ply'),visual('scene.glb'),visual('sparse-preview.ply')];
  assert.deepEqual(automaticReviewArtifact({engine:'scene-usd',artifacts}),{type:'scene',index:1});
  assert.equal(artifacts[0].name,'fit-heatmap.ply','selection does not remove explicit evidence downloads');
});
test('reconstruction opens its visual PLY and never a similarly named evidence artifact',()=>{
  assert.deepEqual(automaticReviewArtifact({engine:'colmap-sparse',artifacts:[evidence('fit-heatmap.ply'),visual('sparse-preview.ply')]}),{type:'visual',index:1});
  assert.equal(automaticReviewArtifact({engine:'scene-usd',artifacts:[evidence('fit-heatmap.ply')]}),null);
});
test('observation results retain review priority over evidence and unsupported previews',()=>{
  assert.deepEqual(automaticReviewArtifact({engine:'observe',artifacts:[evidence('fit-heatmap.ply'),visual('too-large.ply',65*1024**2),{name:'observations.json',kind:'observations'}]}),{type:'observations',index:2});
  assert.deepEqual(automaticReviewArtifact({engine:'mesh',artifacts:[visual('model.glb')]}),{type:'scene',index:0});
  assert.equal(automaticReviewArtifact(null),null);
});
test('a photo localisation opens its result, and only from the locate-photo engine',()=>{
  assert.deepEqual(automaticReviewArtifact({engine:'locate-photo',artifacts:[evidence('localization.json')]}),{type:'localization',index:0});
  assert.equal(automaticReviewArtifact({engine:'locate-photo',artifacts:[]}),null);
  assert.equal(automaticReviewArtifact({engine:'colmap-sparse',artifacts:[evidence('localization.json')]}),null);
});
