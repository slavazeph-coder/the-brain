import {workerURL} from './core.mjs';
/** Authenticated operator connection. Credentials never enter URLs or persistent storage. */
export class WorkerClient {
  constructor(url, token) { this.base=workerURL(url); if(typeof token!=='string'||token.length<32)throw new Error('Use an operator token with at least 32 characters.'); this.token=token;this.uploads=new WeakMap(); }
  async request(path, {method='GET',body,signal,raw=false}={}) {
    if(!/^\/v1\/[a-zA-Z0-9/_?=&.-]+$/.test(path))throw new Error('Invalid worker path.');
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),60000);
    const relay=()=>controller.abort();signal?.addEventListener('abort',relay,{once:true});if(signal?.aborted)relay();
    try{
      const response=await fetch(this.base+path,{method,body:raw?body:body===undefined?undefined:JSON.stringify(body),headers:{Authorization:`Bearer ${this.token}`,...(body===undefined?{}:{'Content-Type':raw?'application/octet-stream':'application/json'})},signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer'});
      const reader=response.body?.getReader();if(!reader)throw new Error('Empty worker response.');
      const chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw new Error('Worker JSON exceeded the 1 MiB response limit.');}chunks.push(value);}
      const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
      let data;try{data=JSON.parse(new TextDecoder().decode(all));}catch{throw new Error('Worker returned invalid JSON.');}
      if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail.slice(0,300):`Worker request failed (${response.status}).`);
      return data;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',relay);}
  }
  async capabilities(signal){const c=await this.request('/v1/capabilities',{signal});if(c.api_version!=='brainsnn.worker.v1'||!Array.isArray(c.engines)||c.engines.length>32)throw new Error('Incompatible worker capabilities.');this.caps=c;return c;}
  async upload(file, kind, signal, progress=()=>{}){
    let item=this.uploads.get(file);
    if(item){try{item=await this.request(`/v1/uploads/${item.id}`,{signal});}catch(e){if(signal?.aborted)throw e;item=null;}}
    if(!item)item=await this.request('/v1/uploads',{method:'POST',body:{name:file.name,size:file.size,kind},signal});
    if(!/^[a-f0-9]{32}$/.test(item.id))throw new Error('Invalid upload identifier.');this.uploads.set(file,item);
    let offset=item.offset;const step=Math.min(this.caps?.limits?.chunk_bytes||4*1024**2,4*1024**2);
    while(offset<file.size){if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid upload offset.');
      const end=Math.min(file.size,offset+step);const part=await this.request(`/v1/uploads/${item.id}?offset=${offset}`,{method:'PUT',body:file.slice(offset,end),raw:true,signal});
      if(part.offset!==end)throw new Error('Worker upload offset mismatch.');offset=part.offset;progress(offset/file.size);
    }
    return item.id;
  }
  async download(job,id,signal){if(!/^[a-f0-9]{32}$/.test(job)||!Number.isInteger(id)||id<0||id>31)throw new Error('Invalid artifact identifier.');const r=await this.request(`/v1/jobs/${job}/ticket`,{method:'POST',body:{artifact:id},signal});const url=new URL(r.url,this.base+'/');if(url.origin!==new URL(this.base).origin||!url.pathname.startsWith(new URL(this.base+'/v1/download/').pathname))throw new Error('Worker returned an untrusted download URL.');return url.href;}
}
