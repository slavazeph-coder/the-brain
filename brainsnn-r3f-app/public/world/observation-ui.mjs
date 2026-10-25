import {importObservations,reviewObservation,exportObservationProof,frameTimeSeconds} from './observations.mjs';
import {detectionSidecar,DETECTION_CONFIG} from './detections.mjs';

const MAX_JSON=256*1024,MAX_PNG=1024*1024;
const node=(tag,text,attrs={})=>{const element=document.createElement(tag);if(text!==null)element.textContent=text;Object.assign(element,attrs);return element;};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
function pngSize(buffer){
  const bytes=new Uint8Array(buffer),view=new DataView(buffer);
  if(bytes.length<33||![137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)||view.getUint32(8)!==13||view.getUint32(12)!==0x49484452)throw new Error('Frame artifact is not a PNG.');
  const width=view.getUint32(16),height=view.getUint32(20);
  if(width<1||height<1||width>512||height>512)throw new Error('Frame artifact exceeds its image bounds.');
  return {width,height};
}
async function checkedImage(buffer,frame){
  const size=pngSize(buffer);
  if(size.width!==frame.width||size.height!==frame.height)throw new Error('Frame dimensions do not match its receipt.');
  const url=URL.createObjectURL(new Blob([buffer],{type:'image/png'}));
  try{const image=new Image();image.src=url;await image.decode();if(image.naturalWidth!==size.width||image.naturalHeight!==size.height)throw new Error('Frame decode disagrees with its header.');return url;}
  catch(error){URL.revokeObjectURL(url);throw error;}
}

