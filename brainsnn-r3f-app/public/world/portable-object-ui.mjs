import {frameBounds} from './visual-geometry.mjs';
import {composePortableObject, makePortableObject, MAX_PORTABLE_BYTES, readPortableObject} from './portable-object.mjs';

function download(buffer, filename, type) {
  const url = URL.createObjectURL(new Blob([buffer], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountPortableObject({root, getDestination, onStage, onRestore}) {
  const $ = key => root.querySelector(`[data-portable-${key}]`);
  const picker = $('file');
  const form = $('pose');
  const fields = ['x','y','z','scale','yaw'];
  const showStatus = message => { $('status').textContent = message; };
  let destination = null;
  let object = null;
  let artifact = null;
  let working = false;
  let importing = false;
  let generation = 0, fileGeneration = 0;

  function controls() {
    const hasPair = !!destination && !!object;
    const usable = hasPair && destination.parsed.kind === object.kind && destination.source.sha256 !== object.sourceSha256;
    form.hidden = !hasPair;
    $('place').disabled = !usable || working || importing;
    for (const name of ['ply','receipt','restore']) $(name).disabled = !artifact;
    $('clear').disabled = !object && !picker.files[0] && !importing;
  }

  function defaultPose() {
    if (!destination) return;
    const {center, min} = frameBounds(destination.points);
    const values = [center[0], min[1], center[2], 1, 0];
    fields.forEach((name, i) => { $(name).value = String(values[i]); });
  }

  function readyMessage() {
    if (importing) return 'Opening the portable object…';
    if (artifact) {
      const {used, retainedPreview} = artifact.receipt.destination;
      const thinning = used < retainedPreview ? ` Used ${used.toLocaleString()} destination samples to fit this viewer.` : '';
      return `Placed ${object.name} in this scan. The new appearance is ready to download or record.${thinning}`;
    }
    if (!object) return 'Keep a reviewed object below or choose a saved object file.';
    if (!destination) return `${object.name} is ready. Open its destination scan above.`;
    if (destination.source.sha256 === object.sourceSha256) return `${object.name} is ready. Open a different scan above.`;
    if (destination.parsed.kind !== object.kind) {
      return object.kind === 'gaussian-splat' ? 'Open a Gaussian splat as the destination.' : 'Open a point cloud as the destination.';
    }
    return `${object.name} · ${object.count.toLocaleString()} samples from ${object.sourceName}. Adjust its position and size in this scan.`;
  }

  function invalidate(message, restore = false) {
    const previous = artifact;
    generation++;
    artifact = null;
    working = false;
    if (restore && previous) onRestore();
    showStatus(message ?? readyMessage());
    controls();
  }

  function replaceObject(next) {
    importing = false;
    if (next.sha256 === object?.sha256) {
      showStatus(readyMessage());
      controls();
      return;
    }
    object = next;
    defaultPose();
    invalidate(undefined, true);
  }

  picker.onchange = async () => {
    const token = ++fileGeneration;
    const file = picker.files[0];
    importing = !!file;
    showStatus(readyMessage());
    controls();
    if (!file) return;
    try {
      if (file.size > MAX_PORTABLE_BYTES) throw Error('The portable object file is too large.');
      const next = await readPortableObject(await file.arrayBuffer());
      if (token !== fileGeneration) return;
      replaceObject(next);
    } catch (error) {
      if (token !== fileGeneration) return;
      picker.value = '';
      importing = false;
      const kept = object ? ` Current object: ${object.name}.` : '';
      showStatus(`Object could not be opened. ${error.message}${kept}`);
      controls();
    }
  };

  $('place').onclick = async () => {
    if (!object || working || importing) return;
    const token = ++generation;
    working = true;
    controls();
    showStatus('Preparing the authored placement…');
    try {
      const current = getDestination();
      const [x,y,z,scale,yawDegrees] = fields.map(name => $(name).valueAsNumber);
      const next = await composePortableObject(current, object, {anchor:[x,y,z], scale, yawDegrees});
      if (token !== generation) return;
      await onStage(next, () => token === generation);
      if (token !== generation) return;
      artifact = next;
      showStatus(readyMessage());
    } catch (error) {
      if (token === generation) showStatus(`Placement stopped. ${error.message}`);
    } finally {
      if (token === generation) { working = false; controls(); }
    }
  };

  for (const field of fields) $(field).oninput = () => invalidate(undefined, true);
  $('restore').onclick = () => invalidate('Destination scan restored.', true);
  function clear() {
    fileGeneration++;
    importing = false;
    picker.value = '';
    object = null;
    invalidate(undefined, true);
  }
  $('clear').onclick = clear;
  $('ply').onclick = () => {
    if (artifact) download(artifact.buffer, artifact.name, 'application/octet-stream');
  };
  $('receipt').onclick = () => {
    if (artifact) download(JSON.stringify(artifact.receipt, null, 2) + '\n',
      'appearance-composite-receipt.json', 'application/json');
  };
  controls();
  return {
    async capture({context, document:edits, instanceId, download:save = true}, isCurrent) {
      if (save) {
        const {filename, buffer} = await makePortableObject(context, edits, instanceId);
        if (!isCurrent()) throw Error('The scan changed before the object was ready.');
        download(buffer, filename, 'application/octet-stream');
      } else {
        const token = ++fileGeneration;
        picker.value = '';
        importing = true;
        controls();
        try {
          const {buffer} = await makePortableObject(context, edits, instanceId);
          const next = await readPortableObject(buffer);
          if (token !== fileGeneration || !isCurrent()) throw Error('The selection changed before the object was ready.');
          replaceObject(next);
          root.open = true;
        } finally {
          if (token === fileGeneration && importing) {
            importing = false;
            showStatus(readyMessage());
            controls();
          }
        }
      }
    },
    setDestination(next) {
      destination = next;
      defaultPose();
      invalidate();
    },
    clear,
    cancel: () => invalidate(),
    destroy: () => { fileGeneration++; importing = false; destination = null; object = null; invalidate(); },
  };
}
