import {workerURL} from './core.mjs';
/** Private worker connection. Credentials never enter URLs or persistent storage. */
export class WorkerClient {
  constructor(url, token) { this.base=workerURL(url); if(typeof token!=='string'||token.length<32)throw new Error('Use a worker access token with at least 32 characters.'); this.token=token;this.uploads=new WeakMap(); }
  async request(path, {method='GET',body,signal,raw=false}={}) {
    if(!/^\/v1\/[a-zA-Z0-9/_?=&.-]+$/.test(path))throw new Error('Invalid worker path.');
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),60000);
    const relay=()=>controller.abort();signal?.addEventListener('abort',relay,{once:true});if(signal?.aborted)relay();
    try{
      const response=await fetch(this.base+path,{method,body:raw?body:body===undefined?undefined:JSON.stringify(body),headers:{Authorization:`*** ${this.token}`,...(body===undefined?{}:{'Content-Type':raw?'application/octet-stream':'application/json'})},signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
      if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
      const reader=response.body?.getReader();if(!reader)throw new Error('Empty worker response.');
      const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw new Error('Worker JSON exceeded the 1 MiB response limit.');}chunks.push(value);}
      const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
      let data;try{data=JSON.parse(new TextDecoder().decode(all));}catch{throw new Error('Worker returned invalid JSON.');}
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail.slice(0,300):`Worker request failed (${response.status}).`);
      return data;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);}
  }
  async capabilities(signal){const c=await this.request('/v1/capabilities',{signal});if(c.api_version!=='brainsnn.worker.v1'||!Array.isArray(c.engines)||c.engines.length>32)throw new Error('Incompatible worker capabilities.');this.caps=c;return c;}
  async reportKey(signal){return this.request('/v1/report-key',{signal});}
  async reportReceipt(job,scenarioText,signal){
    if(this.caps?.reportSigning?.available!==true)throw new Error('This worker has not enabled report signing.');
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const snapshot=structuredClone(job),{prepareReportRequest}=await import('./report-receipts.mjs');
    const body=await prepareReportRequest(scenarioText,snapshot);
    // Abort between prepareReportRequest and request() must not transmit the
    // signed body to the worker — the caller has cancelled the report.
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const data=await this.request(`/v1/jobs/${snapshot.id}/report-receipt`,{method:'POST',body,signal});
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    return data;
  }
  async upload(file, kind, signal, progress=()=>{}){
    let item=this.uploads.get(file);
    if(item){try{item=await this.request(`/v1/uploads/${item.id}`,{signal});}catch(e){if(signal?.aborted)throw e;item=null;}}
    if(!item)item=await this.request('/v1/uploads',{method:'POST',body:{name:file.name,size:file.size,kind},signal});
    if(!/^[a-f0-9]{32}$/.test(item.id))throw new Error('Invalid upload identifier.');this.uploads.set(file,item);
    let offset=item.offset;const advertised=this.caps?.limits?.chunk_bytes??4*1024**2;
    if(!Number.isSafeInteger(offset)||offset<0||offset>file.size||item.size!==file.size)throw new Error('Invalid upload offset or size.');
    if(!Number.isSafeInteger(advertised)||advertised<1)throw new Error('Invalid worker chunk limit.');
    const step=Math.min(advertised,4*1024**2);
    while(offset<file.size){if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid upload offset.');
      const end=Math.min(file.size,offset+step);const part=await this.request(`/v1/uploads/${item.id}?offset=${offset}`,{method:'PUT',body:file.slice(offset,end),raw:true,signal});
      if(part.offset!==end)throw new Error('Worker upload offset mismatch.');offset=part.offset;progress(offset/file.size);
    }
    return item.id;
  }
  async download(job,id,signal){if(!/^[a-f0-9]{32}$/.test(job)||!Number.isInteger(id)||id<0||id>31)throw new Error('Invalid artifact identifier.');
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const r=await this.request(`/v1/jobs/${job}/ticket`,{method:'POST',body:{artifact:id},signal});
    if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError');
    const url=new URL(r.url,this.base+'/');if(url.origin!==new URL(this.base).origin||!url.pathname.startsWith(new URL(this.base+'/v1/download/').pathname))throw new Error('Worker returned an untrusted download URL.');return url.href;}
  async previewArtifact(job,index,signal){
    const item=job.artifacts?.[index],limit=64*1024**2;
    if(!item||!Number.isSafeInteger(item.size)||item.size<1||item.size>limit)throw new Error('In-browser previews are limited to 64 MiB. Download larger artifacts for a desktop viewer.');
    if(!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Artifact is missing a valid integrity hash.');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new DOMException('Artifact preview exceeded its 60 second deadline.','TimeoutError')),60000);
    const relay=()=>controller.abort(signal.reason);signal?.addEventListener('abort',relay,{once:true});if(signal?.aborted)relay();
    try{
      controller.signal.throwIfAborted();
      const url=await this.download(job.id,index,controller.signal);
      controller.signal.throwIfAborted();
      const response=await fetch(url,{signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok||!response.body)throw new Error('Artifact preview download failed.');
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>item.size||size>limit)throw new Error('Artifact exceeded its declared size.');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      controller.signal.throwIfAborted();
      if(size!==item.size)throw new Error('Artifact download is incomplete.');
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
      controller.signal.throwIfAborted();
      if(hash!==item.sha256)throw new Error('Artifact integrity check failed.');
      return bytes.buffer;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);controller.abort();}
  }
}
