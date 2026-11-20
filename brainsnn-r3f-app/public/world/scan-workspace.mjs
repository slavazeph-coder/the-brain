export const scanPanel = `<section id="layer-panel-scanedit" role="tabpanel" aria-labelledby="layer-tab-scanedit" hidden>
  <div data-scan-host></div>
</section>`;

/** Mount the same local editor used by direct asset links only when its tab is opened. */
export function mountScanWorkspace(host, openReviewedRepair) {
  let frame, sizes, preferences, resizeFrame = 0;
  function clear() {
    frame?.contentWindow?.removeEventListener('resize', scheduleSize);
    cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
    sizes?.disconnect();
    preferences?.disconnect();
    frame?.remove();
    frame = sizes = preferences = null;
  }
  function sync() {
    const child = frame?.contentDocument?.documentElement;
    if (!child) return;
    for (const key of ['readingSize', 'contrast']) {
      if (document.documentElement.dataset[key]) child.dataset[key] = document.documentElement.dataset[key];
      else delete child.dataset[key];
    }
    scheduleSize();
  }
  function size() {
    const main = frame?.contentDocument?.querySelector('main');
    if (!main || !host.clientWidth) return;
    const height = Math.ceil(main.getBoundingClientRect().height + 2) + 'px';
    if (frame.style.height !== height) frame.style.height = height;
  }
  function scheduleSize() {
    if (!resizeFrame) resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; size(); });
  }
  function open() {
    if (frame) { size(); return; }
    const editor = document.createElement('iframe');
    frame = editor;
    editor.title = 'Room editor';
    editor.id = 'scan-workshop-frame';
    editor.openReviewedRepair = openReviewedRepair;
    editor.addEventListener('load', () => {
      sizes?.disconnect();
      if (frame !== editor) return;
      const main = editor.contentDocument?.querySelector('main');
      if (!main) return;
      sync();
      // The child changes height as reviews, details and results open. Observe
      // those changes inside its own document and size the host on the next frame.
      sizes = new editor.contentWindow.MutationObserver(scheduleSize);
      sizes.observe(main, {childList:true, characterData:true, subtree:true, attributes:true,
        attributeFilter:['hidden','open','class','style']});
      editor.contentWindow.addEventListener('resize', scheduleSize);
      size();
    });
    editor.src = './splat.html?workspace=1';
    host.append(editor);
    preferences = new MutationObserver(sync);
    preferences.observe(document.documentElement, {attributes:true, attributeFilter:['data-reading-size','data-contrast']});
  }
  function suspend() {
    if (frame?.contentWindow) frame.contentWindow.dispatchEvent(new Event('brainsnn-workshop-suspend'));
  }
  return {open, clear, suspend};
}