/** Display worker proposals beside verified frame bytes; never edit a map. */
export function createObservationReview({getSources,status,event}){
  let rows=[];
  const hashes=new WeakMap();
  const bindings=row=>getSources().includes(row.source)?[row.binding]:[];
  async function sourceHash(source){
    if(!hashes.has(source.file))hashes.set(source.file,source.file.arrayBuffer().then(digest).catch(error=>{hashes.delete(source.file);throw error;}));
    return hashes.get(source.file);
  }
  function dispose(row){for(const frame of row.previews)URL.revokeObjectURL(frame.url);}
  async function load(job,client,index,signal){
    const artifact=job.artifacts?.[index];
    if(!artifact||artifact.name!=='observations.json'||artifact.kind!=='observations'||artifact.size>MAX_JSON)throw new Error('Missing bounded observation artifact.');
    if(rows.some(row=>row.job===job.id&&row.sha256===artifact.sha256))return;
    if(rows.length>=4)throw new Error('Remove an earlier source before reviewing another observation job.');
    const previews=[];
    try{
      const receiptIndex=job.artifacts.findIndex(item=>item.name==='observation-frames.json'&&item.kind==='observation-index'&&item.size<=MAX_JSON);
      if(receiptIndex<0)throw new Error('The worker did not provide a separate frame receipt.');
      const decoder=new TextDecoder('utf-8',{fatal:true});
      const receipt=JSON.parse(decoder.decode(await client.previewArtifact(job,receiptIndex,signal)));
      if(receipt.schema!=='brainsnn.world.observation-frames.v1'||Object.keys(receipt).sort().join(',')!=='frames,schema,source')throw new Error('Unsupported frame receipt.');
      let source=null;
      for(const candidate of getSources().filter(item=>item.file&&(['image','video'].includes(item.kind)))){
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        if((candidate.kind==='image'?'photo':'video')===receipt.source?.kind&&await sourceHash(candidate)===receipt.source?.sha256){source=candidate;break;}
      }
      if(!source)throw new Error('Keep the exact original source in this session before reviewing its observations.');
      const binding={sha256:await sourceHash(source),kind:source.kind==='image'?'photo':'video',frames:receipt.frames};
      const raw=decoder.decode(await client.previewArtifact(job,index,signal));
      const session=importObservations(raw,[binding]);
      for(const frame of session.frames){
        const frameIndex=job.artifacts.findIndex(item=>item.kind==='observation-frame'&&item.sha256===frame.sha256&&/\.png$/i.test(item.name)&&item.size<=MAX_PNG);
        if(frameIndex<0)throw new Error('A referenced frame is missing from this job.');
        const buffer=await client.previewArtifact(job,frameIndex,signal);
        previews.push({...frame,url:await checkedImage(buffer,frame)});
      }
      if(signal.aborted||!getSources().includes(source))throw new DOMException('Source removed or loading cancelled','AbortError');
      rows.push({job:job.id,sha256:artifact.sha256,source,binding,session,previews,drafts:new Map()});
      event('model_observations_loaded',{job:job.id,sourceSHA256:binding.sha256,count:session.observations.length,model:session.model});
    }catch(error){for(const frame of previews)URL.revokeObjectURL(frame.url);throw error;}
  }
  /** On-device detections for a photo: the same validation, source binding and review as worker observations. */
  async function loadDetections(source,{png,width,height,detections}){
    if(!getSources().includes(source)||source.kind!=='image')throw new Error('Keep the photo in this session to review its detections.');
    const sourceSha=await sourceHash(source),frameSha=await digest(png),configSha=await digest(new TextEncoder().encode(DETECTION_CONFIG));
    const frame={id:'photo',sha256:frameSha,width,height,timestamp:null},binding={sha256:sourceSha,kind:'photo',frames:[frame]};
    const session=importObservations(JSON.stringify(detectionSidecar({sourceSha256:sourceSha,frame,detections,configSha256:configSha})),[binding]);
    const url=await checkedImage(png,frame);
    if(!getSources().includes(source)){URL.revokeObjectURL(url);throw new DOMException('Source removed','AbortError');}
    // A fresh run on the same photo replaces its earlier on-device proposals.
    rows=rows.filter(row=>{if(row.job!=='on-device'||row.source!==source)return true;dispose(row);return false;});
    if(rows.length>=4){URL.revokeObjectURL(url);throw new Error('Remove an earlier source before reviewing another set of observations.');}
    rows.push({job:'on-device',sha256:frameSha,source,binding,session,previews:[{...frame,url}],drafts:new Map()});
    event('model_observations_loaded',{job:'on-device',sourceSHA256:sourceSha,count:session.observations.length,model:session.model});
    return session.observations.length;
  }
  function render(container){
    container.replaceChildren();
    if(!rows.length){container.append(node('p','A configured observation worker can propose labels from a photo or selected video frames. Review its suggestions here.'));return;}
    container.append(node('h3','Review model observations'),node('p','These are partial model suggestions. Review each against its frame. Accepting a label does not measure scale or add collision geometry.'),node('p','For offline review, download the frame images from Evidence alongside the proof pack.',{className:'micro'}));
    for(const row of rows){
      if(!getSources().includes(row.source))continue;
      const group=node('details',null,{open:true,className:'observation-group'}),summary=node('summary',row.source.name);
      group.append(summary,node('p',`${row.session.model.id} · ${row.session.reviews.filter(item=>item.status!=='pending').length}/${row.session.reviews.length} reviewed`,{className:'micro'}));
      if(!row.session.observations.length)group.append(node('p','No objects were proposed. This does not establish that the space is clear.'));
      for(const frame of row.previews){
        const frameGroup=node('section',null,{className:'observation-frame-group'}),figure=node('div',null,{className:'observation-frame'});
        figure.append(node('img',null,{src:frame.url,alt:'Verified sampled frame from '+row.source.name}));
        const frameLabel=frame.timestamp===null?'Photo frame':`Decoded source time ${frameTimeSeconds(frame.timestamp).toFixed(3)} s`;
        const box=node('span',null,{className:'observation-box',hidden:true}),caption=node('p',frameLabel,{className:'micro'});
        figure.append(box);frameGroup.append(figure,caption);
        for(const observation of row.session.observations.filter(item=>item.frameId===frame.id)){
          const review=row.session.reviews.find(item=>item.observationId===observation.id),annotation=review.annotation||observation;
          const card=node('article',null,{className:'observation-card'}),heading=node('strong',annotation.label),state=node('span',review.status,{className:'badge'});
          card.append(heading,state);
          const focus=node('button','Show proposed bounds',{type:'button',className:'small',disabled:!annotation.box});
          focus.onclick=()=>{const b=annotation.box;box.hidden=false;Object.assign(box.style,{left:`${b[0]*100}%`,top:`${b[1]*100}%`,width:`${(b[2]-b[0])*100}%`,height:`${(b[3]-b[1])*100}%`});caption.textContent=`${frameLabel} · ${annotation.label} · model-proposed 2D bounds`;};
          card.append(focus);
          if(review.status==='pending'){
            const draft=row.drafts.get(observation.id)||{label:annotation.label,uncertainty:annotation.uncertainty,keepBox:!!annotation.box};row.drafts.set(observation.id,draft);
            const label=node('label','Object label'),input=node('input',null,{value:draft.label,maxLength:120});label.append(input);
            const uncertainty=node('label','Uncertainty / limitations'),notes=node('textarea',null,{value:draft.uncertainty,maxLength:600,rows:2});uncertainty.append(notes);
            const keep=node('input',null,{type:'checkbox',checked:draft.keepBox}),keepLabel=node('label','Keep proposed 2D box',{className:'check'});keepLabel.prepend(keep);keepLabel.hidden=!annotation.box;
            input.oninput=()=>{draft.label=input.value;};notes.oninput=()=>{draft.uncertainty=notes.value;};keep.onchange=()=>{draft.keepBox=keep.checked;};
            const accept=node('button','Accept / save edit',{type:'button',className:'small'}),reject=node('button','Reject',{type:'button',className:'small'});
            const decide=action=>{try{
              const replacement={label:input.value.trim(),uncertainty:notes.value.trim(),...(keep.checked&&annotation.box?{box:annotation.box}:{})};
              const original={label:observation.label,uncertainty:observation.uncertainty,...(observation.box?{box:observation.box}:{})};
              const decision=action==='reject'?{action}:{action:JSON.stringify(replacement)===JSON.stringify(original)?'accept':'edit'};
              if(decision.action==='edit')decision.annotation=replacement;
              row.session=reviewObservation(row.session,observation.id,decision,bindings(row));row.drafts.delete(observation.id);
              event('observation_reviewed',{job:row.job,observation:observation.id,decision:decision.action});render(container);status('Observation review saved. Planning geometry is unchanged.');
            }catch(error){status(error.message,true);}};
            accept.onclick=()=>decide('accept');reject.onclick=()=>decide('reject');card.append(label,uncertainty,keepLabel,accept,reject);
          }else{card.append(node('p',annotation.uncertainty));if(review.status==='edited')card.append(node('p','Model originally proposed: '+observation.label,{className:'micro'}));}
          frameGroup.append(card);
        }
        group.append(frameGroup);
      }
      container.append(group);
    }
  }
  return {load,loadDetections,render,proofs:()=>rows.filter(row=>getSources().includes(row.source)).map(row=>exportObservationProof(row.session,bindings(row))),
    removeSource(source){rows=rows.filter(row=>{if(row.source!==source)return true;dispose(row);return false;});},
    clear(){rows.forEach(dispose);rows=[];}};
}
