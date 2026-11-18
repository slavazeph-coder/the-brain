// A bounded view of the exact drawing operations used by the worker's PDF exporter.
// No worker HTML, SVG, external resources or PDF script is inserted into the page.
export const MAX_DRAWING_PREVIEW_BYTES=4*1024**2;
const MAX_OPS=30000,NS='http://www.w3.org/2000/svg',digest=/^[a-f0-9]{64}$/;
const fail=message=>{throw Error(message);};
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const tuple=(v,n,min=-10000,max=10000)=>Array.isArray(v)&&v.length===n&&v.every(x=>finite(x,min,max));
const colour=v=>v===null||tuple(v,3,0,1);
const dash=v=>v===null||Array.isArray(v)&&v.length>0&&v.length<=16&&v.every(x=>finite(x,.001,100));

/** Validate source identity and every rendering primitive before making any SVG nodes. */
export function validateDrawingPreview(value,{scene,sceneSha,cloudSha,pdf}){
  const graph=scene?.componentGraph,source=value?.source;
  if(value?.schema!=='brainsnn.drawing-preview.v1'||value.metricVerified!==false||value.physicalDimensionsVerified!==false)fail('Unsupported drawing preview or verification claim.');
  if(scene?.units!=='m'||!digest.test(sceneSha??'')||!digest.test(cloudSha??'')||graph?.sourceSha256!==cloudSha||!Number.isSafeInteger(graph?.revision)||graph.revision<0||source?.sceneFileSha256!==sceneSha||source?.cloudPointsSha256!==cloudSha||source?.revision!==graph.revision)fail('The drawings do not match this scene, source points and revision.');
  if(pdf?.name!=='drawing-set.pdf'||!digest.test(pdf.sha256??'')||!Number.isSafeInteger(pdf.size)||pdf.size<1||value.pdf?.name!==pdf.name||value.pdf.sha256!==pdf.sha256||value.pdf.bytes!==pdf.size)fail('The drawing preview does not match the PDF in this job.');
  if(value.paper?.width!==420||value.paper?.height!==297||value.paper?.units!=='mm'||!text(value.scaleSentence,600))fail('Invalid drawing paper or scale evidence.');
  if(!Array.isArray(value.sheets)||value.sheets.length<1||value.sheets.length>256)fail('The drawing set exceeds the inline sheet limit.');
  let count=0;const numbers=new Set();
  for(const sheet of value.sheets){
    if(!text(sheet.number,40)||numbers.has(sheet.number)||!text(sheet.title,200)||!(sheet.scale===null||Number.isSafeInteger(sheet.scale)&&sheet.scale>0&&sheet.scale<=5000)||!Array.isArray(sheet.ops))fail('Invalid drawing sheet.');
    numbers.add(sheet.number);count+=sheet.ops.length;if(count>MAX_OPS)fail('The drawing set exceeds the inline detail limit.');
    for(const op of sheet.ops){
      if(!Array.isArray(op))fail('Invalid drawing operation.');
      if(op[0]==='line'&&op.length===5&&tuple(op[1],4)&&finite(op[2],0,20)&&tuple(op[3],3,0,1)&&dash(op[4]))continue;
      if(op[0]==='poly'&&op.length===6&&Array.isArray(op[1])&&op[1].length>=3&&op[1].length<=128&&op[1].every(p=>tuple(p,2))&&finite(op[2],0,20)&&colour(op[3])&&colour(op[4])&&dash(op[5]))continue;
      if(op[0]==='text'&&op.length===8&&tuple(op[1],2)&&typeof op[2]==='string'&&op[2].length<=600&&finite(op[3],.01,40)&&['H','HB','C','CB'].includes(op[4])&&['l','c','r'].includes(op[5])&&tuple(op[6],3,0,1)&&finite(op[7],-360,360))continue;
      fail('Unsupported or oversized drawing operation.');
    }
  }
  return value;
}

