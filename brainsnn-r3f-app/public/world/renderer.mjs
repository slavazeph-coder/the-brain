/** Dependency-free, perspective-projected planning geometry, not a reconstructed splat. */
export function createRenderer(canvas, {wheelZoom = true} = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable. Map editing and exports still work.');
  let world = null, result = null, cursor = 0, selected = '', yaw = -0.55, zoom = 1, mode = 'iso', drag = null, raf = 0;
  let width = 600, height = 400;
  const ro = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); width = Math.max(1, r.width); height = Math.max(1, r.height); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); });
  ro.observe(canvas);
  function project(x, y, z) {
    const W = world?.width || 18, D = world?.depth || 13;
    x -= W / 2; z -= D / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw), rx = x * c - z * s, rz = x * s + z * c;
    const scale = Math.min(width / (W + D) * 1.13, height / (W + D) * (mode === 'top' ? 1.18 : 1.95)) * zoom;
    if (mode === 'top') return [width / 2 + x * scale * 1.7, height / 2 + z * scale * 1.7, z];
    const perspective = 1 / (1 + rz / Math.max(W + D, 10) * 0.2);
    return [width / 2 + rx * scale * perspective, height / 2 + (rz * .54 - y * .93) * scale * perspective + 15, rz];
  }
  function polygon(points, fill, stroke = null, thickness = 1) {
    if (!points.length) return;
    ctx.beginPath(); points.forEach((p, i) => { const v = project(...p); i ? ctx.lineTo(v[0], v[1]) : ctx.moveTo(v[0], v[1]); }); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = thickness; ctx.stroke(); }
  }
  function line(a, b, color, thickness = 1) { const p = project(...a), q = project(...b); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.strokeStyle = color; ctx.lineWidth = thickness; ctx.stroke(); }
  function draw() {
    cancelAnimationFrame(raf); ctx.clearRect(0, 0, width, height);
    if (!world) return;
    const W = world.width, D = world.depth;
    const floor=(world.floor||[[0,0],[W,0],[W,D],[0,D]]).map(([x,z])=>[x,0,z]);
    polygon(floor, '#0d1821', '#00f5ff66');
    // Clip the grid to the observed polygon so missing floor never looks traversable.
    ctx.save();polygon(floor,null);ctx.clip();
    for(let x = 0; x <= W; x += Math.max(1, Math.ceil(W / 40))) line([x,0,0],[x,0,D], '#00f5ff16');
    for(let z = 0; z <= D; z += Math.max(1, Math.ceil(D / 40))) line([0,0,z],[W,0,z], '#00f5ff16');
    ctx.restore();
    if (result?.route.length) {
      ctx.beginPath(); result.route.forEach((p,i) => { const v = project(p.x,.025,p.z); i ? ctx.lineTo(...v.slice(0,2)) : ctx.moveTo(...v.slice(0,2)); }); ctx.lineWidth=.65; ctx.strokeStyle='#00f5ff2b'; ctx.stroke();
      const end = Math.min(result.route.length, Math.max(1, Math.floor(cursor * (result.route.length - 1)) + 1));
      ctx.beginPath(); for(let i=0; i<end; i++){ const v=project(result.route[i].x,.03,result.route[i].z); i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]); } ctx.lineWidth=1.35;ctx.strokeStyle='#00f5ffa6';ctx.stroke();
    }
    const objects = [...world.objects].sort((a,b) => project(a.x,0,a.z)[2]-project(b.x,0,b.z)[2]);
    for(const o of objects){
      const {x,z,w,d}=o, h=mode==='top'?0:o.h, active=o.id===selected, unknown=o.kind==='unknown', nogo=o.kind==='no-go';
      const stroke=active?'#00f5ff':unknown?'#817393':nogo?'#e879f977':'#a855f788';
      const corners=[[x,h,z],[x+w,h,z],[x+w,h,z+d],[x,h,z+d]];
      if(mode!=='top') {
        const faces=[[[x,0,z],[x+w,0,z],[x+w,h,z],[x,h,z]],[[x+w,0,z],[x+w,0,z+d],[x+w,h,z+d],[x+w,h,z]],[[x+w,0,z+d],[x,0,z+d],[x,h,z+d],[x+w,h,z+d]],[[x,0,z+d],[x,0,z],[x,h,z],[x,h,z+d]]];
        faces.sort((a,b)=>a.reduce((s,p)=>s+project(...p)[2],0)-b.reduce((s,p)=>s+project(...p)[2],0));
        faces.forEach((f,i)=>polygon(f,unknown?'#2b263d':['#302044','#241a36','#3c2754','#281b3a'][i],stroke,.7));
      }
      polygon(corners,unknown?'#29273a':active?'#274957':'#4a3163',stroke,active?1.6:.8);
      if(unknown){ for(let k=.15;k<w;k+=.38) line([x+k,h+.02,z],[Math.min(x+w,x+k+.6),h+.02,z+d],'#a895c544'); }
      if(active || mode==='top'){const p=project(x+w/2,h+.18,z+d/2);ctx.fillStyle='#e4d9f4';ctx.textAlign='center';ctx.font='9px system-ui';ctx.fillText(o.name.slice(0,23),p[0],p[1]-6);}
    }
    const pos=result?.route[Math.min(result.route.length-1,Math.floor(cursor*(result.route.length-1)))]||world.start;
    const p=project(pos.x,.18,pos.z); ctx.beginPath();ctx.arc(p[0],p[1],8,0,Math.PI*2);ctx.fillStyle='#00f5ff22';ctx.fill();ctx.strokeStyle='#00f5ff88';ctx.lineWidth=1;ctx.stroke();ctx.beginPath();ctx.arc(p[0],p[1],3.5,0,Math.PI*2);ctx.fillStyle='#b1ffff';ctx.fill();
    ctx.font='9px ui-monospace,monospace';ctx.fillStyle='#5d899a';ctx.textAlign='center'; const wp=project(W/2,0,D+.6);ctx.fillText(`${W.toFixed(1)} m`,wp[0],wp[1]+10); const dp=project(W+.8,0,D/2);ctx.fillText(`${D.toFixed(1)} m`,dp[0]+17,dp[1]);
  }
  function down(e){if(e.pointerType==='touch')return;drag={x:e.clientX,yaw};canvas.setPointerCapture(e.pointerId);}
  function move(e){if(drag){yaw=drag.yaw+(e.clientX-drag.x)/220;draw();}}
  function up(){drag=null;}
  function wheel(e){if(e.ctrlKey)return;e.preventDefault();zoom=Math.max(.5,Math.min(2.3,zoom*Math.exp(-e.deltaY*.001)));draw();}
  function key(e){if(!['ArrowLeft','ArrowRight','+','-','=','0'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(['+','='].includes(e.key))zoom=Math.min(2.3,zoom*1.1);if(e.key==='-')zoom=Math.max(.5,zoom/1.1);if(e.key==='0'){zoom=1;yaw=-.55;}draw();}
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);if(wheelZoom)canvas.addEventListener('wheel',wheel,{passive:false});canvas.addEventListener('keydown',key);
  return {setWorld(w){world=w;draw();},setResult(r){result=r;cursor=0;draw();},setCursor(c){cursor=Math.max(0,Math.min(1,c));draw();},setSelected(id){selected=id;draw();},setMode(m){mode=m;draw();},reset(){zoom=1;yaw=-.55;draw();},destroy(){ro.disconnect();cancelAnimationFrame(raf);for(const [event,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['wheel',wheel],['keydown',key]])canvas.removeEventListener(event,fn);}};
}
