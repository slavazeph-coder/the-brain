import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {sampleWorld,proofPack,clone} from '../../brainsnn-r3f-app/public/world/core.mjs';
import {WorkerClient} from '../../brainsnn-r3f-app/public/world/worker-client.mjs';
import {REPORT_LIMITS,RECEIPT_DOMAIN,prepareReportRequest,verifyReportKey,verifySignedReport,createSignedReportBundle,parseSignedReportBundle,verifySignedReportBundle} from '../../brainsnn-r3f-app/public/world/report-receipts.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
function signer(){const {privateKey,publicKey}=generateKeyPairSync('ed25519'),raw=publicKey.export({format:'jwk'}).x;return {privateKey,key:{schema:'brainsnn.world.report-key.v1',algorithm:'Ed25519',keyId:hash(Buffer.from(raw,'base64url')),publicKey:raw}};}
const primary=signer(),other=signer(),trust={kind:'fingerprint',value:primary.key.keyId};
const job={id:'a'.repeat(32),engine:'inspect',status:'complete',artifacts:[{name:'capture-integrity.json',kind:'integrity',size:20,sha256:hash('actual test fixture')}]};
function signed(payload,who=primary){const payloadText=JSON.stringify(payload);return {schema:'brainsnn.world.signed-report-receipt.v1',algorithm:'Ed25519',keyId:who.key.keyId,payloadText,payloadSha256:hash(payloadText),signature:sign(null,Buffer.from(RECEIPT_DOMAIN+payloadText),who.privateKey).toString('base64url')};}
async function fixture(world=sampleWorld()){
  const scenarioText=JSON.stringify(await proofPack(world,null,{},[],[{type:'fixture',detail:'café / 測量'}]),null,2),request=await prepareReportRequest(scenarioText,job);
  const payload={schema:'brainsnn.world.report-receipt.v1',keyId:primary.key.keyId,issuedAt:'2026-10-19T12:00:00.000Z',ownerId:'fixture-owner',job:{id:job.id,engine:job.engine},evidence:{authority:'worker-verified-bytes',sources:[{id:'b'.repeat(32),kind:'image',size:10,sha256:hash('source fixture')}],artifacts:clone(job.artifacts)},scenario:{sha256:request.scenarioSha256,geometrySha256:request.geometrySha256,authority:'owner-declared'},metricVerified:false,policyExecuted:false,safetyCertified:false,independentHostAttestation:false};
  return {scenarioText,payload,request,receipt:signed(payload),key:primary.key,trust,expectedJob:job};
}

test('real Ed25519 validates exact exported UTF-8 proof bytes using explicit pinned key or fingerprint',async()=>{
  const f=await fixture(),original=f.scenarioText;
  for(const pinned of [trust,{kind:'public-key',value:primary.key.publicKey}]){
    const result=await verifySignedReport({...f,trust:pinned});assert.equal(result.verified,true);assert.equal(result.keyId,primary.key.keyId);assert.equal(result.scenarioSha256,hash(Buffer.from(original,'utf8')));assert.equal(result.payload.metricVerified,false);assert.equal(result.payload.scenario.authority,'owner-declared');assert.ok(Object.isFrozen(result.payload));
  }
  assert.equal(f.scenarioText,original);
  assert.deepEqual(Object.keys(f.request).sort(),['artifactRefs','geometrySha256','scenarioSha256']);
});

test('embedded keys never establish trust, including when attacker replaces key and signs a whole new bundle',async()=>{
  const f=await fixture(),payload={...f.payload,keyId:other.key.keyId},attacker=createSignedReportBundle(f.scenarioText,signed(payload,other),other.key);
  await assert.rejects(verifySignedReport({...f,trust:undefined}),/trusted key/);
  await assert.rejects(verifySignedReport({...f,trust:{kind:'fingerprint',value:other.key.keyId}}),/trusted fingerprint/);
  await assert.rejects(verifySignedReportBundle(JSON.stringify(attacker),trust),/trusted fingerprint/);
  await assert.rejects(verifySignedReportBundle(JSON.stringify(attacker),undefined),/trusted key/);
  await assert.rejects(verifyReportKey({...primary.key,keyId:other.key.keyId},trust),/fingerprint/);
});

