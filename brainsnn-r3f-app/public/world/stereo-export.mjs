import {createGaussianPreview} from './open4dgs-player.mjs';
import {readStereoGaussians, readRenderCameras, toViewerPoints} from './stereo-export-data.mjs';
import {STRIDE} from './visual-geometry.mjs';

function drawCamera(canvas, points, cameras, index) {
  const m = cameras.views[index], k = cameras.intrinsics;
  const scale = Math.min(1,1000/cameras.width,650/cameras.height);
  canvas.width = Math.max(1, Math.round(cameras.width*scale));
  canvas.height = Math.max(1, Math.round(cameras.height*scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#080b12';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  const samples = [];
  for (let i=0; i<points.length; i+=STRIDE) {
    const x=points[i], y=points[i+1], z=points[i+2];
    const coord = r => m[r][0]*x + m[r][1]*y + m[r][2]*z + m[r][3];
    const depth = coord(2);
    if (depth <= 0) continue;
    const sx = coord(0)/depth, sy = coord(1)/depth;
    const u = (k[0][0]*sx + k[0][1]*sy + k[0][2])*scale, v = (k[1][1]*sy + k[1][2])*scale;
    if (u >= 0 && u < canvas.width && v >= 0 && v < canvas.height) samples.push([depth,u,v,i]);
  }
  samples.sort((a,b) => b[0]-a[0]);
  for (const [,u,v,i] of samples) {
    ctx.fillStyle = 'rgba(' + [6,7,8].map(j=>Math.round(255*points[i+j])).join(',') + ',' + points[i+9] + ')';
    ctx.fillRect(Math.floor(u), Math.floor(v), 2, 2);
  }
}

async function checkPng(file) {
  if (file.size < 33 || file.size > 32*1024**2) throw Error('Choose an exported PNG up to 32 MiB.');
  const head = new DataView(await file.slice(0,33).arrayBuffer());
  const w = head.getUint32(16), h = head.getUint32(20);
  if (head.getUint32(0)!==0x89504e47 || head.getUint32(4)!==0x0d0a1a0a || head.getUint32(12)!==0x49484452 ||
      !w || !h || w*h > 20_000_000) throw Error('This file needs to be a PNG up to 20 megapixels.');
}

export function mountStereoExport(root) {
  root.innerHTML = `<details><summary>Open a StereoSplat export</summary>
  <p>Choose the Gaussian PLY. You can also add its cameras.json and exported colour or depth pictures. These files stay on your device.</p>
  <label>Export files <input type="file" multiple accept=".ply,.json,.png" data-stx-files></label>
  <div class="layer-toolbar"><button type="button" data-stx-open disabled>Open export</button><button type="button" data-stx-clear hidden>Clear export</button></div>
  <p role="status" class="layer-note" data-stx-status></p>
  <div data-stx-result hidden>
    <label>View <select data-stx-view></select></label>
    <div data-stx-orbit class="layer-stage"><canvas tabindex="0" aria-label="Gaussian scene. Drag or press an arrow key to look around." data-stx-gl></canvas>
      <canvas hidden tabindex="0" aria-label="Projected scene points. Press an arrow key to look around." data-stx-fallback></canvas></div>
    <div class="layer-toolbar" data-stx-turn><button type="button" data-stx-left>Turn left</button><button type="button" data-stx-right>Turn right</button><button type="button" data-stx-reset>Reset view</button></div>
    <canvas hidden data-stx-projection style="max-width:100%;height:auto" aria-label="Gaussian centers projected through the selected render camera"></canvas>
    <img hidden data-stx-image style="max-width:100%;height:auto" alt="Selected export image">
    <p class="layer-note" data-stx-description></p>
  </div></details>`;
  const get = name => root.querySelector('[data-stx-'+name+']');
  const picker=get('files'), open=get('open'), clearButton=get('clear'), result=get('result'), view=get('view');
  let parsed=null, cameras=null, media=[], preview=null, reader=null, imageUrl='', revision=0;
  function revokeImage() {
    get('image').removeAttribute('src');
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl='';
  }
  function reset(resetPicker=true) {
    ++revision;
    reader?.abort();
    reader=null;
    preview?.dispose();
    preview=parsed=cameras=null;
    media=[];
    revokeImage();
    view.replaceChildren();
    result.hidden=true;
    clearButton.hidden=true;
    get('status').textContent='';
    get('description').textContent='';
    if (resetPicker) picker.value='';
    open.disabled=!picker.files.length;
  }
  async function display() {
    const token=++revision;
    revokeImage();
    const [kind, rawIndex]=view.value.split('-'), index=Number(rawIndex);
    get('orbit').hidden=get('turn').hidden=kind!=='orbit';
    get('projection').hidden=kind!=='camera';
    get('image').hidden=kind!=='image';
    if (kind==='orbit') {
      if (!preview) {
        preview=createGaussianPreview(get('gl'), get('fallback'), msg => {get('description').textContent=msg;});
        preview.set(toViewerPoints(parsed.points),false);
      }
      get('description').textContent = (preview.mode==='projected-points' ? 'Projected points' : 'Gaussian appearance') +
        ' · '+parsed.displayed.toLocaleString()+' of '+parsed.total.toLocaleString()+' centers shown. Colours use the base colour in the file.';
    } else if (kind==='camera') {
      drawCamera(get('projection'),parsed.points,cameras,index);
      get('description').textContent='View '+(index+1)+' · virtual camera center in metres (X, Y, Z): '+
        cameras.centers[index].map(v=>v.toFixed(3)).join(', ')+'. Dots show the exported centers in this view.';
    } else if (kind==='image') {
      const file=media[index];
      get('description').textContent='';
      try {
        await checkPng(file);
        if (token!==revision) return;
        imageUrl=URL.createObjectURL(file);
        get('image').src=imageUrl;
        await get('image').decode();
        if (token!==revision) return;
        get('description').textContent=file.name.includes('depth') ?
          'Depth colours show relative distance. The picture does not store a distance for each pixel in metres.' :
          'Colour image rendered by the exporting application.';
      } catch (err) {
        if (token===revision) {revokeImage(); get('description').textContent=err.message||'This image could not be opened.';}
      }
    }
  }
  picker.addEventListener('change',()=>{reset(false);});
  clearButton.addEventListener('click',()=>{reset();picker.focus();});
  get('left').onclick=()=>preview?.turn(-.22,0);
  get('right').onclick=()=>preview?.turn(.22,0);
  get('reset').onclick=()=>preview?.reset();
  view.onchange=()=>{void display().catch(err=>{get('status').textContent=err.message;});};
  open.addEventListener('click',async()=>{
    reset(false);
    clearButton.hidden=false;
    open.disabled=true;
    reader=new AbortController();
    const {signal}=reader, files=Array.from(picker.files);
    try {
      if (files.length>4096) throw Error('Select a smaller set of exported views.');
      const plys=files.filter(f=>/\.ply$/i.test(f.name));
      if (plys.length!==1) throw Error('Choose one Gaussian PLY from your export.');
      if (new Set(files.map(f=>f.name)).size!==files.length) throw Error('Use files from one export folder.');
      const metadata=files.find(f=>f.name==='cameras.json');
      let rig=null;
      if (metadata) {
        if (metadata.size>4*1024**2) throw Error('Choose a cameras.json file up to 4 MiB.');
        rig=readRenderCameras(JSON.parse(await metadata.text()));
      }
      signal.throwIfAborted();
      get('status').textContent='Opening the scene locally…';
      const cloud=await readStereoGaussians(plys[0],signal);
      if (signal.aborted) return;
      parsed=cloud;
      cameras=rig;
      media=files.filter(f=>/^(?:input_depth_\d+_.+|render_(?:depth|rgb)_\d+)\.png$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name));
      view.add(new Option('Look around','orbit'));
      rig?.views.forEach((_,i)=>view.add(new Option('Render camera '+(i+1),'camera-'+i)));
      media.forEach((f,i)=>view.add(new Option(f.name,'image-'+i)));
      result.hidden=false;
      await display();
      if (!signal.aborted) get('status').textContent=plys[0].name+' opened · '+(rig?.views.length||0)+' render camera views.';
    } catch (err) {
      if (!signal.aborted) { reset(false); clearButton.hidden=false; get('status').textContent=err.message||'This export could not be opened.'; }
    } finally {
      if (!signal.aborted) open.disabled=!picker.files.length;
    }
  });
  return {clear:reset,dispose:reset};
}
