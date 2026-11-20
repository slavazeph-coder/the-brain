const AXES = ['x', 'y', 'z'];
const DEFAULTS = {x:0, y:12, z:0, radius:68, strength:80};
const TINTS = {neutral:[1, 1, 1], warm:[1, .67, .36], cool:[.43, .8, 1]};
const COORDINATE_LIMIT = 150;

/** Session-local effect only. The source bytes and all object edits remain untouched. */
export function mountSplatLamp({root, viewer, onActiveChange = () => {}, onPlacementStart}) {
  const $ = selector => root.querySelector(selector);
  const abort = new AbortController(), signal = abort.signal;
  const enabled = $('[data-lamp-enabled]');
  const controls = $('[data-lamp-controls]');
  const tint = $('[data-lamp-tint]');
  const place = $('[data-lamp-place]');
  const status = $('[data-lamp-status]');
  const label = $('[data-lamp-summary]');
  const sliders = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, $(`[data-lamp-slider="${key}"]`)]));
  const canvas = viewer?.getCanvas();
  let frame = null, active = false, placement = false;

  function cancelPlacement() {
    if (!placement) return;
    placement = false;
    canvas?.removeAttribute('data-lamp-picking');
    place.setAttribute('aria-pressed', 'false');
    place.textContent = 'Pick a spot on the scan';
    status.textContent = 'Lamp on. Move or pick a spot to brighten a patch.';
  }

  function values() {
    return Object.fromEntries(Object.entries(sliders).map(([key,input]) => {
      const value = Number(input.value);
      $(`[data-lamp-value="${key}"]`).textContent = `${value}%`;
      input.setAttribute('aria-valuetext', `${value} percent`);
      return [key,value];
    }));
  }

  function resetValues() {
    for (const [key,value] of Object.entries(DEFAULTS)) sliders[key].value = String(value);
    tint.value = 'neutral';
    values();
  }

  function apply() {
    const next = Boolean(frame && enabled.checked), previous = active;
    const settings = values();
    if (!next) cancelPlacement();
    try {
      // Stop any in-flight camera capture before it can see a modified frame.
      if (next && !previous) onActiveChange(true);
      const preview = next ? {position:AXES.map((axis,index) => frame.center[index] + settings[axis] * frame.radius / 100),
        radius:settings.radius * frame.radius / 100, strength:settings.strength / 100, tint:TINTS[tint.value]} : null;
      viewer?.setAppearanceLamp(preview);
      active = next;
      if (!next && previous) onActiveChange(false);
      controls.disabled = !active;
      label.textContent = active ? '· On' : '';
      if (!placement) status.textContent = active ? 'Lamp on. Move or pick a spot to brighten a patch.' : 'The preview lamp is off.';
    } catch (error) {
      viewer?.setAppearanceLamp(null);
      if (next || previous) onActiveChange(false);
      active = enabled.checked = false;
      controls.disabled = true;
      label.textContent = '';
      cancelPlacement();
      status.textContent = error.message;
    }
  }

  function clear() {
    enabled.checked = false;
    frame = null;
    apply();
    resetValues();
    root.hidden = true;
  }

  enabled.addEventListener('change', apply, {signal});
  tint.addEventListener('change', apply, {signal});
  for (const input of Object.values(sliders)) input.addEventListener('input', apply, {signal});
  $('[data-lamp-reset]').addEventListener('click', () => { cancelPlacement(); resetValues(); apply(); }, {signal});
  place.addEventListener('click', () => {
    if (!active) return;
    if (placement) { cancelPlacement(); return; }
    onPlacementStart?.();
    placement = true;
    canvas?.setAttribute('data-lamp-picking', '');
    place.setAttribute('aria-pressed', 'true');
    place.textContent = 'Cancel picking a spot';
    status.textContent = 'Tap or click a visible spot on the scan. You can also use the position sliders.';
    canvas?.focus({preventScroll:true});
    canvas?.scrollIntoView({block:'center', behavior:'instant'});
  }, {signal});
  root.addEventListener('toggle', () => { if (!root.open) cancelPlacement(); }, {signal});
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !placement) return;
    cancelPlacement();
    if (document.activeElement === canvas) place.focus();
  }, {signal});
  // Handle only an explicitly armed lamp placement, before the canvas handles orbit or object selection.
  canvas?.parentElement?.addEventListener('pointerdown', event => {
    if (!placement || !active || event.target !== canvas || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    const point = viewer.getAppearancePoint(viewer.pick(event.clientX, event.clientY));
    const chosen = point?.map((value,index) => Math.round((value - frame.center[index]) * 100 / frame.radius));
    if (!chosen || chosen.some(value => Math.abs(value) > COORDINATE_LIMIT)) {
      status.textContent = 'Pick a visible spot inside the main scan, or move the lamp with the sliders.';
      return;
    }
    for (const [index,axis] of AXES.entries()) sliders[axis].value = String(chosen[index]);
    cancelPlacement();
    apply();
    status.textContent = 'Lamp moved to the selected spot.';
  }, {capture:true, signal});
  resetValues();
  return {
    setAsset(kind) {
      clear();
      frame = kind === 'gaussian-splat' ? viewer?.getAppearanceLampFrame() : null;
      root.hidden = !frame;
    },
    clear,
    cancelPlacement,
    dispose() { abort.abort(); clear(); },
  };
}
