import {REPORT_LIMITS,verifyReportKey,verifySignedReport,createSignedReportBundle,parseSignedReportBundle,verifySignedReportBundle} from './report-receipts.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/** Optional worker receipts and offline verification. A key shipped with a report is never trust. */
export function createReportReview({getContext,createProof,download,status,event}){
  let host=null,open=false,trustKind='fingerprint',trustValue='',consent=false,busy=false,generation=0,controller=null;
  let contextClient=null,contextJob=null,notice='',verified=null,bundle=null,offlineText=null,offlineName='';
  function refresh(){if(host?.isConnected)render(host);}
  function cancel(){generation++;controller?.abort();controller=null;busy=false;}
  function invalidate(){const hadReceipt=verified||bundle||busy;cancel();verified=null;bundle=null;if(hadReceipt)notice='Scenario changed. Request a new receipt, or verify a previously saved bundle separately.';refresh();}
  function clear(){cancel();trustValue='';consent=false;notice='';verified=null;bundle=null;offlineText=null;offlineName='';contextClient=null;contextJob=null;open=false;}
  function syncContext(){const context=getContext();if(context.client!==contextClient||context.job?.id!==contextJob){cancel();contextClient=context.client;contextJob=context.job?.id;consent=false;verified=null;bundle=null;notice='';}return context;}
  function trust(){if(!trustValue.trim())throw new Error('Supply a public key or fingerprint obtained independently from the operator.');return {kind:trustKind,value:trustValue.trim()};}
  async function guarded(work){
    if(busy)return;cancel();const revision=generation,abort=new AbortController();controller=abort;busy=true;verified=null;bundle=null;notice='Checking receipt…';refresh();
    const current=()=>revision===generation&&!abort.signal.aborted;
    try{const value=await work(abort.signal,current);if(!current()||!value)return;verified=value.verified;bundle=value.bundle;notice='Signature verified for the saved proof snapshot using your separately trusted key.';status(notice);}
    catch(error){if(current()){notice='Receipt not verified: '+error.message;status(notice,true);}}
    finally{if(revision===generation){busy=false;controller=null;refresh();}}
  }
  async function requestReceipt(){
    const context=syncContext();
    if(!consent){notice='Approve sending only proof hashes and artifact references before requesting a receipt.';refresh();return;}
    if(context.caps?.reportSigning?.available!==true||!context.client||context.job?.status!=='complete'){notice='Connect a signing-enabled worker and complete an owned job first.';refresh();return;}
    const client=context.client,job=structuredClone(context.job);
    await guarded(async(signal,current)=>{
      const expectedTrust=trust(),key=await client.reportKey(signal);
      const trusted=await verifyReportKey(key,expectedTrust);
      if(context.caps.reportSigning.keyId!==trusted.keyId)throw new Error('Worker signing key changed; reconnect and independently check the new key.');
      if(!current())return;
      const scenarioText=JSON.stringify(await createProof(),null,2);
      if(!current())return;
      const receipt=await client.reportReceipt(job,scenarioText,signal);
      const verification=await verifySignedReport({scenarioText,receipt,key,trust:expectedTrust,expectedJob:job});
      if(!current())return;
      event('worker_report_receipt_verified',{job:job.id,keyId:verification.keyId,scenarioSHA256:verification.scenarioSha256});
      return {verified:verification,bundle:createSignedReportBundle(scenarioText,receipt,key)};
    });
  }
  async function verifyOffline(){
    await guarded(async(_signal,current)=>{
      const expectedTrust=trust();if(!offlineText)throw new Error('Choose a signed report bundle first.');
      const raw=offlineText,verification=await verifySignedReportBundle(raw,expectedTrust);
      if(!current())return;
      return {verified:verification,bundle:parseSignedReportBundle(raw)};
    });
  }
  function render(container){
    host=container;const context=syncContext();container.replaceChildren();
    const available=context.caps?.reportSigning?.available===true&&context.job?.status==='complete';
    const details=document.createElement('details');details.id='signed-report-review';details.className='processing-options';details.style.overflowWrap='anywhere';details.open=open;
    details.innerHTML=`<summary>Signed worker receipt / offline verification</summary><p>A receipt authenticates a worker statement about file hashes. Your map, measurements and scenario remain owner-declared. It does not certify model accuracy, robot safety or independent host execution.</p>
      <p class="micro">Kept in this tab; download the bundle to save it. Obtain the trusted key separately from your operator. A key included in a report or returned by this connection is not automatically trusted.</p>
      <label>Independent trust value<select id="report-trust-kind" ${busy?'disabled':''}><option value="fingerprint" ${trustKind==='fingerprint'?'selected':''}>SHA-256 public-key fingerprint</option><option value="public-key" ${trustKind==='public-key'?'selected':''}>Raw public key · base64url</option></select></label>
      <label>${trustKind==='fingerprint'?'Trusted fingerprint · 64 lowercase hex characters':'Trusted Ed25519 public key · 43 base64url characters'}<input id="report-trust" value="${esc(trustValue)}" maxlength="128" autocomplete="off" spellcheck="false" ${busy?'disabled':''}></label>
      <p id="report-availability">${available?`Signing is configured for completed job ${esc(context.job.id)}. ${context.job.artifacts.length} artifact(s) will be referenced.`:'Signing is unavailable until a signing-enabled worker is connected and an owned job is complete. Local proof export remains available.'}</p>
      ${available?`<label class="check"><input id="report-consent" type="checkbox" ${consent?'checked':''} ${busy?'disabled':''}><span>I approve sending only this proof's hashes and existing artifact references to ${esc(new URL(context.client.base).host)}. The proof contents and source media are not sent by this action.</span></label>`:''}
      <button type="button" id="report-request" ${!available||busy?'disabled':''}>Request and verify receipt</button><p class="micro">The receipt links an exact saved proof snapshot to the job's artifacts; it does not prove the map was derived from them. Up to 256 MiB of artifacts can be referenced.</p>
      <hr><label>Offline signed report bundle · up to 9 MiB<input id="report-import" type="file" accept=".json,application/json" ${busy?'disabled':''}></label>${offlineName?`<p class="micro">Selected locally: ${esc(offlineName)}</p>`:''}
      <button type="button" id="report-verify" ${!offlineText||busy?'disabled':''}>Verify local file without uploading</button>
      <p id="report-status" role="status">${esc(notice||'No receipt has been verified.')}</p>
      ${verified?`<div id="report-verification"><p><b>Verified worker statement</b><br>Owner: ${esc(verified.payload.ownerId)}<br>Job: ${esc(verified.payload.job.id)}<br>Issued: ${esc(verified.payload.issuedAt)}<br>${verified.payload.evidence.sources.length} source hash(es) · ${verified.payload.evidence.artifacts.length} artifact hash(es)</p><p class="micro">Trusted key: ${verified.keyId}<br>Exact proof SHA-256: ${verified.scenarioSha256}</p><p>${esc(verified.claim)}</p></div>`:''}
      <button type="button" id="report-export" ${!verified||busy?'disabled':''}>Download signed report bundle ↗</button><button type="button" id="report-scenario-export" ${!verified||busy?'disabled':''}>Download exact signed proof JSON ↗</button>`;
    details.addEventListener('toggle',()=>{open=details.open;});
    details.querySelector('#report-trust').addEventListener('input',e=>{trustValue=e.target.value;verified=null;bundle=null;notice='Trust value changed. Verify again.';details.querySelector('#report-status').textContent=notice;details.querySelector('#report-verification')?.remove();details.querySelector('#report-export').disabled=true;details.querySelector('#report-scenario-export').disabled=true;});
    details.querySelector('#report-trust-kind').addEventListener('change',e=>{trustKind=e.target.value;verified=null;bundle=null;notice='Trust value changed. Verify again.';refresh();});
    details.querySelector('#report-consent')?.addEventListener('change',e=>{consent=e.target.checked;});
    details.querySelector('#report-request').addEventListener('click',()=>void requestReceipt());
    details.querySelector('#report-verify').addEventListener('click',()=>void verifyOffline());
    details.querySelector('#report-export').addEventListener('click',()=>{if(verified&&bundle)download('brainsnn-signed-report.json',bundle);});
    details.querySelector('#report-scenario-export').addEventListener('click',()=>{if(verified&&bundle)download('brainsnn-signed-proof.json',bundle.scenarioText);});
    details.querySelector('#report-import').addEventListener('change',async e=>{
      const file=e.target.files?.[0];if(!file)return;cancel();const revision=generation;verified=null;bundle=null;offlineText=null;offlineName='';notice='Reading local report…';refresh();
      try{if(file.size>REPORT_LIMITS.bundle)throw new Error('Signed report bundle exceeds 9 MiB.');const raw=await file.text();parseSignedReportBundle(raw);if(revision!==generation)return;offlineText=raw;offlineName=file.name;notice='File loaded locally. Supply independent trust and verify; its embedded key has no authority.';}
      catch(error){if(revision===generation)notice=error.message;}
      finally{if(revision===generation)refresh();}
    });
    container.append(details);
  }
  return {render,clear,cancel,invalidate};
}
