/** Dependency-free, perspective-projected planning geometry, not a reconstructed splat. */
/** `fixed` ({width, height}) draws at that size without watching the element, for an off-screen canvas (share-video.mjs). */
export function createRenderer(canvas, {wheelZoom = true, fixed = null} = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable. Map editing and exports still work.');
  let world = null, result = null, ghost = null, marks = null, cursor = 0, selected = '', yaw = -0.55, zoom = 1, mode = 'iso', drag = null, raf = 0;
  // Take-apart view (after cutaway's exploded views): one object lifted `height` m out of the map, and the view centred
  // `amount` of the way from the map's centre to a point. Both are presentation only; the map itself never changes.
  let lift = null, focus = null;
  let width = 600, height = 400;
  let ro = { disconnect() {} };
  if (fixed) { width = fixed.width; height = fixed.height; canvas.width = width; canvas.height = height; }
  else { ro = new ResizeObserver(() => { const r = canvas.getBoundingClientRect(); width = Math.max(1, r.width); height = Math.max(1, r.height); const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw(); });
    ro.observe(canvas); }
  function project(x, y, z) {
    const W = world?.width || 18, D = world?.depth || 13, f = focus?.amount || 0;
    x -= W / 2 + (f ? (focus.x - W / 2) * f : 0); z -= D / 2 + (f ? (focus.z - D / 2) * f : 0);
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
  function drawObject(o, y0 = 0){
      const {x,z,w,d}=o, h=mode==='top'?0:o.h, top=y0+h, active=o.id===selected, unknown=o.kind==='unknown', nogo=o.kind==='no-go';
      const stroke=active?'#00f5ff':unknown?'#817393':nogo?'#e879f977':'#a855f788';
      const corners=[[x,top,z],[x+w,top,z],[x+w,top,z+d],[x,top,z+d]];
      if(mode!=='top') {
        const faces=[[[x,y0,z],[x+w,y0,z],[x+w,top,z],[x,top,z]],[[x+w,y0,z],[x+w,y0,z+d],[x+w,top,z+d],[x+w,top,z]],[[x+w,y0,z+d],[x,y0,z+d],[x,top,z+d],[x+w,top,z+d]],[[x,y0,z+d],[x,y0,z],[x,top,z],[x,top,z+d]]];
        faces.sort((a,b)=>a.reduce((s,p)=>s+project(...p)[2],0)-b.reduce((s,p)=>s+project(...p)[2],0));
        faces.forEach((f,i)=>polygon(f,unknown?'#2b263d':['#302044','#241a36','#3c2754','#281b3a'][i],stroke,.7));
      }
      polygon(corners,unknown?'#29273a':active?'#274957':'#4a3163',stroke,active?1.6:.8);
      if(unknown){ for(let k=.15;k<w;k+=.38) line([x+k,top+.02,z],[Math.min(x+w,x+k+.6),top+.02,z+d],'#a895c544'); }
      if((active && !y0) || mode==='top'){const p=project(x+w/2,top+.18,z+d/2);ctx.fillStyle='#e4d9f4';ctx.textAlign='center';ctx.font='9px system-ui';ctx.fillText(o.name.slice(0,23),p[0],p[1]-6);}
  }
  /** The lifted object: its footprint left dashed on the floor, guide lines up to it, and its measured size beside it. */
  function drawLifted(o, y0){
    const {x,z,w,d,h}=o, foot=[[x,0,z],[x+w,0,z],[x+w,0,z+d],[x,0,z+d]];
    ctx.save(); ctx.setLineDash([4,4]); polygon(foot,'#00f5ff10','#00f5ffaa',1);
    for(const [cx,,cz] of foot) line([cx,0,cz],[cx,y0,cz],'#00f5ff66',1);
    ctx.restore();
    drawObject(o, y0);
    // The label sits above the box's highest corner on screen, on a dark backing, so it never crosses an edge.
    const tops=[[x,y0+h,z],[x+w,y0+h,z],[x+w,y0+h,z+d],[x,y0+h,z+d]].map(c=>project(...c)), cx=project(x+w/2,y0+h,z+d/2)[0], top=Math.min(...tops.map(t=>t[1]));
    const name=o.name.slice(0,32), size=`${w.toFixed(2)} × ${d.toFixed(2)} m · ${h.toFixed(2)} m tall`;
    ctx.font='600 12px system-ui'; const nw=ctx.measureText(name).width; ctx.font='11px ui-monospace,monospace'; const sw=ctx.measureText(size).width;
    const bw=Math.max(nw,sw)+16, bx=Math.max(2,Math.min(width-bw-2,cx-bw/2)), by=Math.max(2,top-46);
    ctx.beginPath(); ctx.roundRect(bx,by,bw,38,6); ctx.fillStyle='rgba(6,6,10,.82)'; ctx.fill(); ctx.strokeStyle='#00f5ff55'; ctx.lineWidth=1; ctx.stroke();
    ctx.textAlign='center'; ctx.fillStyle='#f1f1f6'; ctx.font='600 12px system-ui'; ctx.fillText(name,bx+bw/2,by+16);
    ctx.fillStyle='#00f5ff'; ctx.font='11px ui-monospace,monospace'; ctx.fillText(size,bx+bw/2,by+31);
  }
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
    if (ghost?.length) {
      // The route before an edit, kept for comparison: dimmed and dashed under the current one.
      ctx.save(); ctx.setLineDash([6, 5]); ctx.beginPath(); ghost.forEach((p,i) => { const v = project(p.x,.02,p.z); i ? ctx.lineTo(v[0],v[1]) : ctx.moveTo(v[0],v[1]); }); ctx.lineWidth=1.4; ctx.strokeStyle='#ff9a3c99'; ctx.stroke(); ctx.restore();
    }
    if (result?.route.length) {
      // A route to a chosen goal is a single path, drawn bolder than the dense coverage sweep.
      ctx.beginPath(); result.route.forEach((p,i) => { const v = project(p.x,.025,p.z); i ? ctx.lineTo(...v.slice(0,2)) : ctx.moveTo(...v.slice(0,2)); }); const toGoal=!!result.goal; ctx.lineWidth=toGoal?1.6:.65; ctx.strokeStyle=toGoal?'#00f5ff55':'#00f5ff2b'; ctx.stroke();
      const end = Math.min(result.route.length, Math.max(1, Math.floor(cursor * (result.route.length - 1)) + 1));
      ctx.beginPath(); for(let i=0; i<end; i++){ const v=project(result.route[i].x,.03,result.route[i].z); i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]); } ctx.lineWidth=toGoal?2.8:1.35;ctx.strokeStyle=toGoal?'#00f5ffe6':'#00f5ffa6';ctx.stroke();
    }
    const lifted = mode !== 'top' && lift?.height > 0 ? world.objects.find(o => o.id === lift.id) : null;
    const objects = [...world.objects].filter(o => o !== lifted).sort((a,b) => project(a.x,0,a.z)[2]-project(b.x,0,b.z)[2]);
    for(const o of objects) drawObject(o);
    if(lifted) drawLifted(lifted, lift.height);
    // A located photo: where it was taken and the way it faced; and the floor spot tapped in it.
    if(marks?.camera){const c=marks.camera,ahead=Math.max(.8,(W+D)*.05),side=ahead*.4,tip=project(c.x,.05,c.z),l=project(c.x+c.dx*ahead-c.dz*side,.05,c.z+c.dz*ahead+c.dx*side),r=project(c.x+c.dx*ahead+c.dz*side,.05,c.z+c.dz*ahead-c.dx*side);
      ctx.beginPath();ctx.moveTo(tip[0],tip[1]);ctx.lineTo(l[0],l[1]);ctx.lineTo(r[0],r[1]);ctx.closePath();ctx.fillStyle='#f4c76a2e';ctx.fill();ctx.strokeStyle='#f4c76acc';ctx.lineWidth=1.2;ctx.stroke();
      ctx.beginPath();ctx.arc(tip[0],tip[1],4,0,Math.PI*2);ctx.fillStyle='#f4c76a';ctx.fill();ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillStyle='#f6e2b8';ctx.fillText('Photo taken here',tip[0],tip[1]-10);}
    if(marks?.goal){const g=project(marks.goal.x,.05,marks.goal.z);ctx.beginPath();ctx.arc(g[0],g[1],9,0,Math.PI*2);ctx.strokeStyle='#f4c76a';ctx.lineWidth=1.5;ctx.stroke();ctx.beginPath();ctx.arc(g[0],g[1],3,0,Math.PI*2);ctx.fillStyle='#f4c76a';ctx.fill();
      ctx.font='10px system-ui';ctx.textAlign='center';ctx.fillStyle='#f6e2b8';ctx.fillText('Goal',g[0],g[1]-14);}
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
  return {setWorld(w){world=w;draw();},setResult(r){result=r;cursor=0;draw();},setGhost(g){ghost=Array.isArray(g)&&g.length>1?g:null;draw();},setMarks(m){marks=m||null;draw();},setCursor(c){cursor=Math.max(0,Math.min(1,c));draw();},setSelected(id){selected=id;draw();},setMode(m){mode=m;draw();},setView(v){if(Number.isFinite(v?.yaw))yaw=v.yaw;if(Number.isFinite(v?.zoom))zoom=Math.max(.5,Math.min(2.3,v.zoom));if(v&&'focus' in v)focus=v.focus&&Number.isFinite(v.focus.x)&&Number.isFinite(v.focus.z)?{x:v.focus.x,z:v.focus.z,amount:Math.max(0,Math.min(1,+v.focus.amount||0))}:null;draw();},setLift(id,height=0){lift=id&&height>0?{id,height:Math.min(height,50)}:null;draw();},reset(){zoom=1;yaw=-.55;focus=null;lift=null;draw();},destroy(){ro.disconnect();cancelAnimationFrame(raf);for(const [event,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['wheel',wheel],['keydown',key]])canvas.removeEventListener(event,fn);}};
}
