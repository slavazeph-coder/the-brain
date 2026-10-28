/** Source-bound portable USD export. Tokens remain in the existing WorkerClient. */
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
export function packageRequest({sceneSha,cloudSha,reviewed,asset,position=[0,0,0],yaw=0,licenseReviewed=false,physicsReviewed=false}){
  if(!reviewed||![sceneSha,cloudSha].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))throw Error('Review a metric scene with exact source hashes first.');
  const placements=[];
  if(asset){
    if(!asset.available||!licenseReviewed||!physicsReviewed)throw Error('Review the NVIDIA license and unqualified physics before adding the asset.');
    if(position.length!==3||!position.every(v=>Number.isFinite(v)&&Math.abs(v)<=10000)||!Number.isFinite(yaw)||Math.abs(yaw)>360)throw Error('Enter finite placement coordinates and yaw.');
    placements.push({id:'library_asset_1',asset:asset.asset,package_sha256:asset.package_sha256,translation_m:position,rotation_xyz_deg:[0,yaw,0],license_reviewed:true,unqualified_physics_reviewed:true,scale:1,collision_policy:'authored'});
  }
  return {schema:'brainsnn.omniverse-request.v1',scene_sha256:sceneSha,cloud_sha256:cloudSha,reviewed:true,placements};
}
export function mountOmniverse({host,context,sceneSha,isCurrent,status,event}){
  const client=context.sourceClient,caps=client.caps;
  // The hosted visitor proxy intentionally does not authorize this engine.
  if(client.site&&caps?.owner_id==='site-visitors')return ()=>{};
  if(!caps?.engines?.some(e=>e.id==='omniverse-pack'&&e.available))return ()=>{};
  const section=el('section');section.id='scene-omniverse';section.className='dimension-card';
  section.append(el('h3','Export an Omniverse pack'),el('p','Your metric scene plus optional NVIDIA library assets. Library additions are not observations from the scan. Original BIM/CAD exports remain unchanged.'));
  const select=el('select');select.setAttribute('aria-label','NVIDIA library asset');select.append(new Option('Captured scene only',''));
  const assets=Array.isArray(caps.simready_assets)?caps.simready_assets.filter(a=>a.available).slice(0,16):[];
  assets.forEach(a=>select.append(new Option(`${a.asset} · ${Math.ceil(a.bytes/1024**2)} MiB`,a.asset)));
  section.append(select);const detail=el('p');detail.className='micro';section.append(detail);
  const inputs=['X · m','Y · m (height)','Z · m','Yaw · degrees'].map((label,i)=>{const l=el('label',label),input=el('input');input.type='number';input.step='.01';input.value='0';input.min=i===3?'-360':'-10000';input.max=i===3?'360':'10000';l.append(input);section.append(l);return input;});
  function check(text){const l=el('label');l.className='check';const input=el('input');input.type='checkbox';l.append(input,el('span',text));section.append(l);return input;}
  const license=check('I reviewed NVIDIA’s CC BY 4.0 license and the retained asset attribution.');
  const physics=check('I reviewed the asset’s reported validation failures. Its physics and placement remain unqualified.');
  const review=check('Build this separate package with authored library colliders and static scene proxies. This does not certify scale, collision safety, or robot behavior.');
  const button=el('button','Build Omniverse pack');button.type='button';button.className='primary wide';
  const cancel=el('button','Cancel package job');cancel.type='button';cancel.hidden=true;
  const message=el('p');message.setAttribute('role','status');const links=el('div');section.append(button,cancel,message,links);host.append(section);
  let controller=null,jobId=null,disposed=false,submission=null,cancellation=null;
  const dialog=host.closest('dialog');
  const valid=()=>!disposed&&isCurrent();
  const selected=()=>assets.find(a=>a.asset===select.value);
  const render=()=>{const a=selected();inputs.forEach(n=>n.disabled=!a);license.disabled=physics.disabled=!a;detail.textContent=a?`${a.author} · ${a.license}. Historical failed features: ${(a.upstream_failed_features||[]).join(', ')||'none reported here'}. No Isaac Sim execution is claimed.`:(caps.simready_error||'A source-only package contains no NVIDIA library assets.');};
  select.onchange=()=>{license.checked=physics.checked=false;render();};render();
  async function stop(){
    controller?.abort();
    // A create request may already have allocated a job. Retain its response
    // so closing the dialog during submission can still cancel that exact job.
    if(submission){try{await submission;}catch{/* No job id was returned. */}}
    if(cancellation)return cancellation;
    if(!jobId)return;
    const id=jobId;
    cancellation=client.request(`/v1/jobs/${id}`,{method:'DELETE'}).then(()=>{if(jobId===id)jobId=null;}).finally(()=>{cancellation=null;});
    return cancellation;
  }
  cancel.onclick=async()=>{try{await stop();message.textContent='Package cancellation confirmed.';}catch(error){message.textContent='Could not confirm cancellation: '+error.message;}};
  button.onclick=async()=>{
    if(controller)return;
    try{
      if(!valid()||context.dirty)throw Error('Reopen the matching compiled scene; save or discard pending BIM edits before packaging.');
      const cloudArtifact=context.artifacts.find(a=>a.name==='arena-cloud.json');
      const request=packageRequest({sceneSha,cloudSha:cloudArtifact?.sha256,reviewed:review.checked,asset:selected(),position:inputs.slice(0,3).map(i=>i.value===''?NaN:Number(i.value)),yaw:inputs[3].value===''?NaN:Number(inputs[3].value),licenseReviewed:license.checked,physicsReviewed:physics.checked});
      const data=structuredClone(context.cloud);data.omniversePack=request;
      controller=new AbortController();const signal=controller.signal;button.disabled=true;cancel.hidden=false;links.replaceChildren();
      const file=new File([JSON.stringify(data)],'omniverse-request.json',{type:'application/json'});
      message.textContent='Uploading the reviewed source-bound package request…';
      const upload=await client.upload(file,'cloud',signal);
      signal.throwIfAborted();
      if(!valid())throw Error('Scene changed before job submission.');
      // Do not discard a side-effecting create response when the local UI aborts.
      submission=client.request('/v1/jobs',{method:'POST',body:{engine:'omniverse-pack',upload_ids:[upload],source_job:context.job,consent:true}}).then(created=>{jobId=created.id;return created;});
      let job=await submission;submission=null;
      signal.throwIfAborted();
      if(!valid())throw Error('Scene changed during job submission.');
      await client.request(`/v1/jobs/${jobId}/start`,{method:'POST',signal});
      const deadline=Date.now()+12*60*1000;
      while(!['complete','failed','cancelled'].includes(job.status)){
        if(Date.now()>deadline)throw Error('Package exceeded the browser wait limit.');
        signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,1500));signal.throwIfAborted();
        job=await client.request(`/v1/jobs/${jobId}`,{signal});message.textContent=`Omniverse package: ${job.status}`;
      }
      if(job.status!=='complete')throw Error(job.error||`Package ${job.status}.`);
      if(!valid())return;
      for(let i=0;i<job.artifacts.length;i++){
        const artifact=job.artifacts[i],a=el('button',`Download ${artifact.name}`);a.type='button';a.style.display='block';
        a.onclick=async()=>{a.disabled=true;try{if(!valid())throw Error('Reopen the matching scene before downloading.');const url=await client.download(job.id,i);const link=el('a');link.href=url;link.download=artifact.name;link.rel='noopener';document.body.append(link);link.click();link.remove();}catch(error){message.textContent=error.message;}finally{a.disabled=false;}};links.append(a);
        links.append(el('small',`SHA-256: ${artifact.sha256}`));
      }
      message.textContent='Portable package ready. Extract it, run verify_pack.py, then open world.usda. Physics has not been tested.';
      event('omniverse_package_created',{job:job.id,sourceJob:context.job,assets:request.placements.length});jobId=null;
    }catch(error){if(!disposed){message.textContent=error.name==='AbortError'?'Package cancelled.':error.message;status(message.textContent,true);}try{await stop();}catch(cancelError){if(!disposed)message.textContent+=' Cancellation unconfirmed: '+cancelError.message;}}
    finally{submission=null;controller=null;if(!disposed){button.disabled=false;cancel.hidden=true;}}
  };
  function dispose(){
    if(disposed)return;
    disposed=true;
    dialog?.removeEventListener('close',dispose);
    window.removeEventListener('pagehide',dispose);
    void stop().catch(error=>status('Package cancellation could not be confirmed: '+error.message,true));
    section.remove();
  }
  dialog?.addEventListener('close',dispose);
  window.addEventListener('pagehide',dispose);
  return dispose;
}
