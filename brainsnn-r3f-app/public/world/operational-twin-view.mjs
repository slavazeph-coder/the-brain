/** Software proxy view. Painter-sorted boxes, using the same source poses. */
const NS='http://www.w3.org/2000/svg',palette=['#536d8c','#7f78a8','#639391','#9b906d','#627799','#927a9c'];
const point=(m,p)=>m?[0,1,2].map(i=>m[i]*p[0]+m[4+i]*p[1]+m[8+i]*p[2]+m[12+i]):p;
const shade=(hex,k)=>'#'+[1,3,5].map(i=>Math.round(Math.min(255,parseInt(hex.slice(i,i+2),16)*k)).toString(16).padStart(2,'0')).join('');
export function createSoftwareTwinView(container,{parts,onSelect=()=>{}}){
  const svg=document.createElementNS(NS,'svg');svg.setAttribute('role','img');svg.setAttribute('tabindex','0');svg.setAttribute('aria-label','Software component proxy view. Drag or use arrow keys to orbit, scroll to zoom, 0 to reset. Select parts using the component list or view.');container.replaceChildren(svg);
  const geometries=parts.filter(p=>p.centre&&p.size).map((p,index)=>{const a=p.yaw*Math.PI/180,c=Math.cos(a),s=Math.sin(a),corners=[];
    for(const [x,y,z] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]){const dx=x*p.size[0]/2,dz=z*p.size[2]/2;corners.push([p.centre[0]+c*dx+s*dz,p.centre[1]+y*p.size[1]/2,p.centre[2]-s*dx+c*dz]);}
    return {p,corners,color:p.floor?'#182c3c':palette[index%palette.length]};
  });
  const focus=geometries.filter(g=>!g.p.floor).flatMap(g=>g.corners),all=focus.length?focus:geometries.flatMap(g=>g.corners),lo=[0,1,2].map(i=>Math.min(...all.map(p=>p[i]))),hi=[0,1,2].map(i=>Math.max(...all.map(p=>p[i]))),centre=lo.map((v,i)=>(v+hi[i])/2),span=Math.max(...hi.map((v,i)=>v-lo[i]),1);
  let yaw=.65,pitch=.35,zoom=1,selected=null,isolate=false,matrices={},down=null,disposed=false,frame=0;
  const faces=[[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
  function draw(){if(disposed)return;cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
    if(disposed)return;const {width,height}=container.getBoundingClientRect();if(!width||!height)return;svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch),scale=Math.min(width/(span*1.4),height/(span*.85))*zoom;
    const project=p=>{const [x,y,z]=p.map((n,i)=>n-centre[i]),d=x*sy+z*cy;return [width/2+(x*cy-z*sy)*scale,height/2+(d*sp-y*cp)*scale,d*cp+y*sp];},records=[];
    geometries.forEach(({p,corners,color})=>{if(isolate&&p.componentId!==selected&&!p.floor)return;const vertices=corners.map(v=>project(point(matrices[p.componentId],v)));
      faces.forEach((indices,i)=>{const pts=indices.map(j=>vertices[j]),node=document.createElementNS(NS,'polygon');node.setAttribute('points',pts.map(v=>v.slice(0,2).join(',')).join(' '));node.setAttribute('fill',shade(p.componentId===selected?'#65b8c6':color,[.69,.81,.55,1.2,.86,1][i]));node.setAttribute('stroke','#cfecff55');node.setAttribute('stroke-width','.6');node.dataset.componentId=p.componentId;records.push({depth:pts.reduce((s,v)=>s+v[2],0)/4,node});});
    });records.sort((a,b)=>a.depth-b.depth);
    const label=document.createElementNS(NS,'text');label.setAttribute('x','16');label.setAttribute('y','24');label.setAttribute('fill','#9db5ce');label.setAttribute('font-size','10');label.setAttribute('font-family','monospace');label.textContent='SOFTWARE PROXY VIEW / Y UP';svg.replaceChildren(...records.map(r=>r.node),label);
  });}
  function pointerDown(e){if(e.button!==0)return;down={x:e.clientX,y:e.clientY,yaw,pitch,id:e.target.dataset.componentId};svg.setPointerCapture(e.pointerId);}
  function pointerMove(e){if(!down)return;yaw=down.yaw+(e.clientX-down.x)*.008;pitch=Math.max(-.8,Math.min(1.2,down.pitch+(e.clientY-down.y)*.008));draw();}
  function pointerUp(e){if(!down)return;const old=down;down=null;if(Math.hypot(e.clientX-old.x,e.clientY-old.y)<5&&old.id)onSelect(old.id);}
  function wheel(e){e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw();}
  function reset(){yaw=.65;pitch=.35;zoom=1;draw();}
  function key(e){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','0','+','-'].includes(e.key))return;e.preventDefault();if(e.key==='0')reset();if(e.key==='ArrowLeft')yaw-=.12;if(e.key==='ArrowRight')yaw+=.12;if(e.key==='ArrowUp')pitch=Math.min(1.2,pitch+.12);if(e.key==='ArrowDown')pitch=Math.max(-.8,pitch-.12);if(e.key==='+')zoom=Math.min(4,zoom*1.1);if(e.key==='-')zoom=Math.max(.3,zoom/1.1);draw();}
  svg.addEventListener('pointerdown',pointerDown);svg.addEventListener('pointermove',pointerMove);svg.addEventListener('pointerup',pointerUp);svg.addEventListener('pointercancel',pointerUp);svg.addEventListener('wheel',wheel,{passive:false});svg.addEventListener('keydown',key);
  const observer=new ResizeObserver(draw);observer.observe(container);draw();
  return {select(id,only=false){selected=id;isolate=only;draw();},pose(value){matrices=value;draw();},reset,dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();svg.remove();}};
}
