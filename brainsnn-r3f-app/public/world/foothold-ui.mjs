import {inspectCloud} from './foothold-focus.mjs';
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
/** Local-only diagnostic on the exact cloud already open in scene review. */
export function mountFootholdReview({host,context,sceneSha,isCurrent}){
  const cloud=context?.cloud;
  if(cloud?.units!=='m'||cloud.coordinateFrame!=='right-handed-y-up'||!Array.isArray(cloud.points)||!cloud.points.length)return ()=>{};
  const section=el('section');section.id='scene-foothold-focus';section.className='dimension-card';
  section.append(el('h3','Inspect terrain around two footsteps'),el('p','Research tool inspired by ETH Zurich’s Watch Your Step. Positions below are hypothetical queries, not learned predictions or safe walking targets. Uses this source cloud locally; no upload or robot command.'));
  let minX=Infinity,maxX=-Infinity,minY=Infinity,minZ=Infinity,maxZ=-Infinity;
  for(const p of cloud.points){if(!Array.isArray(p)||p.length<3||!p.slice(0,3).every(Number.isFinite)){section.append(el('p','Invalid point coordinates.'));host.append(section);return ()=>section.remove();}minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);minZ=Math.min(minZ,p[2]);maxZ=Math.max(maxZ,p[2]);}
  const fields=[['Hypothetical base X · m',(minX+maxX)/2],['Hypothetical base Y height · m',minY+.8],['Hypothetical base Z · m',(minZ+maxZ)/2],['Heading · degrees (positive left)',0],['Step 1 forward · m',0],['Step 1 left · m',.1],['Step 2 forward · m',0],['Step 2 left · m',-.1]];
  const grid=el('div');grid.className='field-row';section.append(grid);
  const inputs=fields.map(([label,value])=>{const l=el('label',label),input=el('input');input.type='number';input.step='.01';input.value=Number(value).toFixed(3);input.setAttribute('aria-label',label);l.append(input);grid.append(l);return input;});
  section.append(el('p','Yaw-only inspection: the hypothetical body is upright. Each patch has 49 samples at 5 cm spacing. Sparse or ambiguous surfaces stay unknown. This does not inspect head clearance, moving objects or friction.'));
  const run=el('button','Inspect footstep patches');run.type='button';run.className='wide';
  const save=el('button','Download footstep evidence');save.type='button';save.disabled=true;save.className='wide';
  const message=el('p');message.setAttribute('role','status');const result=el('div');section.append(run,message,result,save);host.append(section);
  let report=null,disposed=false;const dialog=host.closest('dialog');
  function invalidate(){report=null;save.disabled=true;result.replaceChildren();message.textContent='Query changed. Inspect again before exporting.';}
  inputs.forEach(input=>input.addEventListener('input',invalidate));
  run.onclick=()=>{report=null;save.disabled=true;result.replaceChildren();try{
    if(disposed||!isCurrent()||context.dirty)throw Error('Reopen the matching scene and save or discard pending edits.');
    const values=inputs.map(input=>input.value===''?NaN:Number(input.value));
    const query={schema:'brainsnn.foothold-query.v1',base_position_brainsnn_m:values.slice(0,3),yaw_rad:values[3]*Math.PI/180,footholds_base_xy_m:[values.slice(4,6),values.slice(6,8)],min_points:2,max_spread_m:.03};
    report=inspectCloud(cloud,query);
    const cloudHash=context.artifacts?.find(a=>a.name==='arena-cloud.json')?.sha256;
    report.source_scene_sha256=sceneSha??null;report.source_cloud_sha256=cloudHash??null;
    message.textContent=`${report.patches.reduce((n,p)=>n+p.known_count,0)}/98 heights supported by this snapshot. ${report.sample_complete?'102-value diagnostic observation available.':'Observation withheld: missing or out-of-bounds terrain.'} No walking-safety result.`;
    report.patches.forEach((patch,index)=>{
      const wrap=el('section');wrap.append(el('h4',`Step ${index+1} · ${patch.known_count}/49 observed`));
      const table=el('table');table.style.width='100%';table.style.tableLayout='fixed';table.style.borderCollapse='collapse';table.style.fontSize='.7rem';const caption=el('caption','Rows: forward offsets; columns: left offsets. Values are relative heights in metres; ? = unknown.');caption.style.fontSize='.75rem';caption.style.marginBottom='.5rem';table.append(caption);
      for(let row=0;row<7;row++){const tr=el('tr');for(let col=0;col<7;col++){const i=row*7+col,v=patch.heights[i],td=el('td',v===null?'?':v.toFixed(2));td.style.textAlign='center';td.style.padding='.2rem';td.style.border='1px solid currentColor';td.style.opacity=v===null?'.45':'1';td.title=patch.status[i];tr.append(td);}table.append(tr);}wrap.append(table);result.append(wrap);
    });save.disabled=false;
  }catch(error){report=null;message.textContent=error.message;}};
  save.onclick=()=>{if(disposed||!report||!isCurrent()||context.dirty){invalidate();return;}const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='foothold-evidence.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  function dispose(){if(disposed)return;disposed=true;dialog?.removeEventListener('close',dispose);report=null;section.remove();}
  dialog?.addEventListener('close',dispose);return dispose;
}
