import { kneeFlexion } from './movement-analysis.mjs';
import { analyzeSitToStand, compareVerticalForce } from './movement-trial.mjs';

// Authored 720 × 480 side view. Two complete rises and returns in eight seconds.
// The hip rotates around a fixed knee and shin. The force example is authored independently.
export function trialDemoLandmarks(time) {
  const t = time % 4;
  const ease = x => (1 - Math.cos(Math.PI * x)) / 2;
  const progress = t < .7 ? 0 : t < 1.6 ? ease((t - .7) / .9)
    : t < 2.4 ? 1 : t < 3.3 ? 1 - ease((t - 2.4) / .9) : 0;
  const flexion = 90 - 78 * progress;
  const shin = 99 * Math.PI / 180, thigh = shin - flexion * Math.PI / 180;
  const ankle = {x: .57, y: .86};
  const knee = {x: ankle.x - 119 * Math.cos(shin) / 720, y: ankle.y - 119 * Math.sin(shin) / 480};
  const hip = {x: knee.x - 119 * Math.cos(thigh) / 720, y: knee.y - 119 * Math.sin(thigh) / 480};
  return [hip,knee,ankle];
}

function demoTracking() {
  const frames = Array.from({length:81}, (_,i) => ({
    timeSeconds: i / 10, landmarks: trialDemoLandmarks(i / 10), confidence:null
  }));
  return {side:'left',sampleHz:10, threshold:null,model:null,origin:'synthetic',frames};
}
function demoForce(label, bias) {
  const samples = Array.from({length:81}, (_,i) => {
    const timeSeconds = i / 10;
    return {timeSeconds,verticalForceN:720 + 95 * Math.sin(timeSeconds * Math.PI / 2) + bias};
  });
  return {kind:'synthetic',label,offsetSeconds:0,samples};
}
const $ = id => document.getElementById(id);
const seconds = t => Number(t.toFixed(3)) + ' s';
const evidenceName = {manual:'Manual', model:'Model', synthetic:'Synthetic'};
const timeTolerance = .001;