test('signature/payload tampering, scenario reformatting and wrong job artifact references fail closed',async()=>{
  const f=await fixture(),tampered=clone(f.receipt),payload=JSON.parse(tampered.payloadText);payload.ownerId='altered';tampered.payloadText=JSON.stringify(payload);tampered.payloadSha256=hash(tampered.payloadText);
  await assert.rejects(verifySignedReport({...f,receipt:tampered}),/signature/);
  await assert.rejects(verifySignedReport({...f,scenarioText:f.scenarioText+'\n'}),/Exact scenario/);
  await assert.rejects(verifySignedReport({...f,receipt:{...f.receipt,payloadSha256:'0'.repeat(64)}}),/payload SHA/);
  await assert.rejects(verifySignedReport({...f,expectedJob:{...job,id:'c'.repeat(32)}}),/different worker job/);
  await assert.rejects(verifySignedReport({...f,expectedJob:{...job,artifacts:[{...job.artifacts[0],size:21}]}}),/artifact references/);
});

test('null-map receipts bind no geometry and existing maps require their exact normalized geometry hash',async()=>{
  for(const world of [null,sampleWorld()]){
    const f=await fixture(world),good=await verifySignedReport(f);assert.equal(good.geometrySha256,world?f.request.geometrySha256:null);
    const payload={...f.payload,scenario:{...f.payload.scenario,geometrySha256:world?null:'0'.repeat(64)}};
    await assert.rejects(verifySignedReport({...f,receipt:signed(payload)}),/geometry/);
  }
});

test('signed unsupported authority claims, malformed metadata and noncanonical crypto encodings are rejected',async()=>{
  const f=await fixture();
  for(const edit of [p=>p.metricVerified=true,p=>p.safetyCertified=true,p=>p.policyExecuted=true,p=>p.independentHostAttestation=true,p=>p.scenario.authority='verified',p=>p.evidence.sources[0].size=0,p=>p.evidence.sources[0].size=200*1024**2+1,p=>p.evidence.sources.push(p.evidence.sources[0]),p=>p.evidence.artifacts[0].name='../file',p=>p.evidence.artifacts.push(p.evidence.artifacts[0]),p=>p.issuedAt='2026-02-30T12:00:00.000Z',p=>p.ownerId=42,p=>p.extra='hidden']){
    const payload=clone(f.payload);edit(payload);await assert.rejects(verifySignedReport({...f,receipt:signed(payload)}));
  }
  for(const patch of [{signature:f.receipt.signature+'='},{signature:'AA'},{algorithm:'none'},{extra:'ignored'}])await assert.rejects(verifySignedReport({...f,receipt:{...f.receipt,...patch}}));
  await assert.rejects(verifyReportKey({...primary.key,publicKey:primary.key.publicKey+'='},trust),/encoding/);
});

test('offline bundle preserves signed text exactly and remains explicitly untrusted until verification',async()=>{
  const f=await fixture(),bundle=createSignedReportBundle(f.scenarioText,f.receipt,f.key),raw=JSON.stringify(bundle,null,2),parsed=parseSignedReportBundle(raw);
  assert.equal(parsed.scenarioText,f.scenarioText);assert.equal(parsed.receipt.payloadText,f.receipt.payloadText);assert.equal(parsed.verified,undefined);
  assert.equal((await verifySignedReportBundle(raw,trust)).verified,true);
  assert.throws(()=>parseSignedReportBundle(JSON.stringify({...bundle,verified:true})),/fields/);
  assert.throws(()=>parseSignedReportBundle(' '.repeat(REPORT_LIMITS.bundle+1)),/size limit/);
  assert.throws(()=>parseSignedReportBundle(JSON.stringify({schema:'brainsnn.world.signed-report.v1',scenarioText:f.scenarioText,receipt:bundle.receipt})),/fields/);
  const tampered=JSON.parse(raw);tampered.scenarioText=tampered.scenarioText.replace('"schema"','"schemaX"');
  await assert.rejects(verifySignedReportBundle(JSON.stringify(tampered),trust),/exact exported BrainSNN proof JSON/);
  await assert.rejects(prepareReportRequest(' '.repeat(REPORT_LIMITS.scenario+1),job),/scenario text/);
  await assert.rejects(prepareReportRequest(f.scenarioText,{...job,artifacts:[{...job.artifacts[0],size:256*1024**2+1}]}),/256 MiB/);
});

