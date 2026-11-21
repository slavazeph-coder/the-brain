export function kitchenPinMarkup() {
  return `<details id="rolling-pin" data-kitchen-pin>
    <summary>Put a rolling pin on a tray</summary>
    <p>Try a kitchen job with a robot gripper. Watch what happens when its fingers close around the pin or stay open.</p>
    <div class="robot-task-settings"><label>Fingers
      <select data-kitchen-controller><option value="grip">Close to pick up the pin</option><option value="open">Keep them open</option></select>
    </label></div>
    <div class="robot-task-actions"><button type="button" class="primary" data-kitchen-run>Try the kitchen task</button></div>
    <p data-kitchen-status role="status"></p>
    <section class="robot-task-result" data-kitchen-result hidden aria-label="Rolling pin replay">
      <h4 data-kitchen-title></h4><p data-kitchen-score></p>
      <figure><canvas data-kitchen-canvas width="680" height="320" role="img" aria-label="Recorded positions of the blue gripper, brown rolling pin and silver tray" aria-describedby="kitchen-pin-frame"></canvas></figure>
      <label>Move through the kitchen run
        <input type="range" data-kitchen-time min="0" max="120" step="1" value="0">
      </label>
      <p data-kitchen-frame id="kitchen-pin-frame"></p>
      <div class="robot-task-actions">
        <button type="button" data-kitchen-play>Play the run</button>
        <button type="button" data-kitchen-xml>Save kitchen scene (.xml)</button>
        <button type="button" data-kitchen-json>Save kitchen run (.json)</button>
      </div>
    </section>
  </details>`;
}

// Project measured body positions and pin orientation into an oblique view of the work surface.
function draw(canvas, frame) {
  const ctx=canvas.getContext('2d');
  if(!ctx) return;
  ctx.fillStyle='#101925';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  const project=([x,y,z])=>[340+570*x+260*y,227-120*y-560*z];
  function polygon(points,fill,stroke) {
    ctx.beginPath();
    ctx.moveTo(...project(points[0]));
    points.slice(1).forEach(p=>ctx.lineTo(...project(p)));
    ctx.closePath();
    ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();
  }
  function box(cx,cy,z,hx,hy,depth,fill,edge) {
    const base=[[cx-hx,cy-hy,z],[cx+hx,cy-hy,z],[cx+hx,cy+hy,z],[cx-hx,cy+hy,z]];
    const top=base.map(([x,y,b])=>[x,y,b+depth]);
    polygon([base[0],base[1],top[1],top[0]],fill,edge);
    polygon([base[0],base[3],top[3],top[0]],fill,edge);
    polygon(top,fill,edge);
  }
  box(0,0,-.025,.44,.26,.025,'#314455','#587188');
  box(.18,0,0,.111,.165,.012,'#849fa5','#c9dcdf');
  box(.18,.162,.012,.11,.003,.017,'#b1c8cd','#d5e6e8');
  const [w,x,y,z]=frame.pinQuaternion;
  const axis=[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)];
  function pinPart(half,width,color) {
    const a=frame.pin.map((v,i)=>v-axis[i]*half), b=frame.pin.map((v,i)=>v+axis[i]*half);
    ctx.beginPath(); ctx.moveTo(...project(a));ctx.lineTo(...project(b));
    ctx.lineWidth=width;ctx.lineCap='round';ctx.strokeStyle=color;ctx.stroke();
  }
  pinPart(.123,12,'#9d683d');
  pinPart(.082,27,'#f2b66d');
  for (const jaw of [frame.left,frame.right]) {
    box(jaw[0],jaw[1],jaw[2]-.02,.009,.044,.04,'#78c9d9','#bbf2f8');
    box(jaw[0],jaw[1],jaw[2]+.02,.006,.015,.04,'#427b8f','#93bdc9');
  }
  box(frame.gripper[0],frame.gripper[1],frame.gripper[2]+.053,.082,.02,.014,'#39768a','#92c7d6');
}

