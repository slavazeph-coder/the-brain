/** Verify a worker statement against separately trusted keys, never against an embedded key alone. */
import {geometrySHA256} from './measurement-evidence.mjs';

export const REPORT_LIMITS=Object.freeze({scenario:4*1024**2,receipt:64*1024,key:4096,bundle:9*1024**2});
export const RECEIPT_DOMAIN='brainsnn.world.report-receipt.v1\n';
const SHA=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{32}$/;
const encode=value=>new TextEncoder().encode(value);
function fail(message){throw new Error(message);}
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))fail(`Invalid ${label} fields.`);}
function text(value,max,label){if(typeof value!=='string'||!value.length||value.length>max)fail(`Invalid ${label}.`);return value;}
function hash(value,label){if(typeof value!=='string'||!SHA.test(value))fail(`Invalid ${label} SHA-256.`);return value;}
function identifier(value,label){if(typeof value!=='string'||!ID.test(value))fail(`Invalid ${label} identifier.`);return value;}
function bytesBound(value,max,label){if(encode(value).byteLength>max)fail(`${label} exceeds its size limit.`);}
function jsonBound(value,max,label){bytesBound(JSON.stringify(value),max,label);}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export async function reportSHA256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
function decodeBase64url(value,size,label){
  if(typeof value!=='string'||!new RegExp(`^[A-Za-z0-9_-]{${Math.ceil(size*8/6)}}$`).test(value))fail(`Invalid ${label} encoding.`);
  const decoded=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  const canonical=btoa(String.fromCharCode(...decoded)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  if(decoded.length!==size||canonical!==value)fail(`Invalid ${label} bytes.`);return decoded;
}
function parseScenario(scenarioText){
  text(scenarioText,REPORT_LIMITS.scenario,'scenario text');bytesBound(scenarioText,REPORT_LIMITS.scenario,'Scenario');
  let scenario;try{scenario=JSON.parse(scenarioText);}catch{fail('Scenario text is not valid JSON.');}
  if(!scenario||scenario.schema!=='brainsnn.proof.v1'||!Object.hasOwn(scenario,'world'))fail('Use the exact exported BrainSNN proof JSON.');
  if(scenario.world!==null&&(!scenario.world||typeof scenario.world!=='object'||Array.isArray(scenario.world)))fail('Invalid scenario world.');
  return scenario;
}
function artifact(value){
  exact(value,['name','kind','size','sha256'],'artifact');
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(text(value.name,101,'artifact name'))||value.name==='.'||value.name==='..')fail('Invalid artifact name.');
  text(value.kind,40,'artifact kind');if(!Number.isSafeInteger(value.size)||value.size<1||value.size>3*1024**3)fail('Invalid artifact size.');hash(value.sha256,'artifact');
  return value;
}
function artifacts(values){if(!Array.isArray(values)||values.length<1||values.length>32)fail('Use 1–32 job artifacts.');values.forEach(artifact);if(new Set(values.map(v=>v.name)).size!==values.length)fail('Duplicate artifact names.');return values;}
function checkedJob(job){
  if(!job||job.status!=='complete')fail('A completed worker job is required.');identifier(job.id,'job');text(job.engine,64,'engine');
  if(!Array.isArray(job.artifacts)||job.artifacts.some(a=>!a||typeof a!=='object'))fail('Invalid job artifacts.');
  // Public job manifests also carry visual metadata; only these signed byte fields cross this boundary.
  const selected=job.artifacts.map(({name,kind,size,sha256})=>({name,kind,size,sha256}));artifacts(selected);
  return {id:job.id,engine:job.engine,status:job.status,artifacts:selected};
}
export async function prepareReportRequest(scenarioText,job){
  const scenario=parseScenario(scenarioText),selected=checkedJob(job);
  if(selected.artifacts.reduce((sum,a)=>sum+a.size,0)>256*1024**2)fail('Report receipts currently support at most 256 MiB of referenced artifacts.');
  const artifactRefs=selected.artifacts.map(({name,sha256})=>({name,sha256}));
  const body={scenarioSha256:await reportSHA256(encode(scenarioText)),geometrySha256:scenario.world===null?null:await geometrySHA256(scenario.world),artifactRefs};
  jsonBound(body,16*1024,'Report request');return body;
}
function checkedKey(key){
  exact(key,['schema','algorithm','keyId','publicKey'],'report key');jsonBound(key,REPORT_LIMITS.key,'Report key');
  if(key.schema!=='brainsnn.world.report-key.v1'||key.algorithm!=='Ed25519')fail('Unsupported report signing key.');hash(key.keyId,'key');
  return decodeBase64url(key.publicKey,32,'public key');
}
export async function verifyReportKey(key,trust){
  // Explicit trust is a required separate argument, including for offline bundles.
  exact(trust,['kind','value'],'independently trusted key');
  trust={...trust};key={...key};
  const raw=checkedKey(key),keyId=await reportSHA256(raw);
  if(keyId!==key.keyId)fail('Discovered public key fingerprint does not match its key ID.');
  if(trust.kind==='public-key'){
    const expected=decodeBase64url(trust.value,32,'trusted public key');
    if(await reportSHA256(expected)!==keyId)fail('Public key does not match the separately trusted key.');
  }else if(trust.kind==='fingerprint'){
    if(hash(trust.value,'trusted fingerprint')!==keyId)fail('Public key does not match the separately trusted fingerprint.');
  }else fail('Supply a separately trusted public key or fingerprint.');
  return {raw,keyId};
}
function checkedReceipt(receipt){
  exact(receipt,['schema','algorithm','keyId','payloadText','payloadSha256','signature'],'signed receipt');jsonBound(receipt,REPORT_LIMITS.receipt,'Receipt');
  if(receipt.schema!=='brainsnn.world.signed-report-receipt.v1'||receipt.algorithm!=='Ed25519')fail('Unsupported signed receipt.');
  hash(receipt.keyId,'key');hash(receipt.payloadSha256,'payload');text(receipt.payloadText,REPORT_LIMITS.receipt,'payload text');
  const signature=decodeBase64url(receipt.signature,64,'signature');
  let payload;try{payload=JSON.parse(receipt.payloadText);}catch{fail('Receipt payload is not valid JSON.');}
  exact(payload,['schema','keyId','issuedAt','ownerId','job','evidence','scenario','metricVerified','policyExecuted','safetyCertified','independentHostAttestation'],'receipt payload');
  if(payload.schema!=='brainsnn.world.report-receipt.v1'||payload.keyId!==receipt.keyId)fail('Receipt key or schema mismatch.');
  if(typeof payload.issuedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(payload.issuedAt)||!Number.isFinite(Date.parse(payload.issuedAt))||new Date(payload.issuedAt).toISOString()!==payload.issuedAt)fail('Invalid receipt issue time.');
  if(typeof payload.ownerId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(payload.ownerId))fail('Invalid receipt owner.');
  exact(payload.job,['id','engine'],'receipt job');identifier(payload.job.id,'job');text(payload.job.engine,64,'engine');
  exact(payload.scenario,['sha256','geometrySha256','authority'],'scenario binding');hash(payload.scenario.sha256,'scenario');
  if(payload.scenario.geometrySha256!==null)hash(payload.scenario.geometrySha256,'geometry');
  if(payload.scenario.authority!=='owner-declared')fail('Scenario content is an owner declaration.');
  exact(payload.evidence,['authority','sources','artifacts'],'worker evidence');
  if(payload.evidence.authority!=='worker-verified-bytes')fail('Unsupported worker evidence authority.');
  if(!Array.isArray(payload.evidence.sources)||payload.evidence.sources.length<1||payload.evidence.sources.length>12)fail('Invalid source count.');
  for(const source of payload.evidence.sources){exact(source,['id','kind','size','sha256'],'source');identifier(source.id,'source');if(!['image','video'].includes(source.kind)||!Number.isSafeInteger(source.size)||source.size<1||source.size>200*1024**2)fail('Invalid source metadata.');hash(source.sha256,'source');}
  if(new Set(payload.evidence.sources.map(s=>s.id)).size!==payload.evidence.sources.length)fail('Duplicate source IDs.');
  artifacts(payload.evidence.artifacts);
  for(const field of ['metricVerified','policyExecuted','safetyCertified','independentHostAttestation'])if(payload[field]!==false)fail('A worker receipt cannot assert geometry verification, safety, policy execution or host attestation.');
  return {payload,signature};
}
export async function verifySignedReport({scenarioText,receipt,key,trust,expectedJob}={}){
  const scenario=parseScenario(scenarioText),{payload,signature}=checkedReceipt(receipt);
  receipt={...receipt};key={...key};trust=trust&&{...trust};
  if(expectedJob)expectedJob=checkedJob(expectedJob);
  const {raw,keyId}=await verifyReportKey(key,trust);
  if(receipt.keyId!==keyId)fail('Receipt was signed by a different key.');
  if(await reportSHA256(encode(receipt.payloadText))!==receipt.payloadSha256)fail('Receipt payload SHA-256 does not match.');
  let publicKey;try{publicKey=await crypto.subtle.importKey('raw',raw,{name:'Ed25519'},false,['verify']);}catch{fail('This browser cannot verify Ed25519 receipts. Use a supported browser or the worker offline verifier.');}
  if(!await crypto.subtle.verify('Ed25519',publicKey,signature,encode(RECEIPT_DOMAIN+receipt.payloadText)))fail('Worker receipt signature is invalid.');
  const scenarioSha256=await reportSHA256(encode(scenarioText));
  if(scenarioSha256!==payload.scenario.sha256)fail('Exact scenario file bytes do not match the receipt.');
  const geometrySha256=scenario.world===null?null:await geometrySHA256(scenario.world);
  if(geometrySha256!==payload.scenario.geometrySha256)fail('Scenario geometry does not match the owner-declared binding.');
  if(expectedJob){
    checkedJob(expectedJob);
    if(payload.job.id!==expectedJob.id||payload.job.engine!==expectedJob.engine)fail('Receipt refers to a different worker job.');
    const expected=expectedJob.artifacts;
    if(expected.length!==payload.evidence.artifacts.length||expected.some(a=>!payload.evidence.artifacts.some(b=>a.name===b.name&&a.sha256===b.sha256&&a.size===b.size&&a.kind===b.kind)))fail('Receipt artifact references do not match the selected job.');
  }
  return freeze({verified:true,keyId,trustMethod:trust.kind,scenarioSha256,geometrySha256,payload,
    claim:'The trusted key authenticates this worker statement and its byte bindings. It does not certify human measurements, model truth, robot safety or independent host execution.'});
}
export function createSignedReportBundle(scenarioText,receipt,key){
  parseScenario(scenarioText);checkedReceipt(receipt);checkedKey(key);
  const bundle={schema:'brainsnn.world.signed-report.v1',scenarioText,receipt:structuredClone(receipt),publicKey:structuredClone(key)};
  jsonBound(bundle,REPORT_LIMITS.bundle,'Signed report bundle');return bundle;
}
export function parseSignedReportBundle(raw){
  if(typeof raw!=='string')fail('Read a signed report JSON file.');bytesBound(raw,REPORT_LIMITS.bundle,'Signed report bundle');
  const value=JSON.parse(raw);exact(value,['schema','scenarioText','receipt','publicKey'],'signed report bundle');
  if(value.schema!=='brainsnn.world.signed-report.v1')fail('Unsupported signed report bundle.');
  return createSignedReportBundle(value.scenarioText,value.receipt,value.publicKey);
}
export async function verifySignedReportBundle(raw,trust){const bundle=parseSignedReportBundle(raw);return verifySignedReport({scenarioText:bundle.scenarioText,receipt:bundle.receipt,key:bundle.publicKey,trust});}
