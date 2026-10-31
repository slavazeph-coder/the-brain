import {sampleWorld,planWorld,ROBOTS} from './core.mjs';
import {createRenderer} from './renderer.mjs';

/** The hero's three world states. Sample and reviewed draw the real authored floor and the real planner's route on it;
 *  generated states its rules and points to the photo flow, because no generated result exists until someone brings a photo. */
export function createHeroDemo(root,{onOpen}={}){
  const $=id=>root.querySelector('#'+id),canvas=$('hero-demo-canvas'),renderer=createRenderer(canvas,{wheelZoom:false});
  const world=sampleWorld(),plan=planWorld(world,{...ROBOTS.cleaner,margin:.1}),minutes=Math.max(1,Math.round(plan.travelSeconds/60));
  const STATES={
    sample:{badge:'AUTHORED SAMPLE · NOT A RECONSTRUCTION',text:'A training floor drawn by hand, so you can try every tool before capturing anything. Drag it to turn.',action:'Open it in the workspace →'},
    generated:{badge:'GENERATED · VISUAL ONLY',text:'One photo becomes a 3D point preview on your device. It is not measured, so it never becomes a collision map. Walk the space with your phone for geometry you can review.',action:'Make one from a photo ↗',link:true},
    reviewed:{badge:'REVIEWED · PLANNING PREVIEW',text:`Once scale and obstacles are confirmed, the planner runs. This is its actual pass for a cleaning robot on the sample floor: ${Math.round(plan.reachableArea)} m² reached, ${Math.round(plan.distance).toLocaleString('en')} m of travel, about ${minutes} min, with unknown space kept blocked. A simulation, not a safety certificate.`,action:'Run it in the workspace →'},
  };
  let state='',frame=0;
  renderer.setWorld(world);
  function animate(){
    cancelAnimationFrame(frame);
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){renderer.setCursor(1);return;}
    const start=performance.now(),step=now=>{const t=Math.min(1,(now-start)/3800);renderer.setCursor(t);if(t<1)frame=requestAnimationFrame(step);};
    frame=requestAnimationFrame(step);
  }
  function show(next,focus=false){
    if(next===state)return;state=next;const s=STATES[next];
    for(const tab of root.querySelectorAll('[data-demo]')){const on=tab.dataset.demo===next;tab.setAttribute('aria-selected',String(on));tab.tabIndex=on?0:-1;if(on&&focus)tab.focus();}
    canvas.hidden=next==='generated';$('hero-demo-generated').hidden=next!=='generated';
    $('hero-demo-badge').textContent=s.badge;$('hero-demo-text').textContent=s.text;
    $('hero-demo-open').hidden=!!s.link;$('hero-demo-link').hidden=!s.link;(s.link?$('hero-demo-link'):$('hero-demo-open')).textContent=s.action;
    cancelAnimationFrame(frame);
    if(next==='reviewed'){renderer.setResult(plan);animate();}else if(next==='sample')renderer.setResult(null);
  }
  root.addEventListener('click',e=>{const tab=e.target.closest('[data-demo]');if(tab)show(tab.dataset.demo);if(e.target.closest('#hero-demo-open'))onOpen?.(state);});
  root.addEventListener('keydown',e=>{
    if(!e.target.closest('[data-demo]')||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();const ids=Object.keys(STATES),i=ids.indexOf(state);
    show(ids[e.key==='Home'?0:e.key==='End'?ids.length-1:(i+(e.key==='ArrowRight'?1:ids.length-1))%ids.length],true);});
  show('sample');
  return {show,plan};
}
