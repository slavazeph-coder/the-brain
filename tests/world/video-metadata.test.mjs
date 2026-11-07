import test from 'node:test';
import assert from 'node:assert/strict';
import {videoResolutionIssue} from '../../brainsnn-r3f-app/public/world/video-metadata.mjs';

test('undersized video gives exact dimensions for reconstruction without disabling observations',()=>{
  const source={kind:'video',name:'walkthrough.mov',width:224,height:128};
  for(const engine of ['colmap-sparse','colmap-dense-cpu','mapanything-apache','lingbot-map-stream','scene-usd']) {
    assert.match(videoResolutionIssue(source,engine),/224×128.*256 pixels on the shorter side/);
  }
  assert.equal(videoResolutionIssue(source,'world-observations'),null);
  assert.equal(videoResolutionIssue({...source,kind:'image'}),null);
});

test('256 px boundary and portrait video use the shorter side',()=>{
  assert.equal(videoResolutionIssue({kind:'video',width:256,height:448}),null);
  assert.match(videoResolutionIssue({kind:'video',width:255,height:448}),/255×448/);
  assert.match(videoResolutionIssue({kind:'video',width:448,height:255}),/448×255/);
});

test('unknown browser metadata leaves codec and dimensions to the worker',()=>{
  for(const width of [null,undefined,0,NaN,Infinity,'224']) {
    assert.equal(videoResolutionIssue({kind:'video',width,height:128}),null);
  }
});