const el=(tag,label)=>{const node=document.createElement(tag);if(label!==undefined)node.textContent=label;return node;};
const rgb=c=>c===null?'none':`rgb(${c.map(v=>Math.round(v*255)).join(',')})`;
const svgNode=(tag,attrs)=>{const node=document.createElementNS(NS,tag);for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));return node;};
function sheetSVG(sheet){
  const svg=svgNode('svg',{id:'drawing-sheet-preview',viewBox:'0 0 420 297',role:'img','aria-label':`${sheet.number}: ${sheet.title}. For review, dimensions unverified.`});
  const title=svgNode('title',{});title.textContent=`${sheet.number} · ${sheet.title}`;svg.append(title,svgNode('rect',{width:420,height:297,fill:'white'}));
  for(const op of sheet.ops){
    let node;
    if(op[0]==='text'){
      const [,[x,y],label,size,font,anchor,fill,angle]=op;
      node=svgNode('text',{x,y,'font-size':size,'font-family':font.startsWith('C')?'Courier, monospace':'Helvetica, Arial, sans-serif','font-weight':font.endsWith('B')?'bold':'normal','text-anchor':{l:'start',c:'middle',r:'end'}[anchor],fill:rgb(fill)});
      if(angle)node.setAttribute('transform',`rotate(${-angle} ${x} ${y})`);node.textContent=label;
    }else{
      const stroke=op[3],fill=op[0]==='poly'?op[4]:null,pattern=op[0]==='poly'?op[5]:op[4];
      node=op[0]==='line'?svgNode('line',{x1:op[1][0],y1:op[1][1],x2:op[1][2],y2:op[1][3]}):svgNode('polygon',{points:op[1].map(p=>p.join(',')).join(' ')});
      node.setAttribute('stroke',rgb(stroke));node.setAttribute('fill',rgb(fill));node.setAttribute('stroke-width',String(op[2]));
      if(pattern)node.setAttribute('stroke-dasharray',pattern.join(' '));
    }
    svg.append(node);
  }
  return svg;
}