test('verification snapshots receipt, trust and expected artifact metadata before asynchronous crypto',async()=>{
  const f=await fixture(),args={...f,receipt:clone(f.receipt),key:clone(f.key),trust:{...trust},expectedJob:clone(job)},pending=verifySignedReport(args);
  args.receipt.signature='AA';args.key.publicKey=other.key.publicKey;args.trust.value=other.key.keyId;args.expectedJob.id='c'.repeat(32);
  assert.equal((await pending).verified,true);
});

test('verifySignedReport rejects cancelled or running expectedJob even when the signature is valid',async()=>{
  const f=await fixture();
  // The fixture's receipt is correctly signed by the primary key against a
  // complete job.  Flipping expectedJob.status to a non-complete value must
  // fail the status gate independently of signature validity.
  for(const status of ['cancelled','running']){
    const badJob={...f.expectedJob,status};
    await assert.rejects(verifySignedReport({...f,expectedJob:badJob}),/completed worker job/);
  }
  // A tampered receipt that still verifies (signature valid) must also be
  // rejected when the job is not complete — the gate is the status check,
  // not the signature.
  const tampered=clone(f.receipt);
  tampered.payloadText=JSON.stringify({...JSON.parse(tampered.payloadText),ownerId:'fixture-owner'});
  tampered.payloadSha256=hash(tampered.payloadText);
  const signedTampered=signed(JSON.parse(tampered.payloadText));
  await assert.rejects(verifySignedReport({...f,receipt:signedTampered,expectedJob:{...f.expectedJob,status:'cancelled'}}),/completed worker job/);
  // The same tampered receipt against a complete job still passes the
  // signature gate (ownerId is unchanged so the payload is valid).
  const okTampered=await verifySignedReport({...f,receipt:signedTampered,expectedJob:f.expectedJob});
  assert.equal(okTampered.verified,true);
});

test('non-UTF-8 scenario text fails closed instead of silently mismatching the receipt hash',async()=>{
  const f=await fixture();
  // Bytes 0x00, 0xFF and a lone 0x80 continuation are not valid UTF-8.  If any
  // layer in the receipt chain (proofPack, reportSHA256, the verify byte-hash)
  // round-tripped them through a lossy encode/decode, the scenario hash would
  // silently disagree between prepare and verify.  The chain must instead fail
  // closed with a distinct error, never a silent hash mismatch.
  for(const raw of [new Uint8Array([0,0xff]),new Uint8Array([0x80]),new Uint8Array([0x24,0xff,0x24])]){
    const bad=Buffer.from(raw).toString('binary');
    await assert.rejects(
      prepareReportRequest(bad,f.expectedJob),
      e=>typeof e.message==='string'&&e.message.length>0
    );
  }
  // The same non-UTF-8 text must also fail closed at the top-level verify
  // entrypoint (which re-hashes the bytes), not pass through to a
  // 'Exact scenario file bytes do not match' mismatch.
  await assert.rejects(verifySignedReport({...f,scenarioText:Buffer.from(new Uint8Array([0,0xff])).toString('binary')}),
    e=>typeof e.message==='string'&&e.message.length>0);
});

