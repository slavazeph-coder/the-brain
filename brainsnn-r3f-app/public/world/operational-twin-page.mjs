import {sha256,sceneBinding} from './operational-twin.mjs';
import {mountOperationalTwin} from './operational-twin-ui.mjs';
import {trainingCraneTwin} from './operational-twin-example.mjs';
const $=id=>document.getElementById(id);let dispose=null,epoch=0,requestEpoch=0;
function download(name,value,type){const data=typeof value==='string'?value:JSON.stringify(value,null,2),url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function openBytes(bytes,{example=false,generation}={}){
  if(bytes.byteLength>16*1024*1024)throw Error('Scene limit is 16 MiB.');
  const scene=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sceneSha=await sha256(bytes);sceneBinding(scene,sceneSha);
  const initialTwin=example?await trainingCraneTwin(scene,sceneSha):null;
  if(generation!==requestEpoch)return;dispose?.();const activeEpoch=++epoch;
  dispose=mountOperationalTwin({host:$('twin-host'),context:{scene,dirty:false},sceneSha,isCurrent:()=>activeEpoch===epoch,download,open:true,initialTwin});
  $('twin-page-status').textContent=example?'AUTHORED EXAMPLE · 7 machine components + floor · 3 entered joints · no scan or physical validation.':'Your compiler scene is open locally. Equipment knowledge and joints start empty; import a matching overlay or add your records.';
}
async function example(){const generation=++requestEpoch;try{const response=await fetch('./fixtures/operational-crane.scene.json');if(!response.ok)throw Error('Example scene unavailable.');await openBytes(await response.arrayBuffer(),{example:true,generation});}catch(e){if(generation===requestEpoch)$('twin-page-status').textContent=e.message;}}
$('twin-example').onclick=()=>void example();
$('twin-scene-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;const generation=++requestEpoch;try{if(file.size>16*1024*1024)throw Error('Scene limit is 16 MiB.');await openBytes(await file.arrayBuffer(),{generation});}catch(error){if(generation===requestEpoch)$('twin-page-status').textContent='Scene refused: '+error.message;}finally{e.target.value='';}};
window.addEventListener('pagehide',e=>{if(!e.persisted){epoch++;requestEpoch++;dispose?.();}});
void example();
