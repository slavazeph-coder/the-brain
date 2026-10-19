import { MAX_FILE_BYTES, STRIDE, parseVisualAsset } from './visual-geometry.mjs';
import { createVisualViewer } from './visual-viewer.mjs';
import { createMeshViewer } from './mesh-viewer.mjs';

const $ = id => document.getElementById(id);
const status = message => { $('viewer-status').textContent = message; };
let viewer = null, meshViewer = null, meshPromise = null, epoch = 0, currentKind = 'points', disposed = false;
try { viewer = createVisualViewer($('asset-canvas'), status); }
catch (error) { status(error.message); $('asset').disabled = true; }

function loaded(value) { for (const id of ['frame', 'flip']) $(id).disabled = !value; $('point-size').disabled = !value || currentKind === 'mesh'; }
function show(kind) { currentKind = kind; $('asset-canvas').parentElement.hidden = kind === 'mesh'; $('mesh-stage').hidden = kind !== 'mesh'; }
$('asset').onchange = async () => {
  const file = $('asset').files[0], token = ++epoch;
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
$('remove').onclick = () => { epoch++; viewer?.clear(); meshViewer?.clear(); $('asset').value = ''; loaded(false); status('Asset cleared from this viewer.'); };
window.addEventListener('pagehide', () => { disposed = true; epoch++; viewer?.destroy(); meshViewer?.destroy(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
