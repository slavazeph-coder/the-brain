// Session-only result history. Worker credentials and checked manifests stay private;
// the workspace gets only detached display metadata, never a ticket or client.
export const WORKSPACE_RESULT_LIMIT=12;
const jobId=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const text=(value,max=180)=>typeof value==='string'?value.slice(0,max):'';

export function createWorkspaceResults({limit=WORKSPACE_RESULT_LIMIT}={}){
  if(!Number.isInteger(limit)||limit<1||limit>WORKSPACE_RESULT_LIMIT)throw new Error('Invalid result history limit.');
  const records=new Map();let sequence=0;
  function find(job,sourceClient){return [...records.values()].find(record=>record.job.id===job?.id&&record.sourceClient===sourceClient)||null;}
  function remember(job,sourceClient,{sourceIds=[],sourceNames=[]}={}){
    if(job?.status!=='complete'||!jobId(job.id)||!sourceClient||!Array.isArray(job.artifacts)||job.artifacts.length>128)throw new Error('Only completed, bounded worker results can be kept.');
    const existing=find(job,sourceClient);if(existing)return existing;
    // Copy the manifest so later polling or UI mutation cannot change what an
    // old artifact index, expected byte count and integrity hash refer to.
    const manifest=Object.freeze({...job,artifacts:Object.freeze(job.artifacts.map(item=>Object.freeze({...item})))});
    const record=Object.freeze({key:`result-${++sequence}`,job:manifest,sourceClient,sourceIds:Object.freeze([...new Set(sourceIds.filter(id=>typeof id==='string'))].slice(0,24)),sourceNames:Object.freeze([...new Set(sourceNames.filter(name=>typeof name==='string').map(name=>text(name)))].slice(0,24))});
    records.set(record.key,record);
    while(records.size>limit)records.delete(records.keys().next().value);
    return record;
  }
  return {
    remember,find,
    get:key=>records.get(key)||null,
    isCurrent:record=>!!record&&records.get(record.key)===record,
    clear:()=>records.clear(),
    list:()=>[...records.values()].map(({key,job,sourceIds,sourceNames})=>({
      key,id:job.id,engine:text(job.engine,80),status:job.status,
      created:typeof job.created==='number'||typeof job.created==='string'?job.created:null,
      sourceIds:[...sourceIds],sourceNames:[...sourceNames],
      artifacts:job.artifacts.map((item,index)=>({index,name:text(item.name),kind:text(item.kind,40),size:Number.isSafeInteger(item.size)?item.size:null,sha256:typeof item.sha256==='string'&&/^[a-f0-9]{64}$/.test(item.sha256)?item.sha256:null})),
    })),
  };
}

// A copied job identifier alone is not authority to read another worker's job.
// This only carries existing ancestry; it never opts into object naming.
export function sourceJobOptions(binding,sourceClient){
  return binding?.sourceClient===sourceClient&&sourceClient&&jobId(binding.job)?{source_job:binding.job}:{};
}

// Completion should not steal focus from a new source, map, or street edit.
export function shouldOpenCompletedResult(start,current){
  return !!start&&start.sourceId===current.sourceId&&start.viewRevision===current.viewRevision&&!current.street;
}
