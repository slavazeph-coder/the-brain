import { MAX_FILE_BYTES, STRIDE, parseVisualAsset } from './visual-geometry.mjs';
import { createVisualViewer } from './visual-viewer.mjs';
import { createMeshViewer } from './mesh-viewer.mjs';
import { mountCameraTour } from './camera-tour-ui.mjs';
import { mountObjectify } from './objectify-ui.mjs';
import {mountPortableObject} from './portable-object-ui.mjs';
import {mountScanExamples, practiceRoomView, sendScanSelection} from './scan-examples.mjs';
import {mountSplatLamp} from './splat-lamp.mjs';

const $ = id => document.getElementById(id);
const status = message => { $('viewer-status').textContent = message; };
let viewer = null, meshViewer = null, meshPromise = null, epoch = 0, currentKind = 'points', disposed = false;
let surfaceReport = null, meshSource = null, lamp = null;
let displayFlipped = false;
let baseAppearance = null, objectCount = 0, objectInteraction = false, variantEpoch = 0, stagedVariant = null, tourKey = null;
const tour = mountCameraTour({ root: $('camera-tour'), getViewer: () => currentKind === 'mesh' ? meshViewer : viewer });
function bindTour(source, transform = 'identity', placement = 'identity', translation = [0, 0, 0], origin = 'unknown') {
  const key = source ? JSON.stringify([source, transform, placement, translation, origin]) : null;
  if (key === tourKey) return;
  tourKey = key; tour.setSource(source, transform, placement, translation, origin);
}
function cameraHint() {
  const el = $('object-camera-binding'); el.hidden = !baseAppearance;
  if (!baseAppearance) return;
  el.textContent = stagedVariant ? `Camera studio is bound to ${stagedVariant.composite ? 'the authored composite' : 'the authored variant'} ${stagedVariant.name}, SHA-256 ${stagedVariant.sha256.slice(0, 16)}….`
    : objectCount || objectInteraction ? 'Object selection or editing clears camera paths and recordings. Prepare an authored variant to record the exact edited appearance.'
      : 'Camera studio uses the original asset. Object edits create separate, explicitly authored variants.';
}
function rawTour() {
  if (baseAppearance && !objectCount && !objectInteraction) {
    bindTour(baseAppearance.source, displayFlipped ? 'flip-y-z' : 'identity', 'identity', [0,0,0], baseAppearance.origin);
  }
  cameraHint();
}
function displayAppearance(points, kind, view) {
  viewer.setPoints(points, {kind});
  lamp?.setAsset(kind);
  if (view) viewer.setView(view);
}
function showOriginalAppearance() {
  if (!baseAppearance) return;
  displayAppearance(displayedPoints(baseAppearance.parsed), baseAppearance.parsed.kind, viewer.getView());
}
function portableDestination() {
  if (!baseAppearance) return null;
  return {...baseAppearance, points:displayedPoints(baseAppearance.parsed), displayTransform:displayFlipped ? 'flip-y-z' : 'identity'};
}
async function stageAppearance({buffer, name, artifact}, composite = false, isCurrent = () => true) {
  if (!baseAppearance || disposed) throw Error('Open an appearance asset first.');
  const token = ++variantEpoch, sourceEpoch = epoch;
  const parsed = parseVisualAsset(buffer, name);
  const source = await sourceFor(new File([buffer], name), buffer);
  if (token !== variantEpoch || sourceEpoch !== epoch || disposed || !isCurrent()) {
    throw Error('The source or edits changed during preparation.');
  }
  if (source.sha256 !== artifact.sha256 || source.bytes !== artifact.bytes) throw Error('The PLY does not match its receipt.');
  displayAppearance(parsed.points, parsed.kind, viewer.getView());
  stagedVariant = {...source, composite};
  objectInteraction = false;
  bindTour(source, 'identity', 'identity', [0,0,0], 'authored');
  cameraHint();
  return {source};
}
const portable = mountPortableObject({
  root:$('portable-object-panel'),
  getDestination() {
    if (objectCount || objectInteraction) throw Error('Reset the destination’s object edits and selection before placing a portable object.');
    return portableDestination();
  },
  onStage(next, isCurrent) {
    if (objectCount || objectInteraction) throw Error('The destination scan is being edited.');
    return stageAppearance({...next, artifact:next.receipt.artifact}, true, isCurrent);
  },
  onRestore() {
    if (!stagedVariant?.composite) return;
    variantEpoch++;
    showOriginalAppearance();
    stagedVariant = null;
    rawTour();
  },
});
const objectify = mountObjectify({ root: $('objectify-panel'), getViewer: () => viewer,
  onSelectionStart: () => lamp?.cancelPlacement(),
  onRepair: window.frameElement?.id === 'scan-workshop-frame'
    ? (selection, isCurrent) => baseAppearance && sendScanSelection(baseAppearance.file, selection, isCurrent)
    : undefined,
  onPortable(value) {
    const sourceEpoch = epoch, editEpoch = variantEpoch;
    return portable.capture(value, () => sourceEpoch === epoch && editEpoch === variantEpoch && !disposed);
  },
  onInteraction({active = true} = {}) {
    if (!baseAppearance) return;
    if (stagedVariant && !objectCount) {
      showOriginalAppearance();
    }
    portable.cancel();
    variantEpoch++; stagedVariant = null; objectInteraction = active; bindTour(null); rawTour();
  },
  onDisplayChange({points, kind, changed, revision, objectCount: count = 0}) {
    if (!baseAppearance || disposed) return;
    portable.cancel();
    variantEpoch++; stagedVariant = null; objectCount = count; bindTour(null);
    const view = viewer.getView();
    if (points.length) displayAppearance(points, kind, view);
    else { lamp?.clear(); viewer.clear(); }
    $('flip').disabled = objectCount > 0;
    $('room-switch-help').hidden = objectCount === 0;
    rawTour();
  },
  onStage({buffer, name, receipt}) {
    return stageAppearance({buffer, name, artifact:receipt.variantArtifact});
  },
});
function clearAppearance() {
  variantEpoch++; baseAppearance = null; objectCount = 0; objectInteraction = false; stagedVariant = null;
  $('portable-object-panel').hidden = true;
  $('room-switch-help').hidden = true;
  portable.setDestination(null);
  lamp?.clear();
  objectify.clear(); cameraHint();
}
function displayedPoints(parsed) {
  const points = parsed.points.slice();
  if (displayFlipped) for (let i = 0; i < points.length; i += STRIDE) {
    points[i+1] *= -1; points[i+2] *= -1;
    const x=points[i+10],y=points[i+11],z=points[i+12],w=points[i+13];
    points[i+10]=w; points[i+11]=-z; points[i+12]=y; points[i+13]=-x;
  }
  return points;
}
async function openObjectify(token) {
  if (!baseAppearance) return;
  const {source, parsed} = baseAppearance;
  await objectify.setSource({...parsed, source, points:displayedPoints(parsed),
    displayTransform:displayFlipped ? 'flip-y-z' : 'identity', parserVersion:parsed.parserMetadata.version});
  if (token !== epoch || disposed) return;
  rawTour();
}
async function sourceFor(file, buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer || await file.arrayBuffer());
  return { name: file.name, bytes: file.size, sha256: Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('') };
}
function clearInspection() {
  surfaceReport=null; meshSource=null; $('surface-mode').value='original'; $('stripe-frequency').value='18';
  $('surface-panel').hidden=true; $('surface-download').disabled=true;
  $('surface-status').textContent='Inspect the original mesh locally. No geometry is smoothed or repaired.';
}
try {
  viewer = createVisualViewer($('asset-canvas'), status);
  lamp = mountSplatLamp({root:$('splat-appearance-lamp'), viewer, onActiveChange:active => tour.setPreviewBlocked(active),
    onPlacementStart: () => objectify.cancelSelectionTool()});
}
catch (error) { status(error.message); $('asset').disabled = true; }