export function mountKitchenPin(root, {signal,createWorker=()=>new Worker(new URL('./robot-task-worker.mjs',import.meta.url),{type:'module'})}={}) {
  const panel=root.matches('[data-kitchen-pin]') ? root : root.querySelector('[data-kitchen-pin]');
  const el=name=>panel.querySelector('[data-kitchen-'+name+']');
  const local=new AbortController();
  let worker=null, timeout=null, seq=0, episode=null, playback=null;
  function stopPlaying() {
    if(playback!==null) cancelAnimationFrame(playback);
    playback=null;
    el('play').textContent='Play the run';
  }
  function releaseWorker() {
    clearTimeout(timeout);
    worker?.terminate();
    worker=null;
    el('run').disabled=false;
  }
  function clear() {
    stopPlaying();releaseWorker();
    episode=null;
    el('result').hidden=true;
    el('status').textContent='';
  }
  function frameAt(index) {
    const f=episode.frames[index];
    el('time').value=String(index);
    el('time').setAttribute('aria-valuetext',f.time.toFixed(2)+' seconds');
    const where=f.contacts.tray ? 'Touching the tray.' : f.contacts.left && f.contacts.right ? 'Held by both fingers.' : f.contacts.left || f.contacts.right ? 'One finger touches the pin.' : 'Fingers clear of the pin.';
    el('frame').textContent=f.time.toFixed(2)+' s · '+where+' Pin center is '+(f.pin[2]*100).toFixed(1)+' cm above the worktop.';
    draw(el('canvas'),f);
  }
  function finished(data) {
    episode=data;
    const {score}=episode;
    el('result').hidden=false;
    el('time').max=String(episode.frames.length-1);
    el('title').textContent=score.success ? 'The gripper placed the pin on the tray.' : 'The rolling pin stayed off the tray.';
    el('score').textContent='The pin rose '+(score.liftMeters*100).toFixed(1)+' cm. It rested on the tray with the fingers clear for '+score.settledTraySeconds.toFixed(2)+' s.';
    el('status').textContent='MuJoCo recorded the kitchen run.';
    frameAt(0);
  }
  function run() {
    clear();
    const id=++seq;
    try {
      const active=createWorker();
      worker=active;
      el('run').disabled=true;
      el('status').textContent='Running the kitchen task on this device…';
      function failed(message) {
        if(active!==worker) return;
        releaseWorker();el('status').textContent=message;
      }
      active.onerror=event=>{event.preventDefault();failed('The kitchen simulator could not start. Try again after loading the playground.');};
      active.onmessage=({data})=>{
        if(active!==worker || data?.id!==id) return;
        if(data.type==='error') return failed(data.message || 'The kitchen run stopped.');
        if(data.type!=='result') return;
        releaseWorker();finished(data.episode);
      };
      timeout=setTimeout(()=>failed('This run took too long. Try the kitchen task again.'),45000);
      active.postMessage({type:'kitchen-run',id,controller:el('controller').value});
    } catch {releaseWorker();el('status').textContent='The browser could not start the kitchen simulator.';}
  }
  function togglePlay() {
    if(playback!==null) {stopPlaying();return;}
    if(!episode) return;
    let index=Number(el('time').value);
    if(index===episode.frames.length-1) {index=0;frameAt(0);}
    const start=performance.now()-1000*episode.frames[index].time;
    el('play').textContent='Pause the run';
    const advance=now=>{
      const next=Math.min(episode.frames.length-1,Math.floor((now-start)/(1000*episode.sampleIntervalSeconds)));
      frameAt(Math.max(0,next));
      if(next===episode.frames.length-1) stopPlaying();
      else playback=requestAnimationFrame(advance);
    };
    playback=requestAnimationFrame(advance);
  }
  function save(format) {
    if(!episode) return;
    const file=format==='json' ? JSON.stringify(episode,null,2) : episode.modelXML;
    const url=URL.createObjectURL(new Blob([file],{type:format==='json'?'application/json':'application/xml'}));
    const a=document.createElement('a');a.href=url;a.download='rolling-pin-'+episode.controller+'.'+format;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),20000);
  }
  const on=(target,event,handler)=>target.addEventListener(event,handler,{signal:local.signal});
  on(el('controller'),'change',clear);on(el('run'),'click',run);on(el('play'),'click',togglePlay);
  on(el('time'),'input',()=>{stopPlaying();if(episode)frameAt(Number(el('time').value));});
  on(el('xml'),'click',()=>save('xml'));on(el('json'),'click',()=>save('json'));
  on(panel,'toggle',()=>{if(!panel.open)stopPlaying();});
  function suspend() {
    stopPlaying();
    if(worker) {releaseWorker();el('status').textContent='Run stopped when you left the kitchen task.';}
  }
  const dispose=()=>{local.abort();clear();};
  signal?.addEventListener('abort',dispose,{once:true});
  return {dispose,suspend,clear};
}
