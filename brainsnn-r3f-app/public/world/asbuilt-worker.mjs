/** Existing authenticated transport; never discard a side-effecting job-create response. */
const ID=/^[a-f0-9]{32}$/;
export function createAsBuiltJobs({client,sourceJob,isCurrent=()=>true,onStatus=()=>{}}){
  let controller=null,jobId=null,submission=null,cancellation=null,disposed=false;
  const current=()=>!disposed&&isCurrent();
  async function stop(){
    controller?.abort();
    if(submission)try{await submission;}catch{/* No returned job id. */}
    if(cancellation)return cancellation;
    if(!jobId)return;
    const id=jobId;
    cancellation=client.request(`/v1/jobs/${id}`,{method:'DELETE'}).then(()=>{if(jobId===id)jobId=null;}).finally(()=>cancellation=null);
    return cancellation;
  }
  async function run(engine,files){
    if(controller)throw Error('Wait for or cancel the current review job.');
    if(!current()||!ID.test(sourceJob)||!['asbuilt-update','asbuilt-evidence'].includes(engine))throw Error('Reopen the matching completed worker scene.');
    if(!client.caps?.engines?.some(e=>e.id===engine&&e.available))throw Error('This worker does not offer that review operation.');
    controller=new AbortController();const signal=controller.signal;
    function check(){signal.throwIfAborted();if(!current())throw Error('The source or review changed.');}
    try{
      const uploads=[];
      for(const {file,kind} of files){check();onStatus('Uploading approved review inputs…');uploads.push(await client.upload(file,kind,signal));}
      check();
      submission=client.request('/v1/jobs',{method:'POST',body:{engine,upload_ids:uploads,source_job:sourceJob,consent:true}}).then(job=>{if(!ID.test(job?.id))throw Error('Invalid review job identifier.');jobId=job.id;return job;});
      let job=await submission;submission=null;check();
      await client.request(`/v1/jobs/${jobId}/start`,{method:'POST',signal});
      const deadline=Date.now()+240000;
      while(!['complete','failed','cancelled'].includes(job.status)){
        check();if(Date.now()>deadline)throw Error('Review exceeded the browser wait limit.');
        await new Promise(resolve=>{const timer=setTimeout(done,500);function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();}signal.addEventListener('abort',done,{once:true});});
        check();job=await client.request(`/v1/jobs/${jobId}`,{signal});onStatus(`Review job: ${job.status}`);
      }
      if(job.status!=='complete')throw Error(job.error||`Review ${job.status}.`);
      check();jobId=null;return job;
    }catch(error){try{await stop();}catch(cancelError){throw Error(error.message+' Cancellation unconfirmed: '+cancelError.message);}throw error;}
    finally{submission=null;controller=null;}
  }
  return {run,stop,get busy(){return !!controller;},async dispose(){disposed=true;await stop();}};
}

export function validatePhotoEvidence(value,{sceneSha,componentId,revision}){
  if(value?.schema!=='brainsnn.asbuilt-photo-evidence.v1'||value.sceneSha256!==sceneSha||value.componentId!==componentId||value.componentRevision!==revision||value.metricVerified!==false||value.physicalRobotValidated!==false||!['available','unavailable'].includes(value.status)||!Array.isArray(value.frames)||value.frames.length>2)throw Error('Photo evidence does not match this scene/component revision.');
  if(value.status==='available'&&!value.frames.length||value.status==='unavailable'&&value.frames.length)throw Error('Invalid photo-evidence availability.');
  for(const f of value.frames){const b=f.normalizedPointBounds;if(!/^evidence-frame-0[12]\.jpg$/.test(f.previewName)||!['previewSha256','originalImageSha256','ledgerSha256'].every(k=>/^[a-f0-9]{64}$/.test(f[k]))||!Array.isArray(b)||b.length!==4||!b.every(n=>Number.isFinite(n)&&n>=0&&n<=1)||b[0]>=b[2]||b[1]>=b[3])throw Error('Invalid projected source-frame bounds or hashes.');}
  return value;
}
