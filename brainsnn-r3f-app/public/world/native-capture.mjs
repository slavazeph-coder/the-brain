/** Local preflight for original native-capture files. The worker validates calibration and geometry again. */
export const NATIVE_CAPTURE = Object.freeze({schema:'brainsnn.capture.v1',metadataBytes:1024**2,imageBytes:64*1024**2,minFrames:3,maxFrames:11});
const fail=message=>{throw new Error(message);};
const flat=name=>typeof name==='string'&&name.length>0&&name.length<=160&&!/[\\/:]/.test(name)&&!['.','..'].includes(name);
const finiteMatrix=(value,rows,cols)=>Array.isArray(value)&&value.length===rows&&value.every(row=>Array.isArray(row)&&row.length===cols&&row.every(Number.isFinite));

export function validateCaptureMetadata(bundle){
  if(!bundle||bundle.schema!==NATIVE_CAPTURE.schema)fail('Choose a brainsnn.capture.v1 capture JSON and its original photos.');
  if(bundle.pose_convention!=='arkit-camera-to-world'||bundle.units!=='m'||bundle.pixel_convention!=='integer-centres')fail('This capture needs ARKit camera-to-world poses, metre units and integer-centre pixels.');
  if(!Array.isArray(bundle.frames)||bundle.frames.length<NATIVE_CAPTURE.minFrames||bundle.frames.length>NATIVE_CAPTURE.maxFrames)fail('A calibrated capture needs 3–11 original photos and one JSON file.');
  const names=new Set(),ids=new Set();let last=-Infinity;
  for(const frame of bundle.frames){
    if(!frame||!flat(frame.image)||!(/\.(jpe?g|png)$/i.test(frame.image)))fail('Capture photos must have simple JPEG or PNG filenames, without folders.');
    if(names.has(frame.image))fail(`Capture repeats the photo ${frame.image}.`);names.add(frame.image);
    if(typeof frame.id!=='string'||!frame.id||frame.id.length>100||ids.has(frame.id))fail('Capture frame identifiers must be unique.');ids.add(frame.id);
    if(!/^[a-f0-9]{64}$/.test(frame.image_sha256??''))fail(`${frame.image} has no valid original-file SHA-256.`);
    if(!Number.isFinite(frame.timestamp_seconds)||frame.timestamp_seconds<0||frame.timestamp_seconds<=last)fail('Capture timestamps must increase in the original filming order.');last=frame.timestamp_seconds;
    if(frame.tracking_state!=='normal')fail(`${frame.image} was not normally tracked. Use a capture with normal tracking for every photo.`);
    const size=frame.image_size;
    if(!Array.isArray(size)||size.length!==2||!size.every(value=>Number.isSafeInteger(value)&&value>=256)||size[0]*size[1]>24000000)fail(`${frame.image} needs supported original image dimensions (at least 256 pixels per side, up to 24 megapixels).`);
    if(!finiteMatrix(frame.intrinsics,3,3)||!finiteMatrix(frame.camera_to_world,4,4))fail(`${frame.image} has missing or invalid calibration or pose matrices.`);
    if(frame.intrinsics[0][0]<=0||frame.intrinsics[1][1]<=0||Math.abs(frame.intrinsics[0][1])>1e-8||Math.abs(frame.intrinsics[1][0])>1e-8)fail(`${frame.image} needs positive focal lengths and zero-skew calibration.`);
    if(['distortion','distortion_coefficients','lens_distortion'].some(key=>key in frame||key in bundle))fail('This capture format does not support lens distortion. Use correctly calibrated original rasters.');
  }
  return bundle;
}

export async function readNativeCapture(file){
  if(!file||file.size<1||file.size>NATIVE_CAPTURE.metadataBytes)fail('Capture JSON must be no larger than 1 MiB.');
  let value;try{value=JSON.parse(await file.text());}catch{fail('Capture JSON could not be read. Choose the original capture metadata file.');}
  return validateCaptureMetadata(value);
}

export function nativeCaptureItems(sources,entry){
  const captures=sources.filter(item=>item.kind==='capture');
  if(captures.length!==1)fail('Use exactly one capture JSON with its original photos.');
  if(!entry?.available||!entry.input_kinds?.includes('capture'))fail('Choose a worker engine that supports calibrated capture bundles. Update the worker if none is available.');
  const items=sources.filter(item=>['capture','image','video'].includes(item.kind));
  if(items.some(item=>item.kind==='video'))fail('Remove the walkthrough video before processing a calibrated photo capture.');
  if(items.length>(entry.max_inputs??12)||items.some(item=>!entry.input_kinds?.includes(item.kind)))fail('This worker cannot accept all files in this calibrated capture.');
  return {capture:captures[0],images:items.filter(item=>item.kind==='image')};
}

export async function prepareNativeCapture(sources,entry,{signal,progress=()=>{}}={}){
  signal?.throwIfAborted();
  const {capture,images}=nativeCaptureItems(sources,entry),bundle=await readNativeCapture(capture.file);
  signal?.throwIfAborted();
  const byName=new Map();
  for(const image of images){
    if(byName.has(image.file.name))fail(`Two selected photos have the same name: ${image.file.name}. Remove the duplicate.`);
    if(image.file.size<1||image.file.size>NATIVE_CAPTURE.imageBytes)fail(`${image.file.name}: original capture photos are limited to 64 MiB each.`);
    byName.set(image.file.name,image);
  }
  const missing=bundle.frames.filter(frame=>!byName.has(frame.image));
  if(missing.length)fail(`Add the original capture photo${missing.length===1?'':'s'}: ${missing.map(frame=>frame.image).join(', ')}.`);
  if(images.length!==bundle.frames.length)fail('Remove photos that are not listed in this capture JSON. Each job uses one complete capture.');
  const ordered=[];
  for(const [index,frame] of bundle.frames.entries()){
    signal?.throwIfAborted();progress(index,bundle.frames.length);
    const image=byName.get(frame.image),bytes=await image.file.arrayBuffer();
    signal?.throwIfAborted();
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    signal?.throwIfAborted();
    const hash=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
    if(hash!==frame.image_sha256)fail(`${frame.image} differs from the original capture. Select the unchanged file; edited or converted photos cannot use its calibration.`);
    ordered.push(image);
  }
  progress(bundle.frames.length,bundle.frames.length);
  return [capture,...ordered];
}
