import {createAsBuiltJobs,validatePhotoEvidence} from './asbuilt-worker.mjs';
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
/** Mounted only for the exact source client's authorized completed scene. */
export function mountAsBuiltHosted({host,context,sceneSha,isCurrent,getUpdate,status=()=>{}}){
  const client=context.sourceClient,engines=client?.caps?.engines??[];
  if(!client||!context.job||client.caps?.owner_id==='site-visitors'||!engines.some(e=>['asbuilt-update','asbuilt-evidence'].includes(e.id)&&e.available))return {reset(){},select(){},dispose(){}};
  const section=el('section');section.className='asbuilt-hosted';section.append(el('h4','Review the source. Download the corrected IFC.'),el('p','Use the connected worker for this capture. Originals remain unchanged. Capture images and model differences do not certify physical accuracy.'));
  const consent=el('input');consent.type='checkbox';const label=el('label');label.className='asbuilt-check';label.append(consent,el('span','I approve sending the selected IFC/review, or retrieving retained source photos, through this connected processing session.'));section.append(label);
  const update=el('button','Create reviewed IFC copy'),evidence=el('button','Show selected component photos'),cancel=el('button','Cancel review job');for(const b of [update,evidence,cancel])b.type='button';
  update.hidden=!engines.some(e=>e.id==='asbuilt-update'&&e.available);evidence.hidden=!engines.some(e=>e.id==='asbuilt-evidence'&&e.available);cancel.hidden=true;
  const selected=el('p','Select a matched component to inspect its capture evidence.'),message=el('p'),links=el('div'),photos=el('div');message.setAttribute('role','status');photos.className='asbuilt-photos';section.append(update,evidence,cancel,selected,message,links,photos);host.append(section);
  let disposed=false,epoch=0,componentId=null,urls=[];
  const valid=()=>!disposed&&isCurrent()&&!context.dirty;
  const jobs=createAsBuiltJobs({client,sourceJob:context.job,isCurrent:valid,onStatus:s=>{if(valid())message.textContent=s;}});
  function clear(){urls.forEach(URL.revokeObjectURL);urls=[];photos.replaceChildren();links.replaceChildren();}
  function reset(){epoch++;clear();if(message.textContent)message.textContent='Review changed. Previous results cleared.';void jobs.stop().catch(e=>status('Review cancellation unconfirmed: '+e.message,true));}
  async function download(job,index){if(!valid())throw Error('Reopen the matching source scene.');const data=await client.previewArtifact(job,index);if(!valid())throw Error('Source scene changed.');const a=el('a'),url=URL.createObjectURL(new Blob([data]));a.href=url;a.download=job.artifacts[index].name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function submit(kind){
    if(jobs.busy)return;
    try{
      if(!valid())throw Error('Reopen the compiled scene before running a review.');if(!consent.checked)throw Error('Approve processing in this connected session first.');
      const version=++epoch,selectedId=componentId;clear();let files;
      if(kind==='update'){const {bytes,request}=getUpdate();files=[{kind:'ifc',file:new File([bytes],'prior.ifc')},{kind:'asbuilt',file:new File([JSON.stringify(request)],'asbuilt-review.json',{type:'application/json'})}];}
      else {if(!selectedId)throw Error('Select a matched component first.');const request={schema:'brainsnn.asbuilt-evidence-request.v1',sceneSha256:sceneSha,componentId:selectedId,reviewed:true};files=[{kind:'asbuilt',file:new File([JSON.stringify(request)],'asbuilt-evidence.json',{type:'application/json'})}];}
      update.disabled=evidence.disabled=true;cancel.hidden=false;
      const job=await jobs.run(kind==='update'?'asbuilt-update':'asbuilt-evidence',files);
      if(!valid()||version!==epoch)return;
      if(kind==='evidence'){
        const index=job.artifacts.findIndex(a=>a.name==='asbuilt-photo-evidence.json');if(index<0)throw Error('Worker returned no photo-evidence report.');
        const bytes=await client.previewArtifact(job,index),report=validatePhotoEvidence(JSON.parse(new TextDecoder().decode(bytes)),{sceneSha,componentId:selectedId,revision:context.scene.componentGraph.revision});
        if(!valid()||version!==epoch)return;
        for(const f of report.frames){const i=job.artifacts.findIndex(a=>a.name===f.previewName&&a.sha256===f.previewSha256);if(i<0)throw Error('Photo preview is missing or has another hash.');const data=await client.previewArtifact(job,i);if(!valid()||version!==epoch)return;const url=URL.createObjectURL(new Blob([data],{type:'image/jpeg'}));urls.push(url);const figure=el('figure'),panel=el('div'),image=el('img'),box=el('i');panel.className='asbuilt-photo';image.src=url;image.alt='Retained capture frame with projected member-point bounds';const b=f.normalizedPointBounds;Object.assign(box.style,{left:100*b[0]+'%',top:100*b[1]+'%',width:100*(b[2]-b[0])+'%',height:100*(b[3]-b[1])+'%'});panel.append(image,box);figure.append(panel,el('figcaption',`${f.frameId} · resized retained frame · point bounds, not segmentation. Original SHA-256 ${f.originalImageSha256}`));photos.append(figure);}
        message.textContent=report.status==='available'?'Retained capture frames loaded. Projected point bounds and visibility are internal evidence.':'Photo evidence unavailable: '+report.reason;
      }else message.textContent='Updated IFC written and reopened by the worker. Only reviewed placements changed. Physical accuracy remains unchecked.';
      for(let i=0;i<job.artifacts.length;i++){const b=el('button','Download '+job.artifacts[i].name);b.type='button';b.onclick=()=>void download(job,i).catch(e=>message.textContent=e.message);links.append(b);}
    }catch(error){if(valid())message.textContent=error.name==='AbortError'?'Review cancelled.':error.message;}
    finally{if(!disposed){update.disabled=evidence.disabled=false;cancel.hidden=true;}}
  }
  update.onclick=()=>void submit('update');evidence.onclick=()=>void submit('evidence');cancel.onclick=()=>{epoch++;void jobs.stop().then(()=>message.textContent='Review cancellation confirmed.').catch(e=>message.textContent='Cancellation unconfirmed: '+e.message);};
  const dialog=host.closest('dialog');function dispose(){if(disposed)return;disposed=true;epoch++;clear();void jobs.dispose().catch(e=>status('Review cancellation unconfirmed: '+e.message,true));dialog?.removeEventListener('close',dispose);window.removeEventListener('pagehide',dispose);section.remove();}
  dialog?.addEventListener('close',dispose);window.addEventListener('pagehide',dispose);
  return {reset,select(id,name){if(componentId!==id){reset();componentId=id;selected.textContent=id?'Selected capture component: '+name:'This prior has no matched current component.';}},dispose};
}
