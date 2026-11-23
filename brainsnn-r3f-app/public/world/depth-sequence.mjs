/** Bounded optical-axis depth review. A depth frame is never a registered world or collision map. */
import {STRIDE} from './visual-geometry.mjs';

export const DEPTH_SEQUENCE_SCHEMA='brainsnn.depth-sequence.v1';
export const MAX_DEPTH_SEQUENCE_BYTES=16*1024*1024;
export const MAX_DEPTH_FRAMES=32;
export const MAX_DEPTH_EDGE=160;
const SHA=/^[a-f0-9]{64}$/;
const ENGINE=new Set(['metric-depth-sequence','depth-pro-2','authored-depth-example']);
const text=(value,max=240)=>typeof value==='string'?value.slice(0,max):'';
const positive=value=>Number.isFinite(value)&&value>0;
const assert=(condition,message)=>{if(!condition)throw Error(message);};

export function validateDepthSequence(value){
  assert(value?.schema===DEPTH_SEQUENCE_SCHEMA&&ENGINE.has(value.engine),'Choose a BrainSNN depth-sequence JSON file.');
  assert(value.units==='m'&&value.coordinateFrame==='camera-x-right-y-down-z-forward'&&value.depthConvention==='camera-z','Depth must be in optical-axis metres, with the camera looking along positive Z.');
  assert(value.scale?.verified===false&&value.registration?.available===false,'This preview accepts estimated, unregistered depth only. Use the measured reconstruction workflow for registered geometry.');
  assert(value.scale?.basis==='model-estimated'||value.engine==='authored-depth-example'&&value.scale?.basis==='authored-fixture','Depth needs its estimate or authored-example basis.');
  const example=value.engine==='authored-depth-example';
  assert(['image','video'].includes(value.source?.kind)&&typeof value.source?.name==='string'&&value.source.name.length<=240,'Depth needs its original photo or video identity.');
  assert(example?value.source.sha256===null:SHA.test(value.source.sha256),'Depth needs a SHA-256 for its original source.');
  assert(typeof value.provenance?.inferenceExecuted==='boolean'&&(!example||value.provenance.inferenceExecuted===false),'Depth needs explicit inference provenance.');
  assert(['independent-frames','joint-video','authored-fixture'].includes(value.temporal?.mode),'The sequence must say how its frames were processed.');
  assert(example=== (value.temporal.mode==='authored-fixture'),'An authored example cannot claim video inference.');
  assert(value.model&&typeof value.model.repo==='string'&&typeof value.model.license==='string','Depth needs model and licence provenance.');
  assert(Array.isArray(value.frames)&&value.frames.length>0&&value.frames.length<=MAX_DEPTH_FRAMES,'Use a depth review with 1–32 frames.');
  if(value.source.kind==='image')assert(value.frames.length===1,'A photo result must contain exactly one frame.');
  let lastTime=-Infinity,lastIndex=-1;
  const frames=value.frames.map(frame=>{
    assert(Number.isInteger(frame.index)&&frame.index>lastIndex&&frame.index<=1e7,'Depth frame indices must be unique and increasing.');lastIndex=frame.index;
    const {width,height}=frame;
    assert(Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=MAX_DEPTH_EDGE&&height<=MAX_DEPTH_EDGE,'Depth review rasters are limited to 160 × 160 pixels.');
    assert(Array.isArray(frame.depth)&&frame.depth.length===width*height,'Every depth raster must contain one value per pixel.');
    assert(frame.depth.every(z=>z===null||positive(z)&&z<=1000),'Depth values must be positive finite metres up to 1,000, or null for missing geometry.');
    const camera=frame.camera;
    assert(camera&&positive(camera.fx)&&positive(camera.fy)&&camera.fx>=.01&&camera.fy>=.01&&camera.fx<=1e6&&camera.fy<=1e6&&Number.isFinite(camera.cx)&&Number.isFinite(camera.cy)&&Math.abs(camera.cx)<=width*2&&Math.abs(camera.cy)<=height*2,'Each depth grid needs its own finite camera intrinsics.');
    assert(['source-pts','not-available','still-image',...(example?['authored-time']:[])].includes(frame.timestampBasis),'Frame timing must state whether original video timestamps are available.');
    if(frame.timestampBasis==='not-available')assert(frame.timeSeconds===null,'Unavailable source timestamps must remain empty.');
    else if(frame.timestampBasis==='still-image')assert(value.source.kind==='image'&&frame.timeSeconds===null,'A still photo has no video timestamp.');
    else {
      assert(Number.isFinite(frame.timeSeconds)&&Math.abs(frame.timeSeconds)<=86400&&frame.timeSeconds>lastTime,'Source timestamps must be finite and increasing.');lastTime=frame.timeSeconds;
      assert(example?frame.timestampBasis==='authored-time':value.source.kind==='video'&&frame.timestampBasis==='source-pts','Frame timing must match its source kind.');
    }
    const image=frame.imageDataUrl??null;
    assert(image===null||typeof image==='string'&&image.length<=400000&&/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(image),'Frame previews must be small embedded PNG or JPEG images.');
    for(const key of ['inputWidth','inputHeight'])assert(Number.isInteger(frame[key])&&frame[key]>0&&frame[key]<=24000000,'Depth needs its model input dimensions.');
    assert(frame.inputWidth*frame.inputHeight<=24000000,'Model input exceeds the 24-megapixel provenance limit.');
    return {index:frame.index,timeSeconds:frame.timeSeconds,timestampBasis:frame.timestampBasis,width,height,
      depth:frame.depth.slice(),camera:{fx:camera.fx,fy:camera.fy,cx:camera.cx,cy:camera.cy},imageDataUrl:image,
      inputWidth:frame.inputWidth,inputHeight:frame.inputHeight};
  });
  return {schema:DEPTH_SEQUENCE_SCHEMA,engine:value.engine,source:{kind:value.source.kind,name:text(value.source.name),sha256:value.source.sha256},
    model:{repo:text(value.model.repo),revision:text(value.model.revision,100),license:text(value.model.license),variant:text(value.model.variant,80)},
    units:'m',coordinateFrame:'camera-x-right-y-down-z-forward',depthConvention:'camera-z',
    scale:{basis:value.scale.basis,verified:false},registration:{available:false},
    temporal:{mode:value.temporal.mode,...Object.fromEntries(['window','overlap'].filter(k=>Number.isInteger(value.temporal[k])&&value.temporal[k]>=0&&value.temporal[k]<=32).map(k=>[k,value.temporal[k]]))},
    provenance:{inferenceExecuted:value.provenance.inferenceExecuted,producerAttested:false},frames};
}

