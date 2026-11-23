import {
  createObjectifyContext, getObjectifyBase, createObjectDocument, addObject, updateObject, duplicateObject, removeObject,
  composeObjectDocument, resetObjectDocument, serializeObjectDocument, parseObjectDocument,
  seededObjectVariants, exportObjectVariant,
} from './objectify-core.mjs';
import { suggestObjectRegion } from './objectify-region.mjs';
import { STRIDE } from './visual-geometry.mjs';

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => Number(value).toLocaleString('en', { maximumFractionDigits: 4 });
const dimensions = box => box ? box.size.map(number).join(' × ') + ' local units' : 'No visible bounds';
const extent = box => box ? `min [${box.min.map(number).join(', ')}] · max [${box.max.map(number).join(', ')}]` : '';

/** Authored appearance edits only. The original asset, metric evidence and collision maps are never rewritten. */
export function mountObjectify({ root, getViewer, onDisplayChange, onStage, onInteraction, onStatus, onPortable, onRepair, onSelectionStart } = {}) {
  if (!root) throw Error('An object workshop container is required.');
  root.classList.add('objectify');
  root.innerHTML = `
    <div class="objectify-heading"><h3>Object workshop</h3></div>
    <p class="objectify-intro">Choose something in the room. Then you can move it, turn it or make a copy.</p>
    <p class="objectify-source" data-objectify-source></p>
    <div class="objectify-workspace">
      <section class="objectify-selection" aria-labelledby="objectify-select-title">
        <h4 id="objectify-select-title">Pick an object</h4>
        <div class="objectify-toolbar"><button type="button" class="primary" data-objectify-suggest aria-pressed="false">Tap an object</button><button type="button" data-objectify-select aria-pressed="false">Draw a box</button><label>Selection action<select data-objectify-mode><option value="replace">Start a new selection</option><option value="add">Add points</option><option value="subtract">Remove points</option></select></label><button type="button" data-objectify-clear-selection>Clear selection</button></div>
        <p class="objectify-help">Tap a visible part and see what turns yellow. Turn the view to check the edges. A box adds or removes points through all depths.</p>
        <div class="objectify-fields objectify-height"><label>Lowest Y · local units<input type="number" step="any" data-objectify-min-y></label><label>Highest Y · local units<input type="number" step="any" data-objectify-max-y></label></div>
        <p class="objectify-selection-count" data-objectify-selection>No samples selected.</p>
        <label>Object name<input type="text" maxlength="120" placeholder="Chair 01" data-objectify-name></label>
        <label class="objectify-check"><input type="checkbox" data-objectify-reviewed><span>I checked which parts are highlighted.</span></label>
        <button type="button" class="primary" data-objectify-create>Keep object selection</button>
      </section>
      <section class="objectify-editor" aria-labelledby="objectify-edit-title">
        <p class="objectify-step">02 / ARRANGE</p><h4 id="objectify-edit-title">Work with independent objects</h4>
        <div class="objectify-list" data-objectify-list aria-label="Appearance objects"></div>
        <p class="objectify-empty" data-objectify-empty>Keep a selection to create your first object. Nothing has been extracted yet.</p>
        <div data-objectify-edit hidden>
          <p class="objectify-object-facts" data-objectify-facts></p>
          <label>Display name<input type="text" maxlength="120" data-objectify-edit-name></label>
          <label class="objectify-check"><input type="checkbox" data-objectify-edit-reviewed><span>Selection boundaries reviewed by the operator</span></label>
          <button type="button" data-objectify-save-review>Save name and review</button>
          <div class="objectify-fields objectify-pose"><label>Move X<input type="number" step="any" value="0" data-objectify-tx></label><label>Move Y<input type="number" step="any" value="0" data-objectify-ty></label><label>Move Z<input type="number" step="any" value="0" data-objectify-tz></label><label>Turn · degrees<input type="number" step="any" value="0" data-objectify-yaw></label></div>
          <label class="objectify-check"><input type="checkbox" data-objectify-hidden><span>Hide this instance</span></label>
          <div class="objectify-toolbar"><button type="button" class="primary" data-objectify-apply>Apply pose</button><button type="button" data-objectify-duplicate>Make a copy</button><button type="button" data-objectify-revert>Reset this pose</button><button type="button" data-objectify-remove>Remove object group</button></div>
          <div class="objectify-toolbar" ${onPortable || onRepair ? '' : 'hidden'}>
            ${typeof onPortable === 'function' ? '<button type="button" data-objectify-keep-portable>Keep for another room</button><button type="button" data-objectify-portable>Download this object</button>' : ''}
            ${typeof onRepair === 'function' ? '<button type="button" data-objectify-repair>Use selection in scan repair</button>' : ''}
          </div>
          <p class="objectify-help">Moves use local asset units. Review the selection before transforming it. Copied objects are authored additions. Exposed background remains unknown; no missing surfaces are generated.</p>
        </div>
      </section>
    </div>
    <details class="objectify-variants"><summary>03 / Reproducible layout variations</summary><p>Generate bounded pose variations from the current reviewed objects. These are authored test layouts. Overlaps, collision behaviour and physical properties are not validated.</p>
      <div class="objectify-fields objectify-variant-controls"><label>Seed<input type="number" min="0" max="4294967295" step="1" value="1" data-objectify-seed></label><label>Variants<input type="number" min="1" max="16" step="1" value="4" data-objectify-count></label><label>± X · local units<input type="number" min="0" step="any" value="0.25" data-objectify-range-x></label><label>± Y · local units<input type="number" min="0" step="any" value="0" data-objectify-range-y></label><label>± Z · local units<input type="number" min="0" step="any" value="0.25" data-objectify-range-z></label><label>± Turn · degrees<input type="number" min="0" max="180" step="any" value="15" data-objectify-range-yaw></label></div>
      <div class="objectify-toolbar"><button type="button" data-objectify-generate>Generate variations</button><label>Preview layout<select data-objectify-variant><option value="-1">Baseline edits</option></select></label></div>
    </details>
    <section class="objectify-exports" aria-labelledby="objectify-export-title"><div><p class="objectify-step">04 / KEEP THE EVIDENCE</p><h4 id="objectify-export-title">Export an authored variant</h4><p>Save the edit document to reopen it with this exact source. Preparing a PLY creates a separate appearance asset and source-bound receipt. Proposed box proxies are estimates, not approved BIM or collision geometry.</p></div>
      <div class="objectify-toolbar"><button type="button" data-objectify-export>Download edit document</button><label>Reopen matching edits<input type="file" accept=".json,application/json" data-objectify-import></label><button type="button" data-objectify-reset>Restore original preview</button></div>
      <div class="objectify-toolbar"><button type="button" class="primary" data-objectify-prepare>Prepare derived PLY</button><button type="button" data-objectify-save-ply>Download derived PLY</button><button type="button" data-objectify-save-receipt>Download variant receipt</button><button type="button" data-objectify-stage>Use variant in camera studio</button></div>
      <p class="objectify-prepared" data-objectify-prepared>No derived asset prepared.</p>
    </section>
    <p class="objectify-status" data-objectify-status role="status">Open a local PLY or SPLAT asset to start.</p>
    <p class="objectify-limit">Selections cover retained preview samples, not necessarily the complete original object. Gaussian previews and derived exports use DC colour only; higher-order view-dependent shading is not preserved. Scale, collision proxies, mass, friction and inertia remain unverified. Appearance edits do not update IFC, robot maps or routes.</p>`;

  const $ = name => root.querySelector(`[data-objectify-${name}]`);
  let ctx = null, document = null, composition = null, source = null, basePoints = null;
  let selection = new Set(), selectedId = null, selectionTool = null, busy = false, destroyed = false, suppressHighlight = false;
  let sourceEpoch = 0, operation = 0, prepared = null, variants = [], baseline = null, variantIndex = -1;
  let canvas = null, detach = null, drag = null, box = null, badge = null;

  const status = (message, error = false) => { $('status').textContent = message; $('status').classList.toggle('is-error', error); if (error) onStatus?.(message); };
  const row = () => composition?.objects.find(item => item.id === selectedId) || null;
  const group = () => { const selected = row(); return selected ? document.objects.find(item => item.id === selected.objectId) : null; };
  function getReviewedSelection() {
    const selected = group();
    if (!selected?.reviewed) return null;
    return { name: selected.name, sourceSha256: ctx.source.sha256,
      sourceIndices: selected.indices.map(index => source.sourceIndices[index]) };
  }
  const canRepair = () => source?.kind === 'gaussian-splat' && /\.ply$/i.test(ctx?.source.name || '');
  const activeHighlight = () => !suppressHighlight && (selection.size > 0 || !!selectedId);
  function interaction() { onInteraction?.({ active: !!selectionTool || activeHighlight() }); }
  function invalidate() { operation++; prepared = null; $('prepared').textContent = 'Edits changed. Prepare a new derived asset before recording.'; }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), link = window.document.createElement('a');
    link.href = url; link.download = name; link.hidden = true;
    window.document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function setSelecting(tool) {
    endDrag();
    selectionTool = ctx && !busy && composition?.points.length ? tool || null : null;
    if (selectionTool) onSelectionStart?.();
    const rectangle = selectionTool === 'rectangle', suggest = selectionTool === 'suggest';
    $('select').setAttribute('aria-pressed', String(rectangle));
    $('suggest').setAttribute('aria-pressed', String(suggest));
    $('select').textContent = rectangle ? 'Finish selecting' : 'Draw a box';
    $('suggest').textContent = suggest ? 'Cancel tap selection' : 'Tap an object';
    canvas?.classList.toggle('objectify-selecting', !!selectionTool);
    if (badge) {
      badge.hidden = !selectionTool;
      badge.textContent = suggest ? 'Tap a visible part or press Enter to use the center.' : 'Selection mode · drag a rectangle · Escape to finish';
    }
    if (ctx) interaction();
  }
  function cancelSelectionTool() {
    if (!selectionTool) return;
    setSelecting(null);
    status('Selection mode finished. Orbit to inspect the boundaries.');
  }
  function selectionBounds() {
    if (!selection.size || !basePoints) return null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const index of selection) for (let axis = 0; axis < 3; axis++) {
      const value = basePoints[index * STRIDE + axis]; min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
    }
    return { min, max, size: max.map((value, axis) => value - min[axis]) };
  }
  function highlight() {
    if (!ctx || !composition) return;
    const selected = row(), indices = [];
    if (!suppressHighlight) for (let i = 0; i < composition.previewIndices.length; i++) {
      if (selection.size ? selection.has(composition.previewIndices[i]) && composition.instanceIds[i] === 0 : selected && composition.instanceIds[i] === selected.tag) indices.push(i);
    }
    getViewer()?.setSelection(indices); interaction();
  }
  function controls() {
    const ready = !!ctx && !busy, selected = row(), reviewed = !!selected?.reviewed;
    for (const control of root.querySelectorAll('button,input,select')) control.disabled = !ready;
    $('select').disabled = !ready || !composition?.points.length;
    $('suggest').disabled = !ready || !composition?.stats.backgroundPoints;
    $('clear-selection').disabled = !ready || !selection.size;
    $('create').disabled = !ready || !selection.size || !$('name').value.trim();
    for (const name of ['save-ply', 'save-receipt', 'stage']) $(name).disabled = !ready || !prepared;
    $('stage').disabled ||= typeof onStage !== 'function';
    $('generate').disabled = !ready || !document?.objects.some(item => item.reviewed);
    $('variant').disabled = !ready || !variants.length;
    for (const name of ['edit-name', 'edit-reviewed', 'save-review', 'remove']) $(name).disabled = !ready || !selected;
    for (const name of ['tx', 'ty', 'tz', 'yaw', 'hidden', 'apply', 'duplicate', 'revert']) $(name).disabled = !ready || !selected || !reviewed;
    if ($('portable')) $('portable').disabled = $('keep-portable').disabled = !ready || !reviewed || selected.hidden;
    if ($('repair')) $('repair').disabled = !ready || !reviewed || !canRepair();
    $('prepare').disabled = !ready || !composition?.points.length;
    const box = selectionBounds();
    $('selection').textContent = selection.size ? `${selection.size.toLocaleString()} retained samples selected · ${dimensions(box)} · ${extent(box)}` : 'No samples selected.';
  }
  function renderEditor() {
    const selected = row(), object = group();
    $('edit').hidden = !selected; $('empty').hidden = !!composition?.objects.length;
    $('list').innerHTML = (composition?.objects || []).map(item => `<button type="button" data-objectify-instance="${escape(item.id)}" aria-pressed="${item.id === selectedId}"><span>${escape(item.name)}${item.primary ? '' : ' · copy'}</span><small>${escape(item.objectId)} · ${item.reviewed ? 'Reviewed selection' : 'Needs review'} · ${item.hidden ? 'hidden' : number(item.pointCount) + ' samples'}</small></button>`).join('');
    if (selected) {
      const instance = document.instances.find(item => item.id === selected.id);
      $('facts').textContent = `${object.id} / ${selected.id} · ${dimensions(selected.bounds)} · ${extent(selected.bounds)} · geometry-derived, unchecked`;
      $('edit-name').value = object.name; $('edit-reviewed').checked = object.reviewed;
      ['tx', 'ty', 'tz'].forEach((name, index) => { $(name).value = String(instance.translation[index]); });
      $('yaw').value = String(instance.yawDegrees); $('hidden').checked = instance.hidden;
      $('remove').textContent = selected.primary ? 'Remove object group' : 'Remove copy';
    }
    controls();
  }
  function refreshVariants() {
    $('variant').innerHTML = '<option value="-1">Baseline edits</option>' + variants.map((_, index) => `<option value="${index}">Variant ${index + 1}</option>`).join('');
    $('variant').value = String(variantIndex);
  }
  function commit(next, message, keepVariants = false) {
    const nextComposition = composeObjectDocument(ctx, next);
    invalidate(); document = next; composition = nextComposition; selection.clear(); suppressHighlight = false;
    if (!keepVariants) { variants = []; baseline = null; variantIndex = -1; refreshVariants(); }
    if (!composition.objects.some(item => item.id === selectedId)) selectedId = composition.objects[0]?.id || null;
    onDisplayChange?.({ points: composition.points, kind: source.kind, changed: composition.stats.hasEdits, revision: document.revision,
      objectCount: composition.stats.objectCount, instanceCount: composition.stats.instanceCount });
    renderEditor(); highlight(); status(message);
  }
  function attempt(fn) { try { fn(); } catch (error) { controls(); status(error.message, true); } }
  function fieldNumber(name, { integer = false, min = -1e6, max = 1e6 } = {}) {
    const value = Number($(name).value);
    if (!$(name).value.trim() || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) throw Error(`Choose a finite value for ${$(name).closest('label')?.firstChild.textContent.trim() || name}${integer ? ', using a whole number' : ''}.`);
    return value;
  }
  function selectionHeight() {
    const minY = fieldNumber('min-y', { min: -1e7, max: 1e7 }), maxY = fieldNumber('max-y', { min: -1e7, max: 1e7 });
    if (minY > maxY) throw Error('Lowest Y must not exceed highest Y.');
    return { minY, maxY };
  }
  const ownedIndices = () => new Set(document.objects.flatMap(item => item.indices));
  function applySelection(indices) {
    invalidate(); selectedId = null; suppressHighlight = false;
    const mode = $('mode').value;
    if (mode === 'replace') selection = new Set(indices);
    else if (mode === 'add') for (const index of indices) selection.add(index);
    else for (const index of indices) selection.delete(index);
    $('reviewed').checked = false;
    renderEditor(); highlight();
  }
  function suggestAt(x, y) {
    const height = selectionHeight();
    const picked = getViewer().pick(x, y);
    if (picked < 0 || picked >= composition.previewIndices.length) {
      status('No retained sample at that spot. Tap a visible part, or drag a rectangle.');
      return;
    }
    if (composition.instanceIds[picked] !== 0) {
      status('That part belongs to a saved object. Tap an ungrouped part or choose the object from the list.');
      return;
    }
    const seed = composition.previewIndices[picked];
    const { indices, limited } = suggestObjectRegion(basePoints, seed, { ...height, excluded: ownedIndices() });
    if (!indices.length) {
      status('That part is outside the current height range or too faint. Try another point.');
      return;
    }
    applySelection(indices);
    setSelecting(null);
    status(`${selection.size.toLocaleString()} points highlighted. ${limited ? 'This suggestion reached its limit. ' : ''}Turn the view to check what was picked before keeping it.`);
  }
  function endDrag() {
    const pointerId = drag?.pointerId;
    drag = null;
    if (box) box.hidden = true;
    if (pointerId !== undefined && canvas?.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  function detachCanvas() {
    detach?.(); detach = null; endDrag(); box?.remove(); badge?.remove(); box = null; badge = null;
    canvas?.classList.remove('objectify-selecting'); canvas = null;
  }
  function attachCanvas() {
    detachCanvas(); canvas = getViewer()?.getCanvas(); if (!canvas) return;
    const stage = canvas.parentElement;
    box = window.document.createElement('div'); box.className = 'objectify-dragbox'; box.hidden = true; stage.appendChild(box);
    badge = window.document.createElement('div'); badge.className = 'objectify-selection-badge'; badge.hidden = true; stage.appendChild(badge);
    function drawBox(event) {
      const rect = canvas.getBoundingClientRect(), parent = stage.getBoundingClientRect();
      const x = Math.max(rect.left, Math.min(rect.right, event.clientX)), y = Math.max(rect.top, Math.min(rect.bottom, event.clientY));
      const left = Math.min(drag.x, x), top = Math.min(drag.y, y), right = Math.max(drag.x, x), bottom = Math.max(drag.y, y);
      Object.assign(box.style, { left: `${left - parent.left}px`, top: `${top - parent.top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      box.hidden = false; return { left, top, right, bottom };
    }
    const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    const down = event => {
      if (!selectionTool || busy || event.button !== 0) return;
      consume(event);
      if (drag) { drag.moved = true; return; }
      canvas.focus({ preventScroll: true }); canvas.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, moved: false };
      if (selectionTool === 'rectangle') drawBox(event);
    };
    const move = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      consume(event);
      if (selectionTool === 'rectangle') drawBox(event);
      else if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) drag.moved = true;
    };
    const up = event => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      consume(event);
      const { moved } = drag;
      const rectangle = selectionTool === 'rectangle', rect = rectangle ? drawBox(event) : null;
      endDrag();
      attempt(() => {
        if (!rectangle) {
          if (!moved) suggestAt(event.clientX, event.clientY);
          else status('Tap without dragging to suggest nearby samples. Finish tap selection to orbit.');
          return;
        }
        const height = selectionHeight();
        if (rect.right - rect.left < 3 || rect.bottom - rect.top < 3) { status('Drag a rectangle at least 3 pixels wide and high.'); return; }
        const owned = ownedIndices();
        const hits = getViewer().selectRectangle(rect, height);
        applySelection(hits.map(index => composition.previewIndices[index]).filter(index => index !== undefined && !owned.has(index)));
        status(`${selection.size.toLocaleString()} samples selected. Existing object groups are excluded. Review from another angle before keeping this selection.`);
      });
    };
    const cancelled = event => { if (drag && event.pointerId === drag.pointerId) { consume(event); endDrag(); } };
    const escape = event => {
      if (selectionTool && event.key === 'Escape') {
        consume(event);
        const button = selectionTool === 'suggest' ? $('suggest') : $('select');
        cancelSelectionTool();
        if (event.target === canvas) button.focus();
      }
    };
    const key = event => {
      if (selectionTool === 'suggest' && (event.key === 'Enter' || event.key === ' ')) {
        consume(event);
        const rect = canvas.getBoundingClientRect();
        attempt(() => suggestAt(rect.left + rect.width / 2, rect.top + rect.height / 2));
      }
    };
    const events = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', cancelled], ['lostpointercapture', cancelled], ['keydown', key]];
    events.forEach(([name, handler]) => canvas.addEventListener(name, handler, true));
    window.document.addEventListener('keydown', escape);
    detach = () => {
      events.forEach(([name, handler]) => canvas?.removeEventListener(name, handler, true));
      window.document.removeEventListener('keydown', escape);
    };
  }

  $('select').onclick = () => {
    invalidate(); suppressHighlight = false;
    setSelecting(selectionTool === 'rectangle' ? null : 'rectangle');
    controls(); if (selectionTool) canvas?.scrollIntoView({ block: 'center', behavior: 'instant' });
  };
  $('suggest').onclick = () => {
    invalidate(); suppressHighlight = false;
    setSelecting(selectionTool === 'suggest' ? null : 'suggest');
    if (selectionTool) {
      canvas?.scrollIntoView({ block: 'center', behavior: 'instant' });
      canvas?.focus({ preventScroll: true });
      status('Tap a visible part to suggest nearby samples. With the canvas focused, press Enter to use the center or Escape to finish.');
    }
  };
  $('clear-selection').onclick = () => { invalidate(); selection.clear(); selectedId = null; suppressHighlight = false; renderEditor(); highlight(); status('Selection cleared.'); };
  $('name').oninput = () => { invalidate(); controls(); interaction(); };
  $('create').onclick = () => attempt(() => {
    const added = addObject(ctx, document, { name: $('name').value.trim(), indices: Array.from(selection), reviewed: $('reviewed').checked });
    selectedId = added.document.instances.find(item => item.objectId === added.id && item.primary)?.id || null;
    setSelecting(false); commit(added.document, 'Object selection kept. Its boundary review does not verify a complete physical object.');
    $('name').value = ''; $('reviewed').checked = false; controls();
  });
  $('list').onclick = event => {
    const button = event.target.closest('[data-objectify-instance]'); if (!button || !ctx || busy) return;
    invalidate(); selectedId = button.dataset.objectifyInstance; selection.clear(); suppressHighlight = false;
    renderEditor(); highlight(); status('Object selected. Its highlighted samples can be inspected from another angle.');
  };
  $('save-review').onclick = () => attempt(() => commit(updateObject(ctx, document, selectedId, { name: $('edit-name').value.trim(), reviewed: $('edit-reviewed').checked }), 'Object name and operator review saved.'));
  $('apply').onclick = () => attempt(() => commit(updateObject(ctx, document, selectedId, { translation: ['tx', 'ty', 'tz'].map(name => fieldNumber(name)), yawDegrees: fieldNumber('yaw', { min: -36000, max: 36000 }), hidden: $('hidden').checked }), 'Pose applied to this appearance instance. Collision and physical behaviour remain unchecked.'));
  $('duplicate').onclick = () => attempt(() => {
    const selected = row(), instance = document.instances.find(item => item.id === selected.id);
    const offset = Math.max(0.05, (selected.bounds?.size[0] || ctx.bounds?.radius || 1) * 1.15);
    const added = duplicateObject(ctx, document, selectedId, { translation: [instance.translation[0] + offset, instance.translation[1], instance.translation[2]], hidden: false });
    selectedId = added.id; commit(added.document, 'Authored copy created. It is not another captured object.');
  });
  $('revert').onclick = () => attempt(() => commit(updateObject(ctx, document, selectedId, { translation: [0, 0, 0], yawDegrees: 0, hidden: false }), 'This pose was reset to the original selection.'));
  $('remove').onclick = () => attempt(() => {
    const selected = row(); commit(removeObject(ctx, document, selected.primary ? selected.objectId : selected.id), selected.primary ? 'Object group removed; its original samples return to the background.' : 'Authored copy removed.');
  });
  if ($('repair')) $('repair').onclick = async () => {
    const value = getReviewedSelection();
    if (busy || !value || !canRepair()) return;
    const generation = sourceEpoch, token = operation;
    const isCurrent = () => !destroyed && generation === sourceEpoch && token === operation;
    try { await onRepair(value, isCurrent); }
    catch (error) { if (isCurrent()) status(error.message, true); }
  };
  async function transferObject(download) {
    const selected = row();
    if (busy || !selected?.reviewed || selected.hidden) return;
    const generation = sourceEpoch, token = operation;
    busy = true;
    if (selectionTool) setSelecting(null);
    controls();
    try {
      await onPortable({ context: ctx, document, instanceId: selectedId, download });
      if (generation === sourceEpoch && token === operation) {
        status(download ? 'Object downloaded for use in another room.' : 'Object kept for another room. Open a second scan to place it.');
      }
    } catch (error) {
      if (generation === sourceEpoch && token === operation) status(error.message || 'Could not save this object.', true);
    } finally {
      if (generation === sourceEpoch && token === operation) { busy = false; controls(); }
    }
  }
  if ($('portable')) {
    $('portable').onclick = () => void transferObject(true);
    $('keep-portable').onclick = () => void transferObject(false);
  }
  $('reset').onclick = () => attempt(() => {
    selectedId = null; selection.clear(); setSelecting(false); commit(resetObjectDocument(ctx), 'Original preview restored exactly. The source file was never changed.');
  });
  $('generate').onclick = () => attempt(() => {
    const next = seededObjectVariants(ctx, document, { seed: fieldNumber('seed', { integer: true, min: 0, max: 4294967295 }), count: fieldNumber('count', { integer: true, min: 1, max: 16 }),
      translationRange: ['range-x', 'range-y', 'range-z'].map(name => fieldNumber(name, { min: 0 })), yawRangeDegrees: fieldNumber('range-yaw', { min: 0, max: 180 }) });
    invalidate(); baseline = document; variants = next; variantIndex = -1; refreshVariants(); controls(); interaction(); status(`${variants.length} authored variations generated. Choose a layout to preview; collisions are not checked.`);
  });
  $('variant').onchange = () => attempt(() => {
    const index = Number($('variant').value), next = index < 0 ? baseline : variants[index];
    if (!next) throw Error('Generate variations before selecting a layout.');
    variantIndex = index; commit(next, index < 0 ? 'Baseline edits restored.' : `Authored variation ${index + 1} selected. No physical simulation was run.`, true);
  });
  $('export').onclick = () => attempt(() => { download(new Blob([serializeObjectDocument(ctx, document)], { type: 'application/json' }), 'appearance-object-edits.json'); status('Source-bound edit document downloaded. Original asset bytes are not embedded.'); });
  $('import').onchange = async () => {
    const file = $('import').files[0], token = ++operation, generation = sourceEpoch; $('import').value = ''; if (!file || !ctx) return;
    try {
      if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw Error('Use an edit JSON file up to 4 MiB.');
      const text = await file.text(); if (generation !== sourceEpoch || token !== operation || destroyed) return;
      const next = parseObjectDocument(ctx, text); selectedId = null; setSelecting(false); commit(next, 'Matching-source edit document reopened. Object names and boundary reviews are operator authored.');
    } catch (error) { if (generation === sourceEpoch && token === operation) status(`Edit document rejected: ${error.message}`, true); }
  };
  $('prepare').onclick = async () => {
    if (!ctx || busy) return;
    const token = ++operation, generation = sourceEpoch; busy = true; prepared = null; setSelecting(false); controls(); status('Preparing a separate appearance PLY and provenance receipt…');
    try {
      const output = await exportObjectVariant(ctx, document);
      if (generation !== sourceEpoch || token !== operation || destroyed) return;
      prepared = output; $('prepared').textContent = `${output.name} · ${number(output.buffer.byteLength)} bytes · separate authored appearance asset. Higher-order Gaussian shading and physical accuracy are unverified.`;
      status('Derived asset ready. Download its PLY and receipt, or stage these exact bytes in the camera studio.');
    } catch (error) { if (generation === sourceEpoch && token === operation) status(`Preparation stopped: ${error.message}`, true); }
    finally { if (generation === sourceEpoch && token === operation) { busy = false; controls(); } }
  };
  $('save-ply').onclick = () => { if (prepared) download(new Blob([prepared.buffer], { type: 'application/octet-stream' }), prepared.name); };
  $('save-receipt').onclick = () => { if (prepared) download(new Blob([JSON.stringify(prepared.receipt, null, 2) + '\n'], { type: 'application/json' }), 'appearance-object-variant-receipt.json'); };
  $('stage').onclick = async () => {
    if (!prepared || busy || !onStage) return;
    const token = operation, generation = sourceEpoch; busy = true; setSelecting(false); selection.clear(); suppressHighlight = true; highlight(); controls();
    try {
      await onStage(prepared);
      if (generation !== sourceEpoch || token !== operation || destroyed) return;
      status('Authored variant staged in the camera studio. New object edits or selections invalidate its saved camera paths.');
    } catch (error) { if (generation === sourceEpoch && token === operation) status(`Could not stage the variant: ${error.message}`, true); }
    finally { if (generation === sourceEpoch && token === operation) { busy = false; controls(); } }
  };
  for (const control of root.querySelectorAll('[data-objectify-edit-name],[data-objectify-edit-reviewed],[data-objectify-tx],[data-objectify-ty],[data-objectify-tz],[data-objectify-yaw],[data-objectify-hidden],[data-objectify-seed],[data-objectify-count],[data-objectify-range-x],[data-objectify-range-y],[data-objectify-range-z],[data-objectify-range-yaw]')) control.addEventListener('input', () => { invalidate(); suppressHighlight = false; highlight(); controls(); });

  function clearState() {
    sourceEpoch++; operation++; busy = false; prepared = null; ctx = null; document = null; composition = null; source = null; basePoints = null;
    selection = new Set(); selectedId = null; suppressHighlight = false; variants = []; baseline = null; variantIndex = -1;
    setSelecting(null);
    getViewer()?.setSelection([]); detachCanvas(); root.hidden = true; controls();
  }
  clearState();
  return {
    async setSource(value) {
      clearState(); if (!value || destroyed) return;
      const generation = sourceEpoch; root.hidden = false; busy = true; controls(); status('Binding retained appearance samples to their original source…');
      try {
        const context = await createObjectifyContext(value);
        if (generation !== sourceEpoch || destroyed) return;
        const retained = getObjectifyBase(context);
        ctx = context; source = { ...value, sourceIndices: retained.sourceIndices }; basePoints = retained.points;
        document = createObjectDocument(ctx); composition = composeObjectDocument(ctx, document);
        const count = basePoints.length / STRIDE, total = value.total ?? count;
        $('source').textContent = `${value.source.name} · ${value.kind === 'gaussian-splat' ? 'Gaussian DC preview' : 'Point cloud, not a trained splat'} · ${count.toLocaleString()} retained samples${value.sampled ? ` from ${total.toLocaleString()} source vertices` : ''}${value.skipped ? ` · ${value.skipped} invalid sampled rows omitted` : ''} · SHA-256 ${value.source.sha256}`;
        const box = getViewer()?.getBounds() || ctx.bounds;
        $('min-y').value = String(box.min[1]); $('max-y').value = String(box.max[1]);
        $('name').value = ''; $('reviewed').checked = false; $('prepared').textContent = 'No derived asset prepared.';
        busy = false; attachCanvas(); renderEditor(); refreshVariants(); controls(); status('Select the visible samples of one movable object. Review floor and background contamination before keeping it.');
      } catch (error) { if (generation === sourceEpoch && !destroyed) { busy = false; controls(); status(`Object workshop unavailable: ${error.message}`, true); } }
    },
    getReviewedSelection,
    cancelSelectionTool,
    clear() { clearState(); },
    destroy() { destroyed = true; clearState(); root.innerHTML = ''; },
  };
}
