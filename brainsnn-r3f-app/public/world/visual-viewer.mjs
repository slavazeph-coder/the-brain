import { STRIDE, bounds } from './visual-geometry.mjs';
// First-party appearance viewer. Gaussian files use DC colour only (no higher-order SH).
// Plain point clouds retain their identity: display footprints are not trained Gaussians.
const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec3 pos;
layout(location=1) in vec3 scale;
layout(location=2) in vec4 color;
layout(location=3) in vec4 quat;
uniform mat4 view; uniform mat4 projection; uniform vec2 viewport; uniform float focal; uniform float size; uniform int mode; uniform bool cloud;
out vec2 local; out vec4 tint;
void main(){
 vec2 corners[6]=vec2[6](vec2(-1.,-1.),vec2(1.,-1.),vec2(1.,1.),vec2(-1.,-1.),vec2(1.,1.),vec2(-1.,1.));
 vec4 q=normalize(quat); float x=q.x,y=q.y,z=q.z,w=q.w;
 mat3 R=mat3(1.-2.*(y*y+z*z),2.*(x*y+z*w),2.*(x*z-y*w),2.*(x*y-z*w),1.-2.*(x*x+z*z),2.*(y*z+x*w),2.*(x*z+y*w),2.*(y*z-x*w),1.-2.*(x*x+y*y));
 mat3 A=mat3(view)*R*mat3(scale.x,0.,0.,0.,scale.y,0.,0.,0.,scale.z);
 vec4 p=view*vec4(pos,1.); vec4 clip=projection*p;
 if(clip.w<=0. || clip.z < -clip.w || clip.z > clip.w){gl_Position=vec4(2.,2.,2.,1.);local=vec2(20.);tint=vec4(0.);return;}
 vec3 Jx=vec3(focal/-p.z,0.,focal*p.x/(p.z*p.z));
 vec3 Jy=vec3(0.,focal/-p.z,focal*p.y/(p.z*p.z));
 vec3 ax=transpose(A)*Jx, ay=transpose(A)*Jy;
 float a=dot(ax,ax)+.22,b=dot(ax,ay),c=dot(ay,ay)+.22;
 float mid=.5*(a+c), delta=sqrt(max(0.,.25*(a-c)*(a-c)+b*b));
 vec2 v1=abs(b)>.00001?normalize(vec2(b,mid+delta-a)):(a>=c?vec2(1.,0.):vec2(0.,1.));
 vec2 v2=vec2(-v1.y,v1.x); vec2 corner=corners[gl_VertexID];
 float extent=cloud?1.4:3.;
 vec2 offset=extent*size*(corner.x*sqrt(clamp(mid+delta,.2,4096.))*v1+corner.y*sqrt(clamp(mid-delta,.2,4096.))*v2);
 clip.xy+=offset*2./viewport*clip.w; gl_Position=clip; local=corner*extent;
 tint=color;
 if(mode==1){float t=clamp((-p.z-1.)/14.,0.,1.);tint.rgb=mix(vec3(.408,.918,1.),vec3(.58,.486,1.),t);}
 if(mode==2){tint.rgb=mix(tint.rgb,vec3(.408,.918,1.),.5);}
}`;
const FRAG = `#version 300 es
precision highp float;
in vec2 local; in vec4 tint; out vec4 outColor; uniform bool cloud;
void main(){float r=dot(local,local);if(r>(cloud?1.96:9.))discard;float a=tint.a*(cloud?(1.-smoothstep(1.,1.96,r)):exp(-.5*r));if(a<.004)discard;outColor=vec4(tint.rgb,a);}`;
const norm = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
function lookAt(eye, target) { const z=norm(eye.map((v,i)=>v-target[i])), x=norm(cross([0,1,0],z)), y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]); }
function perspective(aspect,n,far){const f=1/Math.tan(Math.PI/6);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]);}
export function createVisualViewer(canvas, onInfo = () => {}) {
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,preserveDrawingBuffer:true,powerPreference:'low-power'});
  if(!gl) throw Error('3D preview needs WebGL2. File preview and exports remain available.');
  function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
  const program=gl.createProgram(), vs=shader(gl.VERTEX_SHADER,VERT), fs=shader(gl.FRAGMENT_SHADER,FRAG);
  gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.deleteShader(vs);gl.deleteShader(fs);
  const buffer=gl.createBuffer(), vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  [[0,3,0],[1,3,3],[2,4,6],[3,4,10]].forEach(([i,n,o])=>{gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,n,gl.FLOAT,false,STRIDE*4,o*4);gl.vertexAttribDivisor(i,1);});
  const uniforms=Object.fromEntries(['view','projection','viewport','focal','size','mode','cloud'].map(n=>[n,gl.getUniformLocation(program,n)]));
  let points=new Float32Array(), sorted=new Float32Array(), order=[], yaw=.65, pitch=.5, distance=13, target=[0,1,0], mode=0, pointSize=1, disposed=false, frame=0, auto=false, last=0;
  let walking=false, sortDirty=true, visible=true, gesture=null, cloud=true, radius=1, sourcePhoto=false, lost=false;
  const originalTouchAction=canvas.style.touchAction;
  canvas.style.touchAction='none';
  const listeners=[], pointers=new Map();
  const listen=(el,event,fn,opts)=>{el.addEventListener(event,fn,opts);listeners.push(()=>el.removeEventListener(event,fn,opts));};
  function schedule(){if(!disposed&&!frame)frame=requestAnimationFrame(render);}
  function resize(){const r=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;sortDirty=true;}schedule();}
  function render(now){frame=0;if(disposed||lost||!visible||document.hidden)return;
    if(auto&&!matchMedia('(prefers-reduced-motion: reduce)').matches){yaw+=Math.min(40,now-(last||now))*.00008;sortDirty=true;}last=now;
    const eye=[target[0]+distance*Math.sin(yaw)*Math.cos(pitch),target[1]+distance*Math.sin(pitch),target[2]+distance*Math.cos(yaw)*Math.cos(pitch)],view=lookAt(eye,target);
    if(sortDirty&&points.length){order.sort((a,b)=>{const ai=a*STRIDE,bi=b*STRIDE;return (points[ai]-points[bi])*view[2]+(points[ai+1]-points[bi+1])*view[6]+(points[ai+2]-points[bi+2])*view[10];});for(let i=0;i<order.length;i++)sorted.set(points.subarray(order[i]*STRIDE,order[i]*STRIDE+STRIDE),i*STRIDE);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,sorted,gl.DYNAMIC_DRAW);sortDirty=false;}
    gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(.02,.029,.047,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(program);gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(uniforms.view,false,view);gl.uniformMatrix4fv(uniforms.projection,false,perspective(canvas.width/canvas.height,Math.max(.00001,radius/10000),Math.max(10,radius*100,distance*10)));gl.uniform2f(uniforms.viewport,canvas.width,canvas.height);gl.uniform1f(uniforms.focal,canvas.height/(2*Math.tan(Math.PI/6)));gl.uniform1f(uniforms.size,mode===2?pointSize*.5:pointSize);gl.uniform1i(uniforms.mode,mode);gl.uniform1i(uniforms.cloud,cloud?1:0);gl.drawArraysInstanced(gl.TRIANGLES,0,6,points.length/STRIDE);
    if(auto)schedule();
  }
  function zoom(value){distance=Math.max(radius*.01,Math.min(radius*50,value));}
  function pan(dx,dy){const speed=distance/Math.max(1,canvas.clientHeight);target[0]-=dx*Math.cos(yaw)*speed;target[2]+=dx*Math.sin(yaw)*speed;target[1]+=dy*speed;}
  listen(canvas,'pointerdown',e=>{canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);gesture=null;auto=false;});
  listen(canvas,'pointermove',e=>{if(!pointers.has(e.pointerId))return;const old=pointers.get(e.pointerId);pointers.set(e.pointerId,[e.clientX,e.clientY]);if(pointers.size===2){const[a,b]=[...pointers.values()],gap=Math.hypot(a[0]-b[0],a[1]-b[1]),center=[(a[0]+b[0])/2,(a[1]+b[1])/2];if(gesture&&gap>1){zoom(distance*gesture.gap/gap);pan(center[0]-gesture.center[0],center[1]-gesture.center[1]);}gesture={gap,center};}else if(e.shiftKey||e.buttons===2){pan(e.clientX-old[0],e.clientY-old[1]);}else{yaw-=(e.clientX-old[0])*.006;pitch=Math.max(-1.4,Math.min(1.4,pitch+(e.clientY-old[1])*.005));}sortDirty=true;schedule();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(canvas,type,e=>{pointers.delete(e.pointerId);gesture=null;});
  listen(canvas,'contextmenu',e=>e.preventDefault());
  listen(canvas,'wheel',e=>{if(e.ctrlKey)return;e.preventDefault();zoom(distance*Math.exp(e.deltaY*.001));auto=false;sortDirty=true;schedule();},{passive:false});
  listen(canvas,'keydown',e=>{if(!['w','a','s','d','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','+','=','-','0'].includes(e.key))return;e.preventDefault();auto=false;if(e.key==='0'){fit(sourcePhoto);return;}if(['+','=','-'].includes(e.key))zoom(distance*(e.key==='-'?1.1:1/1.1));const forward=e.key==='w'||e.key==='ArrowUp'?1:e.key==='s'||e.key==='ArrowDown'?-1:0,side=e.key==='d'||e.key==='ArrowRight'?1:e.key==='a'||e.key==='ArrowLeft'?-1:0;const speed=distance*.025;target[0]+=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*speed;target[2]+=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*speed;sortDirty=true;schedule();});
  listen(canvas,'webglcontextlost',e=>{e.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;onInfo('3D context lost. Reload the page to restore the preview; use a smaller asset.');});
  // GPU resource handles are invalid after restoration; do not report a blank scene as successful.
  listen(canvas,'webglcontextrestored',()=>onInfo('Graphics memory was reset. Reload the page to restore the preview.'));
  listen(document,'visibilitychange',()=>{if(!document.hidden)schedule();});
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(canvas);
  const observer=new IntersectionObserver(entries=>{visible=entries[0]?.isIntersecting??true;if(visible)schedule();});observer.observe(canvas);resize();
  function fit(photo=false){if(!points.length)return;const b=bounds(points);radius=b.radius;target=b.center;const aspect=Math.max(.1,canvas.width/canvas.height);distance=b.radius/Math.sin(Math.atan(Math.tan(Math.PI/6)*Math.min(1,aspect)))*1.15;yaw=.35;pitch=.18;if(photo){target=[0,0,-2.6];distance=2.6;yaw=0;pitch=0;}sortDirty=true;schedule();}
  return {
    setPoints(p,{photo=false,kind='point-cloud'}={}){if(disposed||lost)throw Error('Reload the page to restore the visual viewer.');bounds(p);if(!['point-cloud','gaussian-splat'].includes(kind))throw Error('Unknown visual representation.');points=p.slice();cloud=kind==='point-cloud';sourcePhoto=photo;auto=false;walking=false;sorted=new Float32Array(p.length);order=Array.from({length:p.length/STRIDE},(_,i)=>i);fit(photo);},
    clear(){points=new Float32Array();sorted=new Float32Array();order=[];auto=false;sortDirty=true;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,0,gl.DYNAMIC_DRAW);schedule();},
    setMode(m){mode=Number.isInteger(m)?Math.max(0,Math.min(2,m)):0;schedule();},
    setSize(n){if(Number.isFinite(n))pointSize=Math.max(.25,Math.min(3,n));schedule();},
    reset(){fit(sourcePhoto);},photoCamera(){fit(true);},
    flip(){for(let i=0;i<points.length;i+=STRIDE){points[i+1]*=-1;points[i+2]*=-1;const x=points[i+10],y=points[i+11],z=points[i+12],w=points[i+13];points[i+10]=w;points[i+11]=-z;points[i+12]=y;points[i+13]=-x;}sourcePhoto=false;fit();},
    orbit(){auto=!auto;schedule();return auto;},
    walk(){walking=!walking;if(walking){pitch=0;distance=Math.min(distance,radius*.5);sortDirty=true;schedule();}else fit();return walking;},
    snapshot(){return canvas.toDataURL('image/png');},
    destroy(){disposed=true;cancelAnimationFrame(frame);listeners.forEach(fn=>fn());resizeObserver.disconnect();observer.disconnect();canvas.style.touchAction=originalTouchAction;gl.deleteBuffer(buffer);gl.deleteVertexArray(vao);gl.deleteProgram(program);}
  };
}