export function mountTrial({getSource,getVideoUrl,seek,redraw,openDemo,sideChanged,forceRemoved}) {
  let source = null, manual = [], tracking = null, comparison = null, busy = null;
  let previewFrames = [], validTracked = [], analysis = null, setup = null;
  let forces = {measured:null,modelled:null};
  const runsBySide = new Map();
  const side = () => $('trial-side').value;
  const interval = (startId,endId) => {
    const startSeconds = $(startId).valueAsNumber, endSeconds = $(endId).valueAsNumber;
    if (!source || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
        startSeconds < 0 || endSeconds > source.durationSeconds + 1e-8 || endSeconds <= startSeconds) return null;
    return {startSeconds,endSeconds};
  };
  const windowRange = () => interval('trial-start','trial-end');
  const forceRange = () => interval('trial-force-start','trial-force-end');
  const notice = text => { $('trial-status').textContent = text; };
  const isDemo = () => source?.trialDemo === true;
  function stopTracking() {
    busy?.abort();
    busy = null;
    $('trial-cancel').hidden = true;
  }
  function updateRun() {
    const range = windowRange();
    $('trial-run').disabled = !range || source.kind !== 'video' || busy !== null || range.endSeconds - range.startSeconds > 60;
    $('trial-run').hidden = source?.kind !== 'video';
    $('trial-cancel').hidden = busy === null;
  }
  function setSource(next) {
    stopTracking();
    source = next; manual = []; tracking = null; comparison = null; setup = null; runsBySide.clear();
    previewFrames = []; validTracked = []; analysis = null;
    forces = {measured:null, modelled:null};
    $('trial-side').value = 'left';
    $('trial-side').disabled = isDemo();
    $('trial-contact').value = '';
    const end = Math.min(next?.durationSeconds || 0, 60);
    for (const prefix of ['trial-', 'trial-force-']) {
      $(prefix + 'start').value = '0';
      $(prefix + 'end').value = String(end);
      $(prefix + 'end').max = $(prefix+'start').max = String(next?.durationSeconds || 0);
    }
    if (isDemo()) {
      tracking = demoTracking();
      forces = {measured:demoForce('Authored reference waveform',0), modelled:demoForce('Authored estimate waveform',12)};
      $('trial-contact').value = 'all-contacts';
      notice('Synthetic example with two rises and authored forces. No camera or force plate was used.');
    } else {
      notice(next?.kind === 'video' ? 'Select the visible leg. Tracking runs on this device at 5 samples per second for up to 60 seconds.'
        : 'Open a local video or the sit-to-stand demo to review a trial.');
    }
    refresh();
    updateForcePanel();
    if (isDemo()) compare();
  }
  function setObservations(newManual) {
    manual = newManual;
    if (source) refresh();
  }
  function mergeSamples(range) {
    if (!range) return [];
    const within = t => t >= range.startSeconds - 1e-8 && t <= range.endSeconds + 1e-8;
    const raw = (tracking?.frames || []).filter(f=>within(f.timeSeconds));
    const current = manual.filter(f => f.side === side() && within(f.timeSeconds)).map(f => ({
      timeSeconds:f.timeSeconds, landmarks:f.landmarks, confidence:null, origin:source.kind === 'synthetic' ? 'synthetic' : 'manual', reviewed:true
    })).sort((a,b)=>a.timeSeconds-b.timeSeconds);
    const merged = [];
    let j = 0;
    for (const f of raw) {
      while (j < current.length && current[j].timeSeconds < f.timeSeconds - timeTolerance) merged.push(current[j++]);
      if (j < current.length && Math.abs(current[j].timeSeconds-f.timeSeconds) <= timeTolerance) {
        merged.push(current[j++]);
      } else merged.push({...f, origin:isDemo() ? 'synthetic' : 'model', reviewed:false});
    }
    merged.push(...current.slice(j));
    return merged.map(f => {
      let kneeFlexionDegrees = null;
      if (f.landmarks) {
        try { kneeFlexionDegrees = kneeFlexion(f.landmarks, source.width, source.height); }
        catch { /* Invalid or coincident points are recorded as a missing angle. */ }
      }
      return {...f,kneeFlexionDegrees};
    });
  }
  function sampleLabel(frame) {
    if (!frame) return '';
    const a = frame.kneeFlexionDegrees === null ? 'no usable landmarks' : frame.kneeFlexionDegrees.toFixed(1) + '°';
    const score = Number.isFinite(frame.confidence) ? ' · confidence '+frame.confidence.toFixed(2) : '';
    const low = frame.origin === 'model' && frame.confidence < analysis?.thresholds.minConfidence && frame.landmarks
      ? ' · below counting threshold' : '';
    return seconds(frame.timeSeconds)+' · '+evidenceName[frame.origin]+(frame.reviewed ? ' (reviewed)' : '')+' · '+a+score+low;
  }
  function refresh() {
    const range = windowRange();
    previewFrames = mergeSamples(range);
    const samples = previewFrames.map(f => ({
      timeSeconds:f.timeSeconds,kneeFlexionDegrees:f.kneeFlexionDegrees,
      ...(f.origin === 'model' && f.landmarks && Number.isFinite(f.confidence) ? {confidence:f.confidence} : {})
    }));
    analysis = samples.length ? analyzeSitToStand(samples) : null;
    validTracked = previewFrames.filter(f => f.origin !== 'manual' && f.kneeFlexionDegrees !== null &&
      (!Number.isFinite(f.confidence) || f.confidence >= analysis.thresholds.minConfidence));
    const reps = analysis?.repetitions || [];
    $('trial-results').hidden = !previewFrames.length;
    $('trial-export').disabled = !source || !range || (!previewFrames.length && !comparison);
    $('trial-count').textContent = String(reps.length);
    $('trial-coverage').textContent = (analysis?.validFrames || 0)+' / '+previewFrames.length;
    $('trial-reps').replaceChildren(...reps.map((rep,i) => {
      const row = document.createElement('li'), span = document.createElement('span'), button = document.createElement('button');
      span.textContent = 'Rise '+(i+1)+' · '+seconds(rep.startSeconds)+' to '+seconds(rep.standSeconds)+' · '+rep.excursionDegrees.toFixed(1)+'° change';
      button.type='button'; button.textContent = 'View rise '+(i+1);
      button.onclick = () => inspectNearest(rep.startSeconds,true);
      row.append(span,button); return row;
    }));
    if (analysis) {
      const t = analysis.thresholds;
      $('trial-method').textContent = `A candidate moves from at least ${t.seatedDegrees}° knee bend to at most ${t.standingDegrees}°, with a ${t.minHoldSeconds} s hold in each zone. Minimum rise time is ${t.minRiseSeconds} s. Samples below ${t.minConfidence} confidence and gaps over ${t.maxGapSeconds} s interrupt a candidate. An angle alone cannot establish chair contact or seat-off.`;
    }
    $('trial-scrubber').hidden = !previewFrames.length;
    $('trial-frame').disabled = previewFrames.length <= 1;
    $('trial-frame').max = String(Math.max(0,previewFrames.length-1));
    const index = Math.min(Number($('trial-frame').value),previewFrames.length-1);
    $('trial-sample').textContent = sampleLabel(previewFrames[index]);
    updateRun();
    redraw();
  }
  function inspectNearest(t, jump = false) {
    if (!previewFrames.length) return null;
    let lo=0,hi=previewFrames.length-1;
    while (lo<hi) {
      const mid = Math.floor((lo+hi)/2);
      if (previewFrames[mid].timeSeconds < t) lo=mid+1; else hi=mid;
    }
    const i = lo>0 && t - previewFrames[lo-1].timeSeconds < previewFrames[lo].timeSeconds - t ? lo-1 : lo;
    const f = previewFrames[i];
    if (jump) { $('trial-frame').value=String(i); $('trial-sample').textContent=sampleLabel(f); seek(f.timeSeconds); }
    return f;
  }
  function nearestAt(t) {
    const range = windowRange();
    if (!source || !range || t < range.startSeconds || t > range.endSeconds) return null;
    const f = inspectNearest(t);
    if (!f || !f.landmarks || f.kneeFlexionDegrees === null || Math.abs(f.timeSeconds-t) > .5/(tracking?.sampleHz || 5) + 1e-6) return null;
    return f;
  }
  function invalidateComparison() {
    comparison=null; setup=null;
    $('trial-errors').hidden=true;
    $('trial-export').disabled=!source || !windowRange() || !previewFrames.length;
  }
  function updateForcePanel() {
    invalidateComparison();
    for (const [slot,title] of [['measured','Reference'],['modelled','Estimate']]) {
      const trace=forces[slot];
      $('trial-'+slot).textContent = trace ? title+' · '+trace.label+' · '+trace.samples.length+' samples · offset '+seconds(trace.offsetSeconds) : title+' trace pending';
      $('trial-clear-'+slot).hidden=!trace || isDemo();
    }
    $('trial-compare').disabled=!forces.measured || !forces.modelled;
    $('trial-force-status').textContent = forces.measured && forces.modelled ? 'Confirm the contact setup and interval for this comparison.' : 'Apply an instrument reference and a separate model estimate to compare.';
  }
  function acceptForce(trace) {
    if (source?.kind!=='video' || !['modelled','measured'].includes(trace?.kind)) return;
    forces[trace.kind]=trace;
    updateForcePanel();
  }
  function removeForce(kind) {
    if (!['modelled','measured'].includes(kind) || isDemo()) return;
    const removed = forces[kind];
    forces[kind]=null;
    if (removed) forceRemoved?.(removed);
    updateForcePanel();
  }
  function compare() {
    invalidateComparison();
    const basis=$('trial-contact').value, range=forceRange(), scope=windowRange();
    if (!scope || !range || range.startSeconds<scope.startSeconds || range.endSeconds>scope.endSeconds) {
      $('trial-force-status').textContent='Set a positive comparison interval inside the current trial.'; return;
    }
    if (!basis || !forces.measured || !forces.modelled) {
      $('trial-force-status').textContent='Select a matched contact setup, a force reference and a model estimate.'; return;
    }
    try {
      const result=compareVerticalForce(forces.modelled,forces.measured,{...range,synthetic:isDemo()});
      comparison=result; setup={contactBasis:basis,comparisonWindow:range};
      $('trial-export').disabled=false;
      if (result.status==='no-overlap') { $('trial-force-status').textContent='No shared time coverage in this interval. Check both source clocks and offsets.'; return; }
      $('trial-force-status').textContent=(isDemo()?'Synthetic comparison. ':'')+'Compared '+seconds(result.durationSeconds)+' of shared data ('+seconds(result.startSeconds)+' to '+seconds(result.endSeconds)+').';
      $('trial-mae').textContent=result.maeN.toFixed(2)+' N';
      $('trial-rmse').textContent=result.rmseN.toFixed(2)+' N';
      $('trial-bias').textContent=result.biasN.toFixed(2)+' N';
      $('trial-errors').hidden=false;
      $('trial-export').disabled=false;
    } catch (e) { $('trial-force-status').textContent=e.message; }
  }
  for (const key of ['trial-contact','trial-force-start','trial-force-end']) {
    $(key).addEventListener('input',updateForcePanel);
  }
  for (const key of ['trial-side','trial-start','trial-end']) {
    $(key).addEventListener('input',()=>{
      stopTracking();
      if (key === 'trial-side') sideChanged?.();
      else runsBySide.clear();
      tracking=isDemo()?demoTracking():runsBySide.get(side()) || null;
      refresh(); updateForcePanel();
      const r=windowRange();
      notice(!r ? 'Enter a positive interval inside the source video.' : r.endSeconds-r.startSeconds>60 ?
        'Choose up to 60 seconds for automatic tracking.' : 'Trial selection changed. Review saved points or run tracking for this interval.');
    });
  }
  $('trial-frame').addEventListener('input',()=>{
    const f=previewFrames[Number($('trial-frame').value)];
    if (f) { $('trial-sample').textContent=sampleLabel(f); seek(f.timeSeconds); }
  });
  $('trial-run').addEventListener('click',async()=>{
    const r=windowRange(), url=getVideoUrl(), active=source;
    if (!active || active.kind!=='video'|| !r || r.endSeconds-r.startSeconds>60 || !url || busy) return;
    const controller=new AbortController();
    busy=controller; updateRun();
    notice('Loading the pose model. Your clip stays on this device.');
    try {
      const {trackSitToStand}=await import('./sit-to-stand-pose.mjs');
      if (controller.signal.aborted) return;
      const result=await trackSitToStand(url,{side:side(),...r,signal:controller.signal,onProgress:({completed,total})=>{
        if (busy===controller) notice('Tracking '+completed+' of '+total+' samples…');
      }});
      if (busy!==controller || source!==active || getSource()!==active) return;
      tracking={...result,origin:'model'};
      runsBySide.set(side(), tracking);
      refresh();
      notice('Pose tracking complete. Inspect the landmarks and correct misplaced points before using the trial.');
    } catch (e) {
      if (busy===controller && !controller.signal.aborted) notice('Tracking could not finish. '+e.message+' You can still mark frames manually.');
    } finally {
      if (busy===controller) {busy=null;updateRun();}
    }
  });
  $('trial-cancel').onclick=()=>{stopTracking();updateRun();notice('Tracking cancelled.');};
  $('trial-compare').onclick=compare;
  for (const slot of ['measured','modelled']) $('trial-clear-'+slot).onclick=()=>removeForce(slot);
  $('trial-demo').onclick=()=>{ openDemo(); $('sit-to-stand').scrollIntoView({block:'start'}); };
  $('trial-export').onclick=()=>{
    const range=windowRange();
    if (!source || !range || (!analysis && !comparison)) return;
    const data={schema:'brainsnn.sit-to-stand-trial.v1',source:{...source},side:side(),window:range,
      tracking:tracking?{model:tracking.model,origin:tracking.origin,sampleHz:tracking.sampleHz,threshold:tracking.threshold,
        samples:tracking.frames.filter(f=>f.timeSeconds>=range.startSeconds && f.timeSeconds<=range.endSeconds)}:null,
      observations:previewFrames,repetitions:analysis,forceInputs:{...forces},forceComparison:comparison,
      comparisonWindow:setup?.comparisonWindow || null,contactBasis:setup?.contactBasis || null,
      limitations:['Candidate rises follow projected knee-angle thresholds. An angle cannot verify seat-off.',
        'Force provenance and synchronization come from the reviewer. Force comparison requires matching external contacts.']};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a'); a.href=url;a.download='brainsnn-sit-to-stand-trial.json';
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
  };
  return {resetSource:setSource,setObservations,side,nearestAt,poseFrames:()=>validTracked,acceptForce,removeForce};
}
