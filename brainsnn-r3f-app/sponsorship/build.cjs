'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {build}=require('esbuild');
const {publicCatalog}=require('./catalog.cjs');
const REV='ccfc6fd8430a17ba3dacef9a1e2faf64ff3b0aee';
const ROOT=`https://raw.githubusercontent.com/unitreerobotics/unitree_ros/${REV}`;
const MODEL=ROOT+'/robots/g1_description/';
const OUT=path.join(__dirname,'public/models');
const attr=(xml,key,defaultValue='')=>xml?.match(new RegExp('(?:^|\\s)'+key+'="([^"]*)"'))?.[1]||defaultValue;
const vector=(s,defaultValue='0 0 0')=>(s||defaultValue).trim().split(/\s+/).map(Number);
function origin(xml) { const o=xml?.match(/<origin\s+([^>]+)\/?\s*>/)?.[1]||'';return {xyz:vector(attr(o,'xyz')),rpy:vector(attr(o,'rpy'))}; }
function parseUrdf(raw) {
  const xml=raw.replace(/<!--[\s\S]*?-->/g,'');
  const links=[];
  for(const match of xml.matchAll(/<link\s+([^>]+)>([\s\S]*?)<\/link>/g)) {
    const visual=match[2].match(/<visual(?:\s[^>]*)?>([\s\S]*?)<\/visual>/)?.[1];
    const mesh=visual?.match(/<mesh\s+([^>]+)\/?\s*>/)?.[1];
    if(!mesh)continue;
    const filename=attr(mesh,'filename');
    if(!/^meshes\/[\w.-]+\.stl$/i.test(filename))throw new Error('Unexpected model asset path: '+filename);
    const material=visual.match(/<material\s+([^>]+)\/?\s*>/)?.[1]||'';
    links.push({name:attr(match[1],'name'),filename,material:attr(material,'name','white'),...origin(visual),scale:vector(attr(mesh,'scale'),'1 1 1')});
  }
  const joints=[];
  for(const match of xml.matchAll(/<joint\s+([^>]+)>([\s\S]*?)<\/joint>/g)) {
    const part=match[2]; const parent=attr(part.match(/<parent\s+([^>]+)\/?\s*>/)?.[1],'link');const child=attr(part.match(/<child\s+([^>]+)\/?\s*>/)?.[1],'link');
    if(parent&&child)joints.push({name:attr(match[1],'name'),type:attr(match[1],'type'),parent,child,...origin(part),axis:vector(attr(part.match(/<axis\s+([^>]+)\/?\s*>/)?.[1],'xyz'),'0 0 1')});
  }
  if(links.length<20||joints.length<20)throw new Error('Unexpected G1 model structure.');
  return {links,joints};
}
function compactSTL(buffer) {
  const view=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength);
  const count=buffer.byteLength>=84?view.getUint32(80,true):0;
  if(!count||84+count*50!==buffer.byteLength)throw new Error('Expected a binary STL from the pinned model.');
  const points=[],indices=[],map=new Map();const cell=.0012;
  for(let t=0;t<count;t++) {
    const face=[];
    for(let v=0;v<3;v++) {
      const offset=84+t*50+12+v*12;
      const xyz=[0,4,8].map(n=>view.getFloat32(offset+n,true));
      if(xyz.some(v=>!Number.isFinite(v)||Math.abs(v)>10))throw new Error('Invalid geometry units.');
      const key=xyz.map(v=>Math.round(v/cell)).join(',');
      let id=map.get(key);if(id===undefined){id=points.length/3;map.set(key,id);points.push(...xyz.map(v=>Number(v.toFixed(5))));}face.push(id);
    }
    if(new Set(face).size===3)indices.push(...face);
  }
  if(!indices.length)throw new Error('Empty geometry after display optimization.');
  return {positions:points,indices};
}
async function get(url) {
  let last;
  for(let n=0;n<3;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('HTTP '+r.status);return Buffer.from(await r.arrayBuffer());}catch(e){last=e;await new Promise(r=>setTimeout(r,500*(n+1)));}}
  throw new Error('Unable to build verified robot assets: '+url+' ('+last.message+')');
}
async function main() {
  await fs.mkdir(OUT,{recursive:true});
  const styles=await Promise.all(['style.source.css','readability.css'].map(file=>fs.readFile(path.join(__dirname,file),'utf8')));
  await fs.writeFile(path.join(__dirname,'public/style.css'),styles.join('\n'));
  const urdf=await get(MODEL+'g1_23dof_mode_10.urdf');
  const model=parseUrdf(urdf.toString('utf8'));
  const unique=[...new Set(model.links.map(l=>l.filename))];
  let index=0; const checksums={};
  await Promise.all(Array.from({length:4},async()=>{
    while(index<unique.length){const file=unique[index++];const raw=await get(MODEL+file);const optimized=JSON.stringify(compactSTL(raw));const name=path.basename(file).replace(/\.stl$/i,'.json');await fs.writeFile(path.join(OUT,name),optimized);checksums[name]=crypto.createHash('sha256').update(optimized).digest('hex');}
  }));
  model.links=model.links.map(l=>({...l,file:path.basename(l.filename).replace(/\.stl$/i,'.json')}));
  const license=await get(ROOT+'/LICENSE');
  await fs.writeFile(path.join(OUT,'LICENSE.txt'),license);
  await fs.writeFile(path.join(OUT,'manifest.json'),JSON.stringify({...model,revision:REV,source:'https://github.com/unitreerobotics/unitree_ros/tree/'+REV+'/robots/g1_description',optimization:'Display-only 1.2 mm vertex clustering. Not a manufacturing model.',checksums}));
  await fs.writeFile(path.join(__dirname,'public/catalog.json'),JSON.stringify(publicCatalog()));
  await build({entryPoints:[path.join(__dirname,'viewer.mjs')],bundle:true,format:'esm',platform:'browser',target:['es2022'],minify:true,outfile:path.join(__dirname,'public/viewer.js'),legalComments:'eof'});
  console.log('Built sponsor studio with '+model.links.length+' genuine G1 mesh links; revision '+REV+'.');
}
module.exports={parseUrdf,compactSTL};
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