/** Mount against the original job/client. Reconnection cannot redirect these reads. */
export function mountDrawingReview({host,context,sceneSha,isCurrent=()=>true,status=()=>{},download}){
  if(!host||!context?.scene?.componentGraph||!sceneSha)return ()=>{};
  const artifacts=context.artifacts??[],pdfIndex=artifacts.findIndex(a=>a.name==='drawing-set.pdf'),previewIndex=artifacts.findIndex(a=>a.name==='drawing-preview.json');
  const pdf=artifacts[pdfIndex],preview=artifacts[previewIndex],client=context.sourceClient,job=context.job,sourceHash=context.hash,revision=context.scene.componentGraph.revision;
  const root=el('section');root.id='drawing-review';root.className='drawing-review';root.dataset.state='loading';
  const heading=el('div');heading.className='drawing-heading';const title=el('h3','Drawings of this space'),badge=el('span','FOR REVIEW · DIMENSIONS UNVERIFIED');badge.className='drawing-badge';heading.append(title,badge);
  const note=el('p','Plan, elevations, sections and schedules use the same compiled geometry as this model. Missing surfaces and object boxes still need review.');
  const message=el('p','Checking the drawings against this scene…');message.className='drawing-message';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
  const controls=el('div');controls.className='drawing-controls';controls.hidden=true;
  const label=el('label','Choose a sheet'),select=el('select');select.id='drawing-sheet-select';label.append(select);
  const zoomLabel=el('label','Page size'),zoom=el('select');zoom.id='drawing-page-size';for(const [value,name] of [['fit','Fit page'],['large','Large page']]){const option=el('option',name);option.value=value;zoom.append(option);}zoomLabel.append(zoom);
  const button=el('button','Download drawing PDF');button.id='drawing-download-pdf';button.type='button';button.disabled=true;
  controls.append(label,zoomLabel,button);
  const stage=el('div');stage.className='drawing-stage';stage.setAttribute('tabindex','0');stage.setAttribute('aria-label','Drawing sheet. Choose Large page to read details and scroll across the page.');stage.hidden=true;
  const caption=el('p');caption.className='drawing-caption';
  root.append(heading,note,message,controls,stage,caption);host.append(root);
  const controller=new AbortController();let disposed=false,model=null;
  const valid=()=>!disposed&&isCurrent();
  function say(value,error=false){if(valid()){message.textContent=value;message.classList.toggle('error',error);}}
  function invalidate(reason='The model has pending edits. Compile it again and open the new drawings.'){if(!valid())return;model=null;controller.abort();button.disabled=true;stage.replaceChildren();stage.hidden=true;controls.hidden=true;root.dataset.state='stale';say(reason,true);}
  function ready(){
    if(!valid())fail('The source scene changed. Open the matching model again.');
    if(context.dirty){invalidate();fail('Compile pending BIM edits before using these drawings.');}
    if(context.sourceClient!==client||context.job!==job||context.hash!==sourceHash||context.scene.componentGraph?.revision!==revision){invalidate('The drawing source changed. Reopen the scene.');fail('The drawing source changed. Reopen the scene.');}
  }
  function draw(){
    try{ready();if(!model)return;const sheet=model.sheets[Number(select.value)];if(!sheet)return;
      stage.replaceChildren(sheetSVG(sheet));stage.hidden=false;stage.classList.toggle('drawing-large',zoom.value==='large');
      caption.textContent=`${sheet.number} · ${sheet.title}${sheet.scale?` · PDF scale 1:${sheet.scale} at 100% on A3 paper`:''}. Screen size is not a measurement.`;
    }catch(error){if(valid()){say(error.message,true);stage.replaceChildren();stage.hidden=true;}}
  }
  select.addEventListener('change',draw);zoom.addEventListener('change',draw);
  async function save(){
    try{ready();if(!model||!pdf||typeof download!=='function')return;button.disabled=true;
      const bytes=await client.previewArtifact({id:job,artifacts},pdfIndex,controller.signal);ready();
      await download(pdf.name,new Blob([bytes],{type:'application/pdf'}),'application/pdf');ready();say('Drawing PDF downloaded. Its dimensions remain unverified.');
    }catch(error){if(valid()&&!controller.signal.aborted){say(error.message,true);status(error.message,true);}}
    finally{if(valid())button.disabled=!model;}
  }
  button.addEventListener('click',save);
  void(async()=>{
    try{
      ready();
      if(!pdf||!preview){root.dataset.state='unavailable';say(pdf?'This job has a drawing PDF but no inline preview. Use drawing-set.pdf in this scene’s downloads.':'This job has no drawing set. Compile the metric scene with a worker that supports drawing exports.');return;}
      if(typeof client?.previewArtifact!=='function'||!Number.isSafeInteger(preview.size)||preview.size<1||preview.size>MAX_DRAWING_PREVIEW_BYTES)fail('Drawing preview is unavailable or exceeds the 4 MiB limit.');
      const bytes=await client.previewArtifact({id:job,artifacts},previewIndex,controller.signal);ready();
      if(bytes.byteLength>MAX_DRAWING_PREVIEW_BYTES)fail('Drawing preview exceeds the 4 MiB limit.');
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      model=validateDrawingPreview(value,{scene:context.scene,sceneSha,cloudSha:sourceHash,pdf});
      for(let i=0;i<model.sheets.length;i++){const sheet=model.sheets[i],option=el('option',`${sheet.number} · ${sheet.title}`);option.value=String(i);select.append(option);}
      select.value=String(Math.max(0,model.sheets.findIndex(s=>s.number==='A-101')));controls.hidden=false;button.disabled=typeof download!=='function';root.dataset.state='ready';
      say(`${model.sheets.length} sheets · ${model.scaleSentence} Source scene and component revision ${revision} match.`);draw();
    }catch(error){if(valid()&&!controller.signal.aborted){root.dataset.state='refused';say('Drawings unavailable: '+error.message,true);}}
  })();
  const dispose=()=>{disposed=true;controller.abort();select.removeEventListener('change',draw);zoom.removeEventListener('change',draw);button.removeEventListener('click',save);root.remove();};
  dispose.invalidate=invalidate;return dispose;
}
