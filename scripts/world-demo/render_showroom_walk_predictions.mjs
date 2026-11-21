/** Use the playground's actual browser RGB-D renderer on disjoint requested poses. */
import {createHash} from 'node:crypto';
import {readFile, writeFile, mkdir, mkdtemp, rename, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const app = fileURLToPath(new URL('../../brainsnn-r3f-app/', import.meta.url));
const requireApp = createRequire(resolve(app,'package.json'));
const {build} = requireApp('esbuild');
const {chromium} = requireApp('playwright');
const required = ['room','requests','alignment','out'];
const {values} = parseArgs({options:{...Object.fromEntries(required.map(k => [k,{type:'string'}])), 'fill-gaps':{type:'boolean',default:false}}});
if (required.some(key => !values[key])) {
  throw Error('Use --room <embedded calibrated room.json> --requests <requests.json> --alignment <arena-cloud.json> --out <new directory>.');
}
const digest = data => createHash('sha256').update(data).digest('hex');
const requestBytes = await readFile(values.requests);
const request = JSON.parse(requestBytes);
const room = JSON.parse(await readFile(values.room));
const {fromSource, floorEstimate} = JSON.parse(await readFile(values.alignment));
if (!room.frames.every(f => f.image.startsWith('data:image/'))) throw Error('Use a room with embedded source images.');
const ids = new Set(room.frames.map(f => f.id));
if (!request.targets.length || request.targets.some(t => ids.has(t.id)) ||
    request.inputs.length !== ids.size || request.inputs.some(f => !ids.has(f.id))) {
  throw Error('The room must contain the input frames only and every target must be withheld.');
}
const {outputFiles} = await build({
  stdin:{contents:`
    import {parseShowroomBundle} from './showroom-model.mjs';
    import {prepareWalkAppearance,renderWalkAppearance,walkRasterSize} from './showroom-walk-appearance.mjs';
    let room;
    globalThis.load = bundle => {room = parseShowroomBundle(bundle);};
    globalThis.render = async ({before,after,pose,t,fillGaps}) => {
      const pair = await prepareWalkAppearance(room,before,after);
      if (!pair) throw Error('The requested anchors have no calibrated depth.');
      const {width:w, height:h} = walkRasterSize(pair.sources, pose);
      const {pixels,valid} = renderWalkAppearance(pair.sources,pose,t,w,h,fillGaps);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      const png = rgba => {
        ctx.putImageData(new ImageData(rgba,w,h),0,0);
        return canvas.toDataURL('image/png').split(',')[1];
      };
      const image = png(pixels);
      for(let i=0;i<valid.length;i++) {
        pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=valid[i] ? 255 : 0;
      }
      return {image,mask:png(pixels)};
    };`,resolveDir:resolve(app,'public/world')},
  bundle:true, format:'iife', write:false, logLevel:'silent',
});
const browser = await chromium.launch({headless:true,
  ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
let working;
try {
  const out = resolve(values.out);
  await mkdir(dirname(out),{recursive:true});
  working = await mkdtemp(join(dirname(out),'.walk-predictions-'));
  const context = await browser.newContext({offline:true});
  const page = await context.newPage();
  await page.addScriptTag({content:outputFiles[0].text});
  await page.evaluate(bundle => globalThis.load(bundle),room);
  const results = [];
  for (const [index,target] of request.targets.entries()) {
    const dot3 = (r,p) => r[0]*p[0]+r[1]*p[1]+r[2]*p[2];
    const scale = Math.hypot(...fromSource.map(row => row[0]));
    const axes = target.worldToCamera.map(r => fromSource.map(row => dot3(row,r)/scale));
    const eye = fromSource.map(row => dot3(row,target.center) + row[3]);
    eye[1] -= floorEstimate.y;
    const [f,cx,cy] = target.intrinsics;
    const pose = {eye,right:axes[0],down:axes[1],forward:axes[2],width:target.width,height:target.height,intrinsics:[f,f,cx,cy]};
    const [before,after] = target.bracketingInputs.map(id => room.frames.findIndex(frame => frame.id===id));
    const raster = await page.evaluate(opts => globalThis.render(opts),{before,after,pose,t:target.fraction,fillGaps:values['fill-gaps']});
    const row = {id:target.id};
    for (const key of ['image','mask']) {
      const bytes = Buffer.from(raster[key],'base64');
      row[key] = `target-${index+1}-${key}.png`;
      await writeFile(join(working,row[key]),bytes);
      row[key==='image'?'sha256':'maskSha256'] = digest(bytes);
    }
    results.push(row);
  }
  await writeFile(join(working,'predictions.json'),JSON.stringify({schema:'brainsnn.walk-predictions.v1',
    requestSha256:digest(requestBytes),method:values['fill-gaps'] ? 'BrainSNN two-view RGB-D with endpoint gap fill' : 'BrainSNN two-view RGB-D reprojection',targets:results},null,2));
  await rename(working,out);
  working = null;
  console.log('Rendered',results.length,'withheld views at',out);
} finally {
  await browser.close();
  if (working) await rm(working,{recursive:true,force:true});
}