function loaded(value) { for (const id of ['frame', 'flip']) $(id).disabled = !value; $('point-size').disabled = !value || currentKind === 'mesh'; }
function show(kind) { currentKind = kind; $('asset-canvas').parentElement.hidden = kind === 'mesh'; $('mesh-stage').hidden = kind !== 'mesh'; }
async function openAsset(file, origin = 'unknown') {
  const token = ++epoch;
  bindTour(null); clearAppearance(); displayFlipped = false;
  clearInspection();
  loaded(false); viewer?.clear(); meshViewer?.clear();
  if (!file) { status('Choose a local visual asset.'); return; }
  const ext = file.name.toLowerCase().split('.').pop();
  if (!file.size || file.size > (ext === 'glb' ? 50 * 1024**2 : MAX_FILE_BYTES)) { status('Use a non-empty .ply / .splat up to 64 MiB, or .glb up to 50 MiB.'); return; }
  status('Opening the visual asset locally…');
  try {
    if (ext === 'glb') {
      show('mesh');
      if (!meshViewer) {
        meshPromise ||= createMeshViewer($('mesh-stage'), status).catch(error => { meshPromise = null; throw error; });
        meshViewer = await meshPromise;
      }
      if (disposed) { meshViewer.destroy(); return; }
      if (token !== epoch) return;
      const parsed = await meshViewer.setFile(file);
      if (token !== epoch) return;
      const source=await sourceFor(file);
      if (token !== epoch) return;
      meshSource=source;
      bindTour(source, 'identity', 'bbox-min-origin', parsed.sourceTranslation);
      $('surface-panel').hidden=false;
      loaded(true);
      $('viewer-help').textContent = 'Drag to orbit · pinch or scroll to zoom · two-finger drag or right-drag to pan · Reset view or 0 to frame the asset.';
      status(`${file.name} · GLB visual mesh · ${parsed.vertices.toLocaleString()} vertices. Scale unverified; no collision geometry.`);
      return;
    }
    show('points');
    const buffer = await file.arrayBuffer();
    if (token !== epoch) return;
    const parsed = parseVisualAsset(buffer, file.name);
    const source = await sourceFor(file, buffer);
    if (token !== epoch) return;
    displayAppearance(parsed.points, parsed.kind, origin === 'authored' ? practiceRoomView(viewer.getCanvas()) : null);
    baseAppearance = {source, parsed, origin, file};
    await openObjectify(token);
    if (token !== epoch) return;
    portable.setDestination(portableDestination());
    $('portable-object-panel').hidden = false;
    loaded(true);
    $('viewer-help').textContent = 'Drag to orbit · pinch or scroll to zoom · two-finger drag or Shift-drag to pan · WASD / arrow keys to move, + / − to zoom, 0 to reset.';
    if (origin === 'authored') {
      status(file.name === 'authored-reading-room.ply'
        ? 'Reading room ready. Choose Tap an object, then tap the coral chair.'
        : 'Empty studio ready. Open Place an object from another scan to bring something in.');
      return;
    }
    const representation = parsed.kind === 'point-cloud' ? 'Point cloud · not a trained Gaussian splat' : 'Gaussian parameters · DC colour preview';
    status(`${file.name} · ${representation} · ${Math.round(parsed.points.length / STRIDE).toLocaleString()} visible points${parsed.sampled ? ` sampled from ${parsed.total.toLocaleString()}` : ''}${parsed.skipped ? ` · ${parsed.skipped} invalid samples omitted` : ''}. Scale unverified; no collision geometry.`);
  } catch (error) { if (token === epoch) status(`Asset could not be opened: ${error.message}`); }
}
$('asset').onchange = () => openAsset($('asset').files[0]);
if (viewer) mountScanExamples({openAsset, input:$('asset')});
else document.querySelectorAll('[data-scan-example]').forEach(button => { button.disabled = true; });
$('frame').onclick = () => { tour.cancel(); (currentKind === 'mesh' ? meshViewer : viewer)?.reset(); };
$('flip').onclick = async () => {
  if (objectCount) { status('Reset object edits before changing the display axis.'); return; }
  displayFlipped = !displayFlipped;
  if (currentKind === 'mesh') { tour.invalidate(displayFlipped ? 'flip-y-z' : 'identity'); meshViewer?.flip(); return; }
  if (!baseAppearance) return;
  const token = ++epoch; variantEpoch++; stagedVariant = null; objectInteraction = false; bindTour(null); loaded(false);
  displayAppearance(displayedPoints(baseAppearance.parsed), baseAppearance.parsed.kind);
  portable.setDestination(portableDestination());
  try { await openObjectify(token); if (token === epoch) loaded(true); }
  catch (error) { if (token === epoch) status(`Object workshop could not open this orientation: ${error.message}`); }
};
$('point-size').oninput = () => { tour.cancel(); viewer?.setSize(Number($('point-size').value)); };
$('surface-mode').onchange=$('stripe-frequency').oninput=()=>{
  tour.cancel();
  try{meshViewer?.surfaceMode($('surface-mode').value,Number($('stripe-frequency').value));}
  catch(error){$('surface-mode').value='original';$('surface-status').textContent=error.message;}
};
$('surface-check').onclick=()=>{
  surfaceReport=null; $('surface-download').disabled=true;
  if(!meshSource)return;
  try{
    surfaceReport={...meshViewer.surfaceAudit(),source:{...meshSource},sourceGeometryChanged:false};
    const t=surfaceReport.totals;
    $('surface-status').textContent=`${t.triangles.toLocaleString()} triangles · ${t.boundaryEdges} boundary edges · ${t.nonManifoldEdges} non-manifold edges · ${t.windingConflicts} winding conflicts · ${t.degenerateTriangles} degenerate and ${t.duplicateTriangles} duplicate triangles · ${t.sharpEdges} edges at least ${surfaceReport.sharpDegrees}°. Mesh checks only; scale and physical accuracy unverified.`;
    $('surface-download').disabled=false;
  }catch(error){$('surface-status').textContent=error.message;}
};
$('surface-download').onclick=()=>{
  if(!surfaceReport)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(surfaceReport,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='surface-inspection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('remove').onclick = () => { epoch++; portable.clear(); bindTour(null); clearAppearance(); viewer?.clear(); meshViewer?.clear(); clearInspection(); $('asset').value = ''; loaded(false); status('Asset cleared from this viewer.'); };
window.addEventListener('brainsnn-workshop-suspend', () => { tour.suspend(); lamp?.cancelPlacement?.(); });
window.addEventListener('pagehide', () => { disposed = true; epoch++; variantEpoch++; portable.destroy(); objectify.destroy(); lamp?.dispose(); tour.destroy(); viewer?.destroy(); meshViewer?.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
