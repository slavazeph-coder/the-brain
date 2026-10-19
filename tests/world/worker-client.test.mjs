import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WorkerClient} from '../../brainsnn-r3f-app/public/world/worker-client.mjs';

const id='a'.repeat(32);
const makeClient=()=>new WorkerClient('https://worker.example/prefix','s'.repeat(40));
const file=new File(['a real capture'],'capture.png',{type:'image/png'});

test('upload rejects invalid remote offsets, sizes and chunk limits before sending source bytes',async()=>{
  for(const entry of [
    {offset:-1,size:file.size}, {offset:.5,size:file.size},
    {offset:file.size+1,size:file.size}, {offset:0,size:file.size+1},
  ]){
    const client=makeClient(),calls=[];
    client.request=async(path,options)=>{calls.push(options.method);return{id,...entry};};
    await assert.rejects(client.upload(file,'image'),/offset or size/);
    assert.deepEqual(calls,['POST']);
  }
  for(const chunk_bytes of [0,-1,.1,Infinity,'4']){
    const client=makeClient();client.caps={limits:{chunk_bytes}};
    client.request=async()=>({id,offset:0,size:file.size});
    await assert.rejects(client.upload(file,'image'),/chunk limit/);
  }
});

test('same-file resume sends only remaining bytes with explicit offsets',async()=>{
  const client=makeClient(),chunks=[],progress=[];
  client.caps={limits:{chunk_bytes:4}};client.uploads.set(file,{id});
  client.request=async(path,options={})=>{
    if(options.method!=='PUT')return{id,offset:4,size:file.size};
    const offset=Number(new URL('https://test'+path).searchParams.get('offset'));
    chunks.push({offset,text:await options.body.text()});
    return{offset:offset+options.body.size};
  };
  assert.equal(await client.upload(file,'image',undefined,p=>progress.push(p)),id);
  assert.equal(chunks.map(x=>x.text).join(''),(await file.text()).slice(4));
  assert.deepEqual(chunks.map(x=>x.offset),[4,8,12]);
  assert.equal(progress.at(-1),1);
});

test('source upload detects missing progress instead of looping',async()=>{
  const client=makeClient();
  client.request=async(path,options)=>options.method==='POST'?{id,offset:0,size:file.size}:{offset:0};
  await assert.rejects(client.upload(file,'image'),/offset mismatch/);
});

test('download tickets stay on the configured worker path',async()=>{
  for(const url of ['https://elsewhere.example/v1/download/token','https://worker.example/other/token','https://worker.example/prefix/v1/download/../../other']){
    const client=makeClient();client.request=async()=>({url});
    await assert.rejects(client.download(id,0),/untrusted/);
  }
  const client=makeClient();client.request=async()=>({url:'/prefix/v1/download/ticket'});
  assert.equal(await client.download(id,0),'https://worker.example/prefix/v1/download/ticket');
});

const bytes=new TextEncoder().encode('ply\nformat ascii 1.0\n');
const artifact={name:'preview.ply',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
test('preview downloads verify declared size and hash and never forward the operator token',async(t)=>{
  const client=makeClient();client.download=async()=> 'https://worker.example/prefix/v1/download/ticket';
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.headers,undefined);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    return new Response(bytes);
  });
  assert.deepEqual(new Uint8Array(await client.previewArtifact({id,artifacts:[artifact]},0)),bytes);
});

test('artifact previews fail closed for changed, truncated and oversized bytes',async(t)=>{
  const client=makeClient();client.download=async()=> 'https://worker.example/prefix/v1/download/ticket';
  const mock=t.mock.method(globalThis,'fetch',async()=>new Response(bytes));
  for(const [entry,pattern] of [
    [{...artifact,size:0},/64 MiB/],
    [{...artifact,size:64*1024**2+1},/64 MiB/],
    [{...artifact,sha256:'invalid'},/integrity hash/],
    [{...artifact,size:bytes.length-1},/exceeded/],
    [{...artifact,size:bytes.length+1},/incomplete/],
    [{...artifact,sha256:'0'.repeat(64)},/integrity check/],
  ])await assert.rejects(client.previewArtifact({id,artifacts:[entry]},0),pattern);
  assert.equal(mock.mock.callCount(),3,'invalid manifests are rejected before an artifact fetch');
});
