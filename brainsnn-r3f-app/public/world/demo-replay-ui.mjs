/** Private saved-output replay. Rendering does not run SLAM or control a robot. */
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
export function demoRequest({artifacts,title,credit,captureKind,ending,reviewed}){
  const source=artifacts?.find(a=>a.name==='scene.json')??artifacts?.find(a=>a.name==='reconstruction.json');
  if(!source||!/^[a-f0-9]{64}$/.test(source.sha256))throw Error('Open a completed reconstruction or scene with a source hash.');
  if(!reviewed)throw Error('Review the source credit and approve including its retained frames.');
  for(const [value,max] of [[title,80],[credit,180]])if(typeof value!=='string'||!value.trim()||value.trim().length>max||/\p{C}/u.test(value))throw Error('Enter a title and source credit without control characters.');
  if(!['phone-video','photo-sequence-fixture','unknown','authored-fixture'].includes(captureKind)||!['reconstruction','bim','robot'].includes(ending))throw Error('Choose a supported capture type and ending.');
  if(ending!=='reconstruction'&&source.name!=='scene.json')throw Error('The BIM and robot endings need a compiled metric scene.');
  return {schema:'brainsnn.demo-replay-request.v1',source_artifact:source.name,source_sha256:source.sha256,title:title.trim(),credit:credit.trim(),capture_kind:captureKind,ending,reviewed:true};
}
export function mountDemoReplay({host,context,isCurrent,status=()=>{},event=()=>{}}){
  const client=context.sourceClient;
  if(!client?.caps?.engines?.some(e=>e.id==='demo-replay'&&e.available)||client.caps.owner_id==='site-visitors')return ()=>{};
  const section=el('section');section.className='dimension-card demo-replay';section.dataset.demoReplay='';
  section.append(el('h3','Export demo video'),el('p','A precomputed camera-path replay with selected source frames, a landscape film and two social cuts. The final cloud stays visible; this is not live reconstruction.'));
  function field(label,kind='text'){const l=el('label',label),input=el('input');input.type=kind;l.append(input);section.append(l);return input;}
  const title=field('Video title');title.maxLength=80;title.value='Walk the space. Keep the evidence.';
  const credit=field('Source credit');credit.maxLength=180;credit.placeholder='Who captured this footage and where it may be used';
  const kindLabel=el('label','Capture type'),kind=el('select');kindLabel.append(kind);section.append(kindLabel);
  for(const [value,label] of [['unknown','Source type unverified'],['phone-video','Phone video (your declaration)'],['photo-sequence-fixture','Photo-sequence fixture'],['authored-fixture','Authored test fixture']])kind.append(new Option(label,value));
  const endLabel=el('label','Ending'),ending=el('select');endLabel.append(ending);section.append(endLabel);
  for(const [value,label] of [['reconstruction','Reconstruction and capture path'],...(context.artifacts.some(a=>a.name==='scene.json')?[['bim','Exported model geometry'],['robot','Simulated robot route']]:[])])ending.append(new Option(label,value));
  const label=el('label');label.className='check';const review=el('input');review.type='checkbox';label.append(review,el('span','I may use these source frames, reviewed their credit, and approve including them in this private export. Scale and physical accuracy remain unverified.'));section.append(label);
  const button=el('button','Create demo videos');button.type='button';button.className='primary wide';
  const cancel=el('button','Cancel video export');cancel.type='button';cancel.hidden=true;
  const message=el('p');message.setAttribute('role','status');const links=el('div');section.append(button,cancel,message,links);host.append(section);
  let controller=null,jobId=null,submission=null,cancellation=null,disposed=false;
  const valid=()=>!disposed&&isCurrent();
  async function stop(){controller?.abort();if(submission){try{await submission;}catch{}}if(cancellation)return cancellation;if(!jobId)return;const id=jobId;cancellation=client.request(`/v1/jobs/${id}`,{method:'DELETE'}).then(()=>{if(jobId===id)jobId=null;}).finally(()=>{cancellation=null;});return cancellation;}
  cancel.onclick=async()=>{try{await stop();message.textContent='Video export cancellation confirmed.';}catch(e){message.textContent='Cancellation unconfirmed: '+e.message;}};
  button.onclick=async()=>{
    if(controller)return;
    try{
      if(!valid()||context.dirty)throw Error('Save pending edits, then reopen the matching completed source.');
      const request=demoRequest({artifacts:context.artifacts,title:title.value,credit:credit.value,captureKind:kind.value,ending:ending.value,reviewed:review.checked});
      controller=new AbortController();const signal=controller.signal;button.disabled=true;cancel.hidden=false;links.replaceChildren();
      message.textContent='Preparing the reviewed video request…';
      const upload=await client.upload(new File([JSON.stringify(request)],'demo-request.json',{type:'application/json'}),'replay',signal);
      signal.throwIfAborted();if(!valid())throw Error('Source changed before submission.');
      // Keep the side-effecting create response so disposal can cancel a late job.
      submission=client.request('/v1/jobs',{method:'POST',body:{engine:'demo-replay',upload_ids:[upload],source_job:context.job,consent:true}}).then(j=>{jobId=j.id;return j;});
      let job=await submission;submission=null;signal.throwIfAborted();
      if(!valid())throw Error('Source changed during submission.');
      await client.request(`/v1/jobs/${jobId}/start`,{method:'POST',signal});
      const deadline=Date.now()+16*60*1000;
      while(!['complete','failed','cancelled'].includes(job.status)){
        if(Date.now()>deadline)throw Error('Video export exceeded the browser wait limit.');
        signal.throwIfAborted();await new Promise(resolve=>setTimeout(resolve,1500));signal.throwIfAborted();
        job=await client.request(`/v1/jobs/${jobId}`,{signal});message.textContent=`Video export: ${job.status}`;
      }
      if(job.status!=='complete')throw Error(job.error||`Video export ${job.status}.`);
      if(!valid())return;
      for(const [index,artifact] of job.artifacts.entries()){
        const download=el('button',`Download ${artifact.name}`);download.type='button';download.className='wide';
        download.onclick=async()=>{try{if(!valid())throw Error('Reopen the matching source before downloading.');const url=await client.download(job.id,index);const a=el('a');a.href=url;a.download=artifact.name;a.rel='noopener';document.body.append(a);a.click();a.remove();}catch(e){message.textContent=e.message;}};
        links.append(download);
      }
      message.textContent='Videos ready. Review the partial-capture warnings, scale labels and source credit before sharing.';
      event('demo_video_exported',{job:job.id,sourceJob:context.job,ending:request.ending});jobId=null;
    }catch(e){if(!disposed){message.textContent=e.name==='AbortError'?'Video export cancelled.':e.message;status(message.textContent,true);}try{await stop();}catch(err){if(!disposed)message.textContent+=' Cancellation unconfirmed: '+err.message;}}
    finally{controller=null;submission=null;if(!disposed){button.disabled=false;cancel.hidden=true;}}
  };
  const dialog=host.closest('dialog');
  function dispose(){if(disposed)return;disposed=true;dialog?.removeEventListener('close',dispose);window.removeEventListener('pagehide',dispose);void stop().catch(e=>status('Video export cancellation unconfirmed: '+e.message,true));section.remove();}
  dialog?.addEventListener('close',dispose);window.addEventListener('pagehide',dispose);return dispose;
}