export function parseDepthSequence(bytes){
  const input=bytes instanceof ArrayBuffer?new Uint8Array(bytes):bytes;
  assert(input instanceof Uint8Array&&input.byteLength>0&&input.byteLength<=MAX_DEPTH_SEQUENCE_BYTES,'Choose a depth-sequence JSON file up to 16 MiB.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(input));}catch{throw Error('The depth-sequence file is not valid UTF-8 JSON.');}
  return validateDepthSequence(value);
}

export function verifyDepthSource(sequence,expected){
  assert(expected&&SHA.test(expected.sha256)&&['image','video'].includes(expected.kind),'A source comparison needs the selected file’s hash and kind.');
  assert(sequence.source.sha256===expected.sha256&&sequence.source.kind===expected.kind,'The depth result does not match the source file submitted for this job.');
  return true;
}

export function depthRange(sequence){
  const depths=sequence.frames.flatMap(frame=>frame.depth.filter(z=>z!==null)).sort((a,b)=>a-b);
  if(!depths.length)return {near:0,far:1,valid:0,total:sequence.frames.reduce((n,f)=>n+f.depth.length,0)};
  return {near:depths[Math.floor((depths.length-1)*.02)],far:depths[Math.floor((depths.length-1)*.98)],valid:depths.length,total:sequence.frames.reduce((n,f)=>n+f.depth.length,0)};
}

export function depthColour(z,range){
  if(z===null)return [12,19,30,255];
  const t=range.far>range.near?Math.max(0,Math.min(1,(z-range.near)/(range.far-range.near))):.5;
  const stops=[[255,199,113],[88,221,218],[143,130,248]],part=t<.5?0:1,alpha=t*2-part;
  return [...stops[part].map((v,i)=>Math.round(v+(stops[part+1][i]-v)*alpha)),255];
}

export function probeDepth(frame,x,y){
  assert(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<frame.width&&y<frame.height,'Pick a pixel inside this depth frame.');
  const z=frame.depth[y*frame.width+x];if(z===null)return null;
  const {fx,fy,cx,cy}=frame.camera,position=[(x-cx)*z/fx,(y-cy)*z/fy,z];
  return {x,y,depthMetres:z,position,rayDistanceMetres:Math.hypot(...position)};
}

export function depthFramePoints(frame,range){
  const points=[];
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
    const sample=probeDepth(frame,x,y);if(!sample)continue;
    const [px,py,pz]=sample.position,colour=depthColour(pz,range),size=Math.max(.0005,pz/Math.max(frame.camera.fx,frame.camera.fy)*.55);
    points.push(px,-py,-pz,size,size,size,...colour.map(c=>c/255),0,0,0,1);
  }
  return new Float32Array(points);
}

