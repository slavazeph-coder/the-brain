/** Same-site, deferred GLB renderer with the Arena's bounded self-contained asset parser. */
let modulePromise;
export async function createMeshViewer(container, onInfo = () => {}) {
  if (!window.BrainSNNSiteRenderer) {
    modulePromise ||= import('/arena/site-renderer.js').catch(error => { modulePromise = null; throw error; });
    await modulePromise;
  }
  const renderer = window.BrainSNNSiteRenderer?.create(container, { visualOnly: true, onError: onInfo });
  if (!renderer?.available) throw Error('The mesh viewer is unavailable on this device.');
  let pitch = 0;
  const canvas = container.querySelector('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-describedby', 'viewer-help');
  const resetKey = event => { if (event.key === '0') { event.preventDefault(); renderer.frameAsset(); } };
  canvas.addEventListener('keydown', resetKey);
  return {
    async setFile(file) { pitch = 0; return renderer.importAsset(file); },
    reset() { renderer.frameAsset(); },
    flip() { pitch += Math.PI; renderer.setAssetTransform({ pitch }); renderer.frameAsset(); },
    clear() { renderer.clearAsset(); },
    destroy() { canvas.removeEventListener('keydown', resetKey); renderer.dispose(); },
  };
}
