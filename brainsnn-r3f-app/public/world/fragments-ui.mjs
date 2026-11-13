/** scene.frag for Unreal Engine and Fragments viewers, converted on this device from the scene's own scene.ifc.
 *  The converter (vendor/fragments-export.js, about 4 MB) loads only when the button is pressed. */
const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
const NAMES={IFCWALL:['wall','walls'],IFCSLAB:['floor slab','floor slabs'],IFCBUILDINGELEMENTPROXY:['object','objects'],IFCDOOR:['door','doors'],
  IFCWINDOW:['window','windows'],IFCOPENINGELEMENT:['opening','openings'],IFCFURNITURE:['piece of furniture','pieces of furniture'],
  IFCFURNISHINGELEMENT:['furnishing','furnishings'],IFCSPACE:['space','spaces'],IFCCOVERING:['covering','coverings'],IFCCOLUMN:['column','columns'],IFCBEAM:['beam','beams']};
const count=(n,[one,many])=>`${n.toLocaleString('en')} ${n===1?one:many}`;

/** What the converted file holds, in one sentence, from the summary the converter read back out of it.
 *  Throws when the file has no elements, so an empty file is never offered. */
export function fragmentsReport(summary){
  const total=summary?.elements;
  if(!Number.isSafeInteger(total)||total<1)throw Error('The converted file has no elements with geometry, so it was not kept. Download scene.ifc instead.');
  const named=kind=>NAMES[kind]||[kind.replace(/^IFC/,'').toLowerCase(),kind.replace(/^IFC/,'').toLowerCase()+'s'];
  // Most numerous first; equal counts in alphabetical order, so the sentence does not depend on the file's own order.
  const parts=Object.entries(summary.byClass||{}).map(([kind,n])=>[named(kind),n]).sort((a,b)=>b[1]-a[1]||a[0][0].localeCompare(b[0][0])).map(([names,n])=>count(n,names));
  if(summary.unknownVolumes>0)parts.push(`${count(summary.unknownVolumes,['volume','volumes'])} marking space the scan never saw`);
  const kept=summary.withProvenance===total?(total===1?'It keeps its BrainSNN properties':`${total===2?'Both':`All ${total.toLocaleString('en')}`} keep their BrainSNN properties`)
    :`${(summary.withProvenance||0).toLocaleString('en')} of ${total.toLocaleString('en')} keep their BrainSNN properties; check the rest against scene.ifc`;
  return `scene.frag holds ${count(total,['element','elements'])}: ${parts.join(', ')}. ${kept}.`;
}

export function mountFragments({host,context,isCurrent=()=>true,status=()=>{},event=()=>{},
  load=()=>import('./vendor/fragments-export.js'),wasmPath=new URL('./vendor/',import.meta.url).href}){
  const index=context.artifacts?.findIndex(a=>a.name==='scene.ifc')??-1,client=context.sourceClient;
  if(index<0||typeof client?.previewArtifact!=='function')return ()=>{};
  const section=el('section');section.className='dimension-card fragments-export';section.dataset.fragmentsExport='';
  section.append(el('h3','Open this model in Unreal Engine'),
    el('p','scene.frag is the open Fragments format for building models. The open-source FragmentsUnreal plugin (Unreal Engine 5.4 or later) and That Open viewers load it, and each element keeps its BrainSNN properties.'),
    Object.assign(el('p','It is converted on this device from scene.ifc; nothing is uploaded. We read the file back before you download it, but we have not opened it in Unreal Engine ourselves. Review dimensions and openings as you would for the IFC.'),{className:'micro'}));
  const button=el('button','Make scene.frag');button.type='button';button.className='primary wide';
  const message=el('p');message.setAttribute('role','status');const links=el('div');section.append(button,message,links);host.append(section);
  let url=null,disposed=false;
  const valid=()=>!disposed&&isCurrent();
  button.onclick=async()=>{
    button.disabled=true;message.textContent='Converting scene.ifc on this device…';links.replaceChildren();
    if(url){URL.revokeObjectURL(url);url=null;}
    try{
      const ifc=new Uint8Array(await client.previewArtifact({id:context.job,artifacts:context.artifacts},index));
      if(!valid())return;
      const {ifcToFragments}=await load();
      const {bytes,summary}=await ifcToFragments(ifc,wasmPath);
      if(!valid())return;
      const report=fragmentsReport(summary);
      url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));
      const link=el('a','Download scene.frag');link.href=url;link.download='scene.frag';
      links.replaceChildren(link);message.textContent=report;
      status('scene.frag is ready to download.');event('fragments_file_created',{sourceJob:context.job,elements:summary.elements,bytes:bytes.length});
    }catch(error){if(valid())message.textContent=`scene.frag was not made: ${error?.message||error}`;}
    finally{button.disabled=false;}
  };
  return ()=>{disposed=true;if(url)URL.revokeObjectURL(url);section.remove();};
}
