import { MAX_FILE_BYTES, STRIDE, parseVisualAsset } from './visual-geometry.mjs';
import { createVisualViewer } from './visual-viewer.mjs';
import { createMeshViewer } from './mesh-viewer.mjs';

const $ = id => document.getElementById(id);
const status = message => { $('viewer-status').textContent = message; };
let viewer = null, meshViewer = null, meshPromise = null, epoch = 0, currentKind = 'points', disposed = false;
let surfaceReport = null, meshSource = null;
function clearInspection() {
  surfaceReport=null; meshSource=null; $('surface-mode').value='original'; $('stripe-frequency').value='18';
  $('surface-panel').hidden=true; $('surface-download').disabled=true;
  $('surface-status').textContent='Inspect the original mesh locally. No geometry is smoothed or repaired.';
}
try { viewer = createVisualViewer($('asset-canvas'), status); }
catch (error) { status(error.message); $('asset').disabled = true; }

function loaded(value) { for (const id of ['frame', 'flip']) $(id).disabled = !value; $('point-size').disabled = !value || currentKind === 'mesh'; }
function show(kind) { currentKind = kind; $('asset-canvas').parentElement.hidden = kind === 'mesh'; $('mesh-stage').hidden = kind !== 'mesh'; }
$('asset').onchange = async () => {
  const file = $('asset').files[0], token = ++epoch;
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
      const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      if (token !== epoch) return;
      meshSource={name:file.name,bytes:file.size,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
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
    viewer.setPoints(parsed.points, { kind: parsed.kind });
    loaded(true);
    $('viewer-help').textContent = 'Drag to orbit · pinch or scroll to zoom · two-finger drag or Shift-drag to pan · WASD / arrow keys to move, + / − to zoom, 0 to reset.';
    const representation = parsed.kind === 'point-cloud' ? 'Point cloud · not a trained Gaussian splat' : 'Gaussian parameters · DC colour preview';
    status(`${file.name} · ${representation} · ${Math.round(parsed.points.length / STRIDE).toLocaleString()} visible points${parsed.sampled ? ` sampled from ${parsed.total.toLocaleString()}` : ''}${parsed.skipped ? ` · ${parsed.skipped} invalid samples omitted` : ''}. Scale unverified; no collision geometry.`);
  } catch (error) { if (token === epoch) status(`Asset could not be opened: ${error.message}`); }
};
$('frame').onclick = () => (currentKind === 'mesh' ? meshViewer : viewer)?.reset();
$('flip').onclick = () => (currentKind === 'mesh' ? meshViewer : viewer)?.flip();
$('point-size').oninput = () => viewer?.setSize(Number($('point-size').value));
$('surface-mode').onchange=$('stripe-frequency').oninput=()=>meshViewer?.surfaceMode($('surface-mode').value,Number($('stripe-frequency').value));
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
$('remove').onclick = () => { epoch++; viewer?.clear(); meshViewer?.clear(); clearInspection(); $('asset').value = ''; loaded(false); status('Asset cleared from this viewer.'); };
window.addEventListener('pagehide', () => { disposed = true; epoch++; viewer?.destroy(); meshViewer?.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