export function exportDepthFramePLY(frame,range,{sourceSha256=null}={}){
  const points=depthFramePoints(frame,range),lines=['ply','format ascii 1.0','comment Estimated optical-axis depth; not measured or registered',
    'comment coordinates right-handed-y-up camera looking down -z',`comment source_sha256 ${SHA.test(sourceSha256)?sourceSha256:'authored-example'}`,
    `comment review_frame_index ${frame.index}`,`comment source_timestamp_seconds ${frame.timeSeconds??'unavailable'}`,
    'comment colours encode estimated depth',`element vertex ${points.length/STRIDE}`,'property float x','property float y','property float z','property uchar red','property uchar green','property uchar blue','end_header'];
  for(let i=0;i<points.length;i+=STRIDE)lines.push(`${points[i]} ${points[i+1]} ${points[i+2]} ${Math.round(points[i+6]*255)} ${Math.round(points[i+7]*255)} ${Math.round(points[i+8]*255)}`);
  return lines.join('\n')+'\n';
}

export function samePixelChange(before,after){
  if(!before||before.width!==after.width||before.height!==after.height)return null;
  const changes=[];for(let i=0;i<before.depth.length;i++)if(before.depth[i]!==null&&after.depth[i]!==null)changes.push(Math.abs(after.depth[i]-before.depth[i]));
  if(!changes.length)return null;changes.sort((a,b)=>a-b);
  return {pairs:changes.length,medianAbsoluteMetres:changes[Math.floor((changes.length-1)/2)],
    meanAbsoluteMetres:changes.reduce((n,v)=>n+v,0)/changes.length,motionCompensated:false,accuracyVerified:false};
}

export function depthReviewSummary(sequence,{artifactSha256=null,selectedFrame=0,sourceMatched=false}={}){
  const range=depthRange(sequence);
  return {schema:'brainsnn.depth-review.v1',source:sequence.source,engine:sequence.engine,model:sequence.model,
    artifactSha256:SHA.test(artifactSha256)?artifactSha256:null,frames:sequence.frames.length,selectedFrame,
    sourceIdentity:sequence.engine==='authored-depth-example'?'authored-example':sourceMatched?'checked-against-selected-file':'producer-declared',
    temporal:sequence.temporal,scale:sequence.scale,registration:sequence.registration,
    validSamples:range.valid,totalSamples:range.total,displayRangeMetres:{near:range.near,far:range.far},
    inferenceDeclared:sequence.provenance.inferenceExecuted,producerAttested:false,measured:false,collisionReady:false,
    interpretation:'Optical-axis depth estimates in each camera frame. No camera trajectory, fused world or verified dimensions.'};
}

export function authoredDepthSequence(){
  const width=64,height=48;
  return validateDepthSequence({schema:DEPTH_SEQUENCE_SCHEMA,engine:'authored-depth-example',source:{kind:'video',name:'Authored moving panel',sha256:null},
    model:{repo:'authored geometry',revision:'1',license:'BrainSNN authored example'},units:'m',coordinateFrame:'camera-x-right-y-down-z-forward',depthConvention:'camera-z',
    scale:{basis:'authored-fixture',verified:false},registration:{available:false},temporal:{mode:'authored-fixture'},provenance:{inferenceExecuted:false},
    frames:Array.from({length:5},(_,index)=>({index,timeSeconds:index*.5,timestampBasis:'authored-time',width,height,inputWidth:width,inputHeight:height,imageDataUrl:null,
      camera:{fx:60,fy:60,cx:31.5,cy:23.5},depth:Array.from({length:width*height},(_,i)=>{
        const x=i%width,y=Math.floor(i/width);if(y<5||x<3||x>60)return null;
        return x>=14+index*3&&x<31+index*3&&y>=13&&y<36?2+.15*index:5;
      })}))});
}
