/** Keep checked model review in the same workspace as its capture and robot map. */
export function createSceneWorkspace() {
  const dialog = document.getElementById('scene-dialog');
  const workspace = document.getElementById('workspace');
  const slot = document.getElementById('scene-workspace-slot');
  let previousFocus = null;
  if (!dialog || !workspace || !slot) throw new Error('The model workspace is unavailable.');
  slot.append(dialog);
  dialog.classList.add('scene-inline');
  const heading = dialog.querySelector('h2');
  heading.id = 'scene-workspace-heading';
  heading.tabIndex = -1;
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.querySelector('[aria-label="Close simulation scene"]').textContent = 'Back to playground ×';
  function closed() {
    if (dialog.open) return;
    delete workspace.dataset.primaryView;
    slot.hidden = true;
    if (previousFocus?.isConnected && (dialog.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.focus({preventScroll:true});
    previousFocus = null;
  }
  dialog.addEventListener('close', closed);
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.target.closest('dialog') !== dialog) return;
    event.preventDefault(); dialog.close();
  });
  return {
    open() {
      if (!dialog.open) previousFocus = document.activeElement;
      slot.hidden = false;
      workspace.dataset.primaryView = 'model';
      if (!dialog.open) dialog.show();
      heading.textContent = 'Your 3D model, drawings and checks';
      slot.scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      heading.focus({preventScroll:true});
    },
    close:() => { if (dialog.open) dialog.close(); },
    isOpen:() => dialog.open,
  };
}
