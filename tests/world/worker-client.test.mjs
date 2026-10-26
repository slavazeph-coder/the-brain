import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
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

test('preview deadline cancels a real stalled HTTP body and cleans up ticket/preview timers',async(t)=>{
  const timers=new Map(),realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
    const timer=realSetTimeout(callback,delay,...args);
    if(delay===60000)timers.set(timer,{callback,cleared:false});
    return timer;
  });
  t.mock.method(globalThis,'clearTimeout',timer=>{if(timers.has(timer))timers.get(timer).cleared=true;return realClearTimeout(timer);});
  let beginStream;const started=new Promise(resolve=>{beginStream=resolve;});
  const server=createServer((request,response)=>{
    if(request.url.endsWith('/ticket')){
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end(JSON.stringify({url:'/v1/download/stalled'}));
    }else{
      response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':String(bytes.length)});
      response.write(bytes.slice(0,1));beginStream(); // Deliberately never completes.
    }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const client=new WorkerClient(`http://127.0.0.1:${server.address().port}`,'s'.repeat(40));
    const pending=client.previewArtifact({id,artifacts:[artifact]},0);
    const rejected=assert.rejects(pending,error=>error.name==='AbortError'||error.name==='TimeoutError');
    await started;
    const active=[...timers.values()].filter(timer=>!timer.cleared);
    assert.equal(active.length,1,'ticket timer is cleaned before the artifact body begins');
    active[0].callback(); // Fire the actual 60-second deadline without waiting a minute.
    await rejected;
    assert.equal(timers.size,2,'the ticket request and whole preview each have a deadline');
    assert.ok([...timers.values()].every(timer=>timer.cleared));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('caller cancellation stops an in-flight artifact fetch and removes its relay',async(t)=>{
  const client=makeClient(),caller=new AbortController();
  client.download=async()=> 'https://worker.example/prefix/v1/download/ticket';
  const removed=t.mock.method(caller.signal,'removeEventListener');
  let beginFetch;const started=new Promise(resolve=>{beginFetch=resolve;});
  t.mock.method(globalThis,'fetch',async(_url,{signal})=>new Promise((_,reject)=>{
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});beginFetch();
  }));
  const pending=client.previewArtifact({id,artifacts:[artifact]},0,caller.signal);
  const rejected=assert.rejects(pending,error=>error.name==='AbortError');
  await started;caller.abort();await rejected;
  assert.equal(removed.mock.callCount(),1);
  assert.equal(removed.mock.calls[0].arguments[0],'abort');
  await assert.rejects(client.previewArtifact({id,artifacts:[artifact]},0,caller.signal),error=>error.name==='AbortError');
});

test('rejected HTTP status cancels an unread artifact stream', {timeout:3000}, async()=>{
  let closed;const bodyClosed=new Promise(resolve=>{closed=resolve;});
  const server=createServer((_request,response)=>{
    response.on('close',closed);
    response.writeHead(503,{'Content-Type':'application/octet-stream'});
    response.write('unavailable'); // A broken worker never closes this error body.
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const client=makeClient();
    client.download=async()=>`http://127.0.0.1:${server.address().port}/v1/download/error`;
    await assert.rejects(client.previewArtifact({id,artifacts:[artifact]},0),/download failed/);
    let deadline;
    try{await Promise.race([bodyClosed,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Unread error body was not cancelled.')),1000);})]);}
    finally{clearTimeout(deadline);}
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('a worker that refuses an upload says why, including a validation refusal from an older worker',async()=>{
  // Workers from before October 25 cap uploads at 200 MiB in request validation, which answers with a list of errors.
  const replies=[{status:422,body:{detail:[{type:'less_than_equal',loc:['body','size'],msg:'Input should be less than or equal to 209715200'}]}},
                 {status:422,body:{detail:'Photos are limited to 200 MiB; videos to 2 GiB.'}},{status:500,body:{}}];
  const server=createServer((request,response)=>{const reply=replies.shift();response.writeHead(reply.status,{'Content-Type':'application/json'});response.end(JSON.stringify(reply.body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const client=new WorkerClient(`http://127.0.0.1:${server.address().port}`,'s'.repeat(40));
    await assert.rejects(client.upload(file,'video'),/^Error: Worker refused the request: Input should be less than or equal to 209715200$/);
    await assert.rejects(client.upload(file,'image'),/^Error: Photos are limited to 200 MiB; videos to 2 GiB\.$/);
    await assert.rejects(client.upload(file,'image'),/Worker request failed \(500\)/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
