import {ICONS} from './playground-icons.mjs';

/**
 * On-screen camera buttons for people who cannot drag, use a keyboard or pinch. The map's arrows turn it;
 * preview arrows move through the scene, so its Turn buttons use the viewer's explicit rotation action.
 */
export function mountCameraDock({getCanvas, getPreviewViewer = () => null, setNames}) {
  const press = (key, times) => {
    const canvas = getCanvas();
    if (!canvas) return;
    const preview = getPreviewViewer();
    if (preview && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      preview.rotateYaw((key === 'ArrowLeft' ? -1 : 1) * .12 * times);
      return;
    }
    for (let i = 0; i < times; i++) canvas.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
  };
  const moves = {'cam-left': ['turnLeft', 'ArrowLeft', 3], 'cam-right': ['turnRight', 'ArrowRight', 3], 'cam-in': ['zoomIn', '+', 2], 'cam-out': ['zoomOut', '-', 2]};
  const abort = new AbortController();
  for (const [id, [icon, key, times]] of Object.entries(moves)) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.insertAdjacentHTML('afterbegin', ICONS[icon]);
    button.addEventListener('click', () => press(key, times), {signal: abort.signal});
  }
  for (const [id, icon] of [['undo-edit', 'undo'], ['redo-edit', 'redo']]) {
    const button = document.getElementById(id);
    if (button && !button.querySelector('svg')) button.insertAdjacentHTML('afterbegin', ICONS[icon]);
  }
  const reset = document.getElementById('reset-view');
  if (reset && !reset.querySelector('svg')) reset.insertAdjacentHTML('afterbegin', ICONS.home);
  const names = document.getElementById('cam-names');
  if (names) {
    names.insertAdjacentHTML('afterbegin', ICONS.names);
    names.addEventListener('click', () => {
      const on = names.getAttribute('aria-pressed') !== 'true';
      names.setAttribute('aria-pressed', String(on));
      setNames(on);
    }, {signal: abort.signal});
  }
  function sync() {
    const canvas = getCanvas();
    for (const id of Object.keys(moves)) { const button = document.getElementById(id); if (button) button.disabled = !canvas; }
    // Name tags belong to the planning map; the 3D preview has no named objects.
    if (names) names.hidden = canvas?.id !== 'world-canvas';
  }
  sync();
  return {sync, dispose: () => abort.abort()};
}
