import {sha256} from './operational-twin.mjs';
import {createFacilityReview} from './facility-review.mjs';
import {mountFacilityReview} from './facility-review-ui.mjs';

const MAX_BYTES=16*1024*1024;
const $=id=>document.getElementById(id);
let generation=0,dispose=null,sceneFile=null,cloudFile=null,fixtureRequest=null,alive=true;

function status(message,error=false){
  $('facility-page-status').textContent=message;
  $('facility-page-status').classList.toggle('error',error);
}
function clearView(){
  dispose?.();dispose=null;
  $('facility-host').replaceChildren();$('facility-host').hidden=true;
  $('facility-entry-empty').hidden=false;
}
function begin(){
  generation++;fixtureRequest?.abort();fixtureRequest=null;clearView();
  $('facility-clear').disabled=false;
  return generation;
}
const current=epoch=>alive&&epoch===generation;
function json(bytes,label){
  if(bytes.byteLength>MAX_BYTES)throw Error(`${label} limit is 16 MiB.`);
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw Error(`${label} must be valid UTF-8 JSON.`);}
}
function download(name,value,type='application/json'){
  const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function mount(sceneBytes,cloudBytes,epoch,example=false){
  if(!current(epoch))return;
  const scene=json(sceneBytes,'Scene'),cloud=json(cloudBytes,'Source cloud'),sceneSha=await sha256(sceneBytes);
  if(!current(epoch))return;
  const review=await createFacilityReview(scene,cloud,sceneSha);
  if(!current(epoch))return;
  $('facility-host').hidden=false;$('facility-entry-empty').hidden=true;
  const label=example?'AUTHORED SOFTWARE FIXTURE · not a phone reconstruction or laser scan. ':'';
  const release=mountFacilityReview({host:$('facility-host'),context:{scene,cloud,dirty:false},sceneSha,
    isCurrent:()=>current(epoch),status:(message,error)=>{if(current(epoch))status(label+message,error);},download,open:true});
  if(!current(epoch)){release();return;}
  dispose=release;
  status(label+`${review.parts.length} compiled components and ${review.pointCount.toLocaleString()} retained points. Source binding checked; opening the local view.`);
}
async function loadFiles(){
  const epoch=begin();
  if(!sceneFile||!cloudFile){status(sceneFile?'Scene selected. Open its matching arena-cloud.json.':'Source cloud selected. Open its matching scene.json.');return;}
  try{
    if(sceneFile.size>MAX_BYTES)throw Error('Scene limit is 16 MiB.');
    if(cloudFile.size>MAX_BYTES)throw Error('Source cloud limit is 16 MiB.');
    status('Reading the selected files and checking their source binding…');
    const [sceneBytes,cloudBytes]=await Promise.all([sceneFile.arrayBuffer(),cloudFile.arrayBuffer()]);
    await mount(sceneBytes,cloudBytes,epoch);
  }catch(error){if(current(epoch)){clearView();status('Files refused: '+error.message,true);}}
}
async function fixtureBytes(response,label){
  if(!response.ok)throw Error(`${label} example unavailable (${response.status}).`);
  const length=Number(response.headers.get('content-length'));
  if(Number.isFinite(length)&&length>MAX_BYTES)throw Error(`${label} limit is 16 MiB.`);
  // Bound the streamed body as well as Content-Length, which may be absent or incorrect.
  const reader=response.body?.getReader();
  if(!reader){const bytes=await response.arrayBuffer();if(bytes.byteLength>MAX_BYTES)throw Error(`${label} limit is 16 MiB.`);return bytes;}
  const chunks=[];let size=0;
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error(`${label} limit is 16 MiB.`);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes.buffer;
}
async function example(){
  const epoch=begin();sceneFile=null;cloudFile=null;
  $('facility-scene-file').value='';$('facility-cloud-file').value='';
  const controller=new AbortController();fixtureRequest=controller;
  status('Opening the authored software fixture. These points are not a reconstruction…');
  try{
    const responses=await Promise.all(['asbuilt-current.scene.json','asbuilt-source.cloud.json'].map(name=>fetch('./fixtures/'+name,{signal:controller.signal})));
    const [sceneBytes,cloudBytes]=await Promise.all([fixtureBytes(responses[0],'Scene'),fixtureBytes(responses[1],'Source cloud')]);
    await mount(sceneBytes,cloudBytes,epoch,true);
  }catch(error){if(current(epoch)){controller.abort();clearView();status('Example unavailable: '+error.message,true);}}
  finally{if(fixtureRequest===controller)fixtureRequest=null;}
}
$('facility-scene-file').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;sceneFile=file;void loadFiles();});
$('facility-cloud-file').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;cloudFile=file;void loadFiles();});
$('facility-example').addEventListener('click',()=>void example());
$('facility-clear').addEventListener('click',()=>{begin();sceneFile=null;cloudFile=null;$('facility-scene-file').value='';$('facility-cloud-file').value='';$('facility-clear').disabled=true;status('Source files cleared. Choose both matching files to open your space.');});
window.addEventListener('pagehide',event=>{if(!event.persisted){alive=false;begin();}});
