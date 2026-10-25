/** Real WebGL browser regression checks. Authored test assets exercise rendering, not reconstruction. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(new URL('../../brainsnn-r3f-app/package.json', import.meta.url));
const { chromium, webkit, devices } = require('playwright');
const base = (process.env.WORLD_URL || 'http://127.0.0.1:8765/world/index.html').replace(/[^/]*$/, '');
const output = new URL('../../output/playwright/world/', import.meta.url);
await mkdir(output, { recursive: true });

function cloudFixture() {
  const rows = [];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) rows.push(`${(x-16)/16} ${(y-12)/12} ${Math.sin(x*.2)*.2} ${60+x*5} ${70+y*6} 180`);
  return Buffer.from(`ply\nformat ascii 1.0\ncomment authored renderer test fixture\nelement vertex ${rows.length}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n${rows.join('\n')}\n`);
}
function glbFixture(external = false) {
  const binary = Buffer.alloc(44);
  [-1,-1,0,1,-1,0,0,1,0].forEach((v,i)=>binary.writeFloatLE(v,i*4));
  [0,1,2].forEach((v,i)=>binary.writeUInt16LE(v,36+i*2));
  const document = { asset: { version: '2.0', generator: 'authored renderer test fixture' }, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, material: 0}]}],
    materials: [{doubleSided: true, pbrMetallicRoughness: {baseColorFactor: [.1,.9,.95,1], metallicFactor: 0, roughnessFactor: 1}}],
    buffers: [{byteLength: binary.length, ...(external ? {uri: 'https://invalid.example/private-scan.bin'} : {})}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: 36}, {buffer: 0, byteOffset: 36, byteLength: 6}],
    accessors: [{bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1,-1,0], max: [1,1,0]}, {bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR'}] };
  let json = JSON.stringify(document); json += ' '.repeat((4-Buffer.byteLength(json)%4)%4);
  const meta = Buffer.from(json), header = Buffer.alloc(20), chunk = Buffer.alloc(8);
  [0x46546c67,2,28+meta.length+binary.length,meta.length,0x4e4f534a].forEach((v,i)=>header.writeUInt32LE(v,i*4));
  chunk.writeUInt32LE(binary.length); chunk.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header, meta, chunk, binary]);
}
async function countPixels(canvas) {
  return canvas.evaluate(el=>{
    const gl=el.getContext('webgl2'), pixels=new Uint8Array(el.width*el.height*4);
    gl.readPixels(0,0,el.width,el.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>35||pixels[i+1]>35||pixels[i+2]>35)count++;
    return {count,error:gl.getError()};
  });
}
async function drawSettled(page) { await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); }
async function check(browser, mobile) {
  const context=await browser.newContext(mobile ? {...devices['iPhone 15'],deviceScaleFactor:1} : {viewport:{width:1280,height:1000},deviceScaleFactor:1});
  const page=await context.newPage(), errors=[], requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(base+'splat.html');
  const input=page.locator('#asset'), status=page.locator('#viewer-status'), cloud=page.locator('#asset-canvas');
  await input.setInputFiles({name:'authored-test-cloud.ply',mimeType:'application/octet-stream',buffer:cloudFixture()});
  await page.waitForFunction(()=>document.querySelector('#viewer-status').textContent.includes('768 visible points'));
  assert.match(await status.textContent(),/Point cloud · not a trained Gaussian/);
  assert.match(await status.textContent(),/Scale unverified; no collision geometry/);
  await cloud.scrollIntoViewIfNeeded();await drawSettled(page);
  const drawn=await countPixels(cloud);assert.ok(drawn.count>500,JSON.stringify(drawn));assert.equal(drawn.error,0);
  const before=await cloud.evaluate(el=>el.toDataURL());
  await cloud.focus();await cloud.press('w');await drawSettled(page);
  assert.notEqual(await cloud.evaluate(el=>el.toDataURL()),before,'keyboard must move actual rendered geometry');
  const image=await cloud.evaluate(el=>el.toDataURL('image/png'));
  const label=browser.browserType().name()+(mobile?'-mobile':'-desktop');
  await writeFile(new URL(label+'-point-viewer.png',output),Buffer.from(image.split(',')[1],'base64'));
  await page.locator('#remove').click();await cloud.scrollIntoViewIfNeeded();await drawSettled(page);assert.equal((await countPixels(cloud)).count,0);
  await input.setInputFiles({name:'invalid.ply',mimeType:'application/octet-stream',buffer:Buffer.from('ply\nformat ascii 1.0\nelement vertex 10000001\nproperty float x\nend_header\n')});
  await page.waitForFunction(()=>document.querySelector('#viewer-status').textContent.includes('Asset could not be opened'));
  assert.ok(await page.locator('#frame').isDisabled());
  await input.setInputFiles({name:'authored-test-triangle.glb',mimeType:'model/gltf-binary',buffer:glbFixture()});
  await page.waitForFunction(()=>document.querySelector('#viewer-status').textContent.includes('GLB visual mesh · 3 vertices'));
  const mesh=page.locator('#mesh-stage canvas');await mesh.scrollIntoViewIfNeeded();await drawSettled(page);
  const meshPixels=await countPixels(mesh);assert.ok(meshPixels.count>500,JSON.stringify(meshPixels));assert.equal(meshPixels.error,0);
  assert.ok(await page.locator('#point-size').isDisabled());
  const meshImage=await mesh.evaluate(el=>el.toDataURL('image/png'));
  await writeFile(new URL(label+'-mesh-viewer.png',output),Buffer.from(meshImage.split(',')[1],'base64'));
  await page.locator('#remove').click();await mesh.scrollIntoViewIfNeeded();await drawSettled(page);
  assert.equal((await countPixels(mesh)).count,0,'clearing GLB must leave no authored robot or floor');
  await input.setInputFiles({name:'external-resources.glb',mimeType:'model/gltf-binary',buffer:glbFixture(true)});
  await page.waitForFunction(()=>document.querySelector('#viewer-status').textContent.includes('External files are blocked'));
  assert.ok(await page.locator('#frame').isDisabled());
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(r=>r.method==='GET'&&new URL(r.url).origin===new URL(base).origin),JSON.stringify(requests));
  console.log(`${label}: PLY pixels ${drawn.count}, GLB pixels ${meshPixels.count}, keyboard, clear, malformed assets and external-resource rejection passed`);
  await context.close();
}
for (const name of (process.env.WORLD_BROWSERS || 'chromium,webkit').split(',')) {
  const type={chromium,webkit}[name];assert.ok(type,`Unknown browser ${name}`);
  const executablePath=process.env[name==='webkit'?'PLAYWRIGHT_WEBKIT_PATH':'PLAYWRIGHT_CHROMIUM_PATH'];
  const browser=await type.launch({headless:true,...(executablePath?{executablePath}:{})});
  try {await check(browser,false);await check(browser,true);} finally {await browser.close();}
}
