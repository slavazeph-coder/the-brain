/** Three tools share the existing authenticated worker protocol. Credentials stay in the client. */
export function createLayerJobRunner({getConnection,onComplete,onStatus=()=>{},onBusy=()=>{}}) {
  let execution=null,disposed=false;
  const delay=(ms,signal)=>new Promise((resolve,reject)=>{
    const finish=()=>{signal.removeEventListener('abort',cancel);resolve();};
    const timer=setTimeout(finish,ms),cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason||new DOMException('Cancelled','AbortError'));};
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  });
  async function cancelRemote(current) {
    if(current.client&&current.job&&!['complete','failed','cancelled'].includes(current.job.status)) {
      try {await current.client.request(`/v1/jobs/${current.job.id}`,{method:'DELETE'});}
      catch {onStatus('Stopped waiting. Server cancellation could not be confirmed; check this job before starting another.',true);}
    }
  }
  async function cancel() {
    const current=execution;if(!current)return;
    current.controller.abort();await current.settled;
  }
  return {
    isActive:()=>!!execution,
    async run({engine,inputs,sourceJob=null,expectedClient=null,sourceNames=[]}) {
      if(disposed||execution)throw Error('Wait for the current tool or cancel it first.');
      let settle;
      const current={client:null,controller:new AbortController(),job:null,settled:new Promise(resolve=>{settle=resolve;})};
      execution=current;onBusy(true);
      const signal=current.controller.signal;
      const checkJob=value=>{
        if(!/^[a-f0-9]{32}$/.test(value?.id||'')||value.engine!==engine||current.job&&current.job.id!==value.id||!['prepared','queued','running','complete','failed','cancelled'].includes(value.status))throw Error('The service returned an inconsistent job.');
        return value;
      };
      try {
        const {client,caps}=await getConnection();signal.throwIfAborted();current.client=client;
        if(expectedClient&&expectedClient!==client)throw Error('Reconnect this source’s original processing session before running the tool.');
        const entry=caps?.engines?.find(item=>item.id===engine&&item.available);
        if(!entry)throw Error('This tool is not enabled for this processing connection. Connect with access to this tool.');
        if(!Array.isArray(inputs)||!inputs.length||inputs.length>entry.max_inputs||inputs.some(item=>!(item.file instanceof File)||!entry.input_kinds.includes(item.kind)))throw Error('Choose the required files for this tool.');
        const uploads=[];
        for(let i=0;i<inputs.length;i++) {
          signal.throwIfAborted();
          // Separate identity avoids borrowing an upload cached under another kind.
          const item=inputs[i],file=new File([item.file],item.file.name,{type:item.file.type});
          uploads.push(await client.upload(file,item.kind,signal,p=>onStatus(`Uploading ${i+1} of ${inputs.length} · ${Math.round(p*100)}%`)));
        }
        signal.throwIfAborted();
        current.job=checkJob(await client.request('/v1/jobs',{method:'POST',body:{engine,upload_ids:uploads,consent:true,...(sourceJob?{source_job:sourceJob}:{})},signal}));
        signal.throwIfAborted();
        current.job=checkJob(await client.request(`/v1/jobs/${current.job.id}/start`,{method:'POST',body:{},signal}));
        let failures=0;
        for(;;) {
          signal.throwIfAborted();
          if(current.job.status==='complete') {
            if(!Array.isArray(current.job.artifacts)||current.job.artifacts.length>40)throw Error('The result manifest is invalid.');
            const result=onComplete(current.job,client,{sourceNames});
            onStatus('Ready. Your result and its files are saved in this workspace session.');return result;
          }
          if(['failed','cancelled'].includes(current.job.status))throw Error(current.job.error||`Processing ${current.job.status}.`);
          onStatus(current.job.status==='queued'?'Waiting for the processing service…':'Processing your files…');
          await delay(failures?Math.min(15000,1500*2**failures):1000,signal);
          let next;
          try {next=await client.request(`/v1/jobs/${current.job.id}`,{signal});failures=0;}
          catch(error) {if(signal.aborted||++failures>7)throw error;onStatus('Connection interrupted. Checking the same job again…');continue;}
          current.job=checkJob(next);
        }
      } finally {
        if(signal.aborted)await cancelRemote(current);
        if(execution===current){execution=null;onBusy(false);}settle();
      }
    },
    cancel,
    dispose(){disposed=true;execution?.controller.abort();},
  };
}
