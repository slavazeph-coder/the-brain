(() => {
'use strict';
const $=id=>document.getElementById(id);
const names={greedy:'Greedy script',planner:'Planner script',recovery:'Recovery script'};
let worker=null,report=null,toastTimer=null;
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function showPage(id){
 id=String(id||'').split('?')[0];
 if(id==='compute')id='campaigns';
 if(!['playground','catalog','campaigns','compute'].includes(id))id='playground';
 window.BrainSNN3DClient?.pause?.();
 if(id!=='playground')window.BrainSNNExperiment?.suspend?.();
 document.querySelectorAll('.workspace-page').forEach(p=>p.hidden=p.id!==id);
 document.querySelectorAll('[data-page]').forEach(b=>{if(b.classList.contains('nav-tab')){b.classList.toggle('active',b.dataset.page===id);b.setAttribute('aria-pressed',String(b.dataset.page===id));}});
 if(['catalog','playground'].includes(id)){if(location.hash!=='#'+id&&!location.hash.startsWith('#'+id+'?'))history.replaceState(null,'','#'+id);}else if(location.hash!=='#'+id)history.replaceState(null,'','#'+id);
 if(id==='playground')window.dispatchEvent(new Event('resize'));
 if(id==='campaigns')window.BrainSNNCampaign?.refreshSelection?.();
}
document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{b.closest('details')?.removeAttribute('open');showPage(b.dataset.page);if(b.dataset.page==='playground')window.BrainSNNExperiment?.restoreFromURL?.();if(b.dataset.catalogTab){window.BrainSNNCatalog?.showTab(b.dataset.catalogTab);document.getElementById('catalog-tab-'+b.dataset.catalogTab)?.focus();}});
const destinations=document.querySelector('.arena-overflow');
document.addEventListener('pointerdown',event=>{if(destinations&&!destinations.contains(event.target))destinations.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&destinations?.open){destinations.open=false;destinations.querySelector('summary')?.focus();}});
window.BrainSNNWorkspace=Object.freeze({showPage});
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));
window.addEventListener('DOMContentLoaded',()=>showPage(location.hash.slice(1)||'playground'));
function wilson(k,n){const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,m=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return[(c-m)*100,(c+m)*100];}
function cancel(){if(worker)worker.terminate();worker=null;$('run-batch').disabled=false;$('cancel-batch').hidden=true;$('batch-progress').hidden=true;$('batch-status').textContent='Campaign stopped. Browser resources released.';}
$('cancel-batch').onclick=cancel;
$('run-batch').onclick=()=>{
 if(worker)return;
 const trials=Math.max(100,Math.min(100000,Math.floor(Number($('trials').value)||100)));
 const baseSeed=Math.max(1,Math.min(2147483646,Math.floor(Number($('seed').value)||42)));
 const config={agent:'recovery',clutter:12,slip:15,mission:'table',recordTrail:false};
 $('run-batch').disabled=true;$('cancel-batch').hidden=false;$('batch-progress').hidden=false;$('progress-fill').style.width='0%';$('batch-status').textContent='Running matched toy-grid worlds…';
 try{
  worker=new Worker('batch-worker.js');
  worker.onerror=()=>{cancel();toast('Campaign worker unavailable in this browser.');};
  worker.onmessage=e=>{const m=e.data;if(m.type==='progress'){$('progress-fill').style.width=(m.done/m.total*100)+'%';$('batch-status').textContent=m.done.toLocaleString()+' / '+m.total.toLocaleString()+' scripted episodes';}
   if(m.type==='complete'){report=m.report;worker.terminate();worker=null;$('run-batch').disabled=false;$('cancel-batch').hidden=true;$('batch-progress').hidden=true;$('batch-status').textContent=(report.trialsPerScript*3).toLocaleString()+' episodes completed across 3 scripts.';showReport();}
  };
  worker.postMessage({trials,baseSeed,config});
 }catch{cancel();toast('Campaign worker unavailable in this browser.');}
};
function showReport(){
 $('empty-score').hidden=true;$('score-results').hidden=false;$('score-rows').replaceChildren();
 report.agents.forEach(a=>{const row=document.createElement('tr'),ci=wilson(a.successes,a.trials);[names[a.agent],(a.successes/a.trials*100).toFixed(1)+'%',(a.steps/a.trials).toFixed(1),(a.collisions/a.trials).toFixed(2)].forEach((value,i)=>{const cell=document.createElement('td');cell.textContent=value;if(i===1)cell.title=a.successes+'/'+a.trials+' completed; approximate 95% interval '+ci[0].toFixed(1)+'–'+ci[1].toFixed(1)+'%';row.appendChild(cell);});$('score-rows').appendChild(row);});
 const failure=report.sampleFailures.find(f=>f.agent==='planner')||report.sampleFailures[0];$('failure-preview').hidden=!failure;
 if(failure){$('failure-title').textContent=names[failure.agent]+' · seed '+failure.seed;$('failure-copy').textContent=failure.state.delivered+'/3 delivered · '+failure.state.steps+' steps · '+(failure.state.failureReason==='grasp-exhausted'?'Grasp retry budget exhausted':'Step budget exhausted');}
 $('export').disabled=false;
}
$('export').onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='BrainSNN_toy_grid_scorecard.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const content={
 compute:'<div class="modal-label">THE PLANNED CLOUD WORKFLOW</div><h2>Scale with a clear spending limit.</h2><ol><li>Measure a small batch with your exact scene and model.</li><li>Review the estimate and set a spending ceiling.</li><li>Run versioned batches on available workers.</li><li>Save results and failure replays, then release workers.</li></ol><p>100,000 means total episodes across a campaign. The number of active environments and model replicas is a separate choice.</p><p>Vast, Runpod, or another provider could supply compute. Loading, idle time, storage and external model inference can add cost. This prototype makes no cloud purchase.</p>',
 research:'<div class="modal-label">BRAINSNN ARENA</div><h2>Find a brain. Test the match.</h2><p>Start with one mission. Watch a compatible agent make decisions in a changing 3D scene. Inspect the result and save the evidence.</p><h3>Where the product goes next</h3><p>Matched physics and model adapters, repeatable evaluation suites, private campaigns, and supervised physical robot tests. An adaptive failure finder could select useful challenges from previous outcomes; that research advantage still needs to be demonstrated.</p><h3>Try it here</h3><p><b>Explore:</b> Robot and model discovery, comparison, saved items and draft test plans. Saved items stay on this browser.<br><b>Arena:</b> Interactive practice, fixed policy-camera views, interventions, replay and branches. Connect a matched worker to execute a named robot policy and inspect its real sensor frames.<br><b>Evaluation packs:</b> a ten-episode operator runner, imported campaign reports and larger draft plans with measured-pilot estimates. A separate toy-grid comparison remains available.</p><p>Space runs or pauses. R resets. T toggles the movement trail. Use the camera controls or drag the scene to explore.</p><p><a href="https://www.brainsnn.com/" target="_blank" rel="noopener">Explore the original BrainSNN research playground ↗</a></p>'
};
document.querySelectorAll('[data-modal]').forEach(b=>{if(content[b.dataset.modal])b.onclick=()=>{window.BrainSNN3DClient?.pause?.();$('modal-content').innerHTML=content[b.dataset.modal];$('modal').showModal();};});
window.addEventListener('pagehide',()=>{if(worker)worker.terminate();clearTimeout(toastTimer);});

})();
