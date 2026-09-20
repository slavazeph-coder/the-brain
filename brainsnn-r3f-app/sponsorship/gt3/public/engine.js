/* Small, dependency-free controllers for the official Sketchfab viewer. */
(function(root){
'use strict';
const finite3=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const copyCamera=c=>{if(!c||!finite3(c.position)||!finite3(c.target))throw new Error('The viewer returned an invalid camera.');return {position:[...c.position],target:[...c.target]};};
function cameraMove(camera,action,homeDistance){const c=copyCamera(camera),v=c.position.map((x,i)=>x-c.target[i]),r=Math.hypot(...v);if(!(r>0)||!(homeDistance>0))throw new Error('Camera distance is unavailable.');if(action==='left'||action==='right'){const a=(action==='left'?-1:1)*Math.PI/3;c.position=[v[0]*Math.cos(a)-v[1]*Math.sin(a),v[0]*Math.sin(a)+v[1]*Math.cos(a),v[2]].map((x,i)=>x+c.target[i]);}else if(action==='top'){c.position=[c.target[0]+r*.04,c.target[1]-r*.08,c.target[2]+r*.996];}else if(action==='in'||action==='out'){const d=Math.max(homeDistance*.25,Math.min(homeDistance*2.5,r*(action==='in'?.82:1.22)));c.position=v.map((x,i)=>c.target[i]+x*d/r);}else throw new Error('Unknown camera control.');return c;}
class LatestQueue{
constructor(worker,onError=()=>{},limit=8){this.worker=worker;this.onError=onError;this.limit=limit;this.pending=new Map();this.running=false;this.waiters=[];this.highWater=0;}
put(key,value){if(!this.pending.has(key)&&this.pending.size>=this.limit)throw new Error('Too many pending placements.');this.pending.set(key,value);this.highWater=Math.max(this.highWater,this.pending.size);if(!this.running)void this.drain();}
clear(){this.pending.clear();if(!this.running)this.finish();}
async drain(){this.running=true;try{while(this.pending.size){const[key,value]=this.pending.entries().next().value;this.pending.delete(key);try{await this.worker(key,value);}catch(e){this.onError(e);}}}finally{this.running=false;this.finish();}}
finish(){if(!this.running&&!this.pending.size)for(const resolve of this.waiters.splice(0))resolve();}
idle(){return this.running||this.pending.size?new Promise(resolve=>this.waiters.push(resolve)):Promise.resolve();}
}
function apiCall(api,method,...args){return new Promise((resolve,reject)=>{if(typeof api?.[method]!=='function')return reject(new Error('This viewer does not support '+method+'.'));const timer=setTimeout(()=>reject(new Error('The viewer did not confirm '+method+'. Please retry.')),12000);try{api[method](...args,(error,result)=>{clearTimeout(timer);error?reject(new Error('The viewer could not complete '+method+'.')):resolve(result);});}catch(e){clearTimeout(timer);reject(e);}});}
class DecalStore{
constructor(call){this.call=call;this.slots=new Map();}
slot(id){if(!this.slots.has(id))this.slots.set(id,{texture:null,material:null,decal:null,textureKey:'',geometryKey:'',cleanup:null});return this.slots.get(id);}
async render(id,snapshot,texture,allowed){const slot=this.slot(id),ok=()=>allowed()&&snapshot.hit;if(!ok())return false;
if(slot.cleanup!==null){await this.call('destroyDecal',slot.cleanup,{deleteMaterial:false});slot.cleanup=null;}
if(!ok())return false;
if(slot.textureKey!==snapshot.textureKey){const data=texture(snapshot);if(slot.texture===null){const uid=await this.call('addTexture',data);if(typeof uid!=='string'||!uid)throw new Error('The viewer did not confirm the artwork texture.');slot.texture=uid;}else await this.call('updateTexture',data,slot.texture);slot.textureKey=snapshot.textureKey;}
if(!ok())return false;
if(slot.material===null){const material=await this.call('createMaterial',{name:'BrainSNN sponsor preview '+id,channels:{AlbedoPBR:{enable:true,factor:1,color:[1,1,1],texture:{uid:slot.texture}},MetalnessPBR:{enable:true,factor:0},RoughnessPBR:{enable:true,factor:.65}}});if(material?.id===undefined||material?.id===null)throw new Error('The viewer did not confirm an artwork material.');slot.material=material.id;}
if(!ok())return false;
const key=JSON.stringify([snapshot.hit.position,snapshot.hit.normal,snapshot.size]);if(slot.geometryKey!==key||slot.decal===null){const next=await this.call('createDecal',{position:snapshot.hit.position,normal:snapshot.hit.normal,scale:[snapshot.size,snapshot.size/2,snapshot.size*.045],materialID:slot.material,useBaseNormalMap:true});if(next?.id===undefined||next?.id===null)throw new Error('The viewer did not confirm placement.');const old=slot.decal;slot.decal=next.id;slot.geometryKey=key;if(old!==null){slot.cleanup=old;await this.call('destroyDecal',old,{deleteMaterial:false});slot.cleanup=null;}}
return true;}
async remove(id){const slot=this.slot(id);if(slot.cleanup!==null){await this.call('destroyDecal',slot.cleanup,{deleteMaterial:false});slot.cleanup=null;}if(slot.decal!==null){await this.call('destroyDecal',slot.decal,{deleteMaterial:false});slot.decal=null;}slot.geometryKey='';}
}
root.BrainSNNViewer={finite3,copyCamera,cameraMove,LatestQueue,DecalStore,apiCall};
})(typeof globalThis==='undefined'?this:globalThis);