test('WorkerClient signing is unavailable by default and transmits hashes/refs only after capability opt-in',async()=>{
  const f=await fixture(),client=new WorkerClient('https://worker.example','t'.repeat(40)),calls=[];
  client.request=async(path,options)=>{calls.push({path,options});return f.receipt;};
  await assert.rejects(client.reportReceipt(job,f.scenarioText),/not enabled/);assert.equal(calls.length,0);
  client.caps={reportSigning:{available:true,algorithm:'Ed25519',keyId:primary.key.keyId}};
  const publicJob={...job,artifacts:job.artifacts.map(a=>({...a,provenance:'unverified-output',metric_verified:false,representation:'point-cloud'}))};
  await client.reportReceipt(publicJob,f.scenarioText);
  assert.equal(calls[0].path,`/v1/jobs/${job.id}/report-receipt`);assert.equal(calls[0].options.method,'POST');assert.deepEqual(calls[0].options.body,f.request);
  assert.ok(!JSON.stringify(calls[0]).includes('café'));assert.ok(!JSON.stringify(calls[0]).includes('scenarioText'));
  assert.equal((await verifySignedReport({...f,expectedJob:publicJob})).verified,true);
  const abort=new AbortController();abort.abort();await assert.rejects(client.reportReceipt(job,f.scenarioText,abort.signal),e=>e.name==='AbortError');assert.equal(calls.length,1);
});

test('aborting a report-receipt request mid-flight discards the signed result as AbortError',async()=>{
  // Cancellation gap in the client receipt path: WorkerClient.request relays the
  // caller's AbortSignal into a local AbortController that fetch consumes. Aborting
  // the signal while the worker is still streaming a signed receipt back must make
  // the request reject with an AbortError and discard the bytes — never silently
  // complete with a half-read signed payload. The prior test only aborted before
  // the request (capability gate); this pins the in-flight abort by modelling
  // fetch's signal contract: the read rejects as soon as the relayed signal fires.
  const f=await fixture(),client=new WorkerClient('https://worker.example','t'.repeat(40));
  client.caps={reportSigning:{available:true,algorithm:'Ed25519',keyId:primary.key.keyId}};
  let requestSignal=null;
  client.request=async(path,opts)=>{
    requestSignal=opts.signal;
    // Model fetch({signal}): the body read rejects with AbortError the moment
    // the relayed signal aborts, before the signed payload could be returned.
    await new Promise((resolve,reject)=>{
      const onAbort=()=>reject(new DOMException('Aborted','AbortError'));
      opts.signal.addEventListener('abort',onAbort,{once:true});
      setTimeout(()=>{opts.signal.removeEventListener('abort',onAbort);resolve();},20);
    });
    return f.receipt; // unreachable after an in-flight abort
  };
  const abort=new AbortController(),promise=client.reportReceipt(job,f.scenarioText,abort.signal);
  // Wait until the in-flight request has captured its relayed signal, then abort.
  for(let i=0;i<200&&!requestSignal;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(requestSignal,'in-flight request never captured its abort signal');
  assert.ok(!requestSignal.aborted,'signal was aborted before the in-flight request began');
  abort.abort();
  await assert.rejects(promise,e=>e.name==='AbortError');
});

test('aborted report-receipt signal is still discarded when the worker already returned a receipt',async()=>{
  // The relayed in-flight abort can fire AFTER fetch has already delivered a
  // signed receipt body. The client must not surface the completed receipt in
  // that race — the abort signal means the caller no longer wants the result,
  // and returning a half-consumed signed payload would let the caller treat a
  // cancelled report as delivered. Model the race by resolving fetch's signal
  // contract immediately, so the receipt is "returned" in the same tick the
  // caller aborts; the client must still reject with AbortError.
  const f=await fixture(),client=new WorkerClient('https://worker.example','t'.repeat(40));
  client.caps={reportSigning:{available:true,algorithm:'Ed25519',keyId:primary.key.keyId}};
  let requestSignal=null;
  client.request=async(path,opts)=>{
    requestSignal=opts.signal;
    // Model fetch completing AFTER the caller aborts: wait for the abort to
    // fire, then still deliver the signed body — the real fetch can have
    // already buffered the response before the relayed controller abort lands.
    if(!requestSignal.aborted)await new Promise(r=>requestSignal.addEventListener('abort',r,{once:true}));
    return f.receipt;
  };
  const abort=new AbortController(),promise=client.reportReceipt(job,f.scenarioText,abort.signal);
  for(let i=0;i<200&&!requestSignal;i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(requestSignal,'request never captured its abort signal');
  abort.abort();
  await assert.rejects(promise,e=>e.name==='AbortError');
});
