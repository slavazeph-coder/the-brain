/* Off-main-thread geometric planning. The worker has no network operations,
 * robot connection or credentials. A request always describes one scene. */
'use strict';
importScripts('site-core.js');
self.onmessage = function (event) {
  const input = event.data;
  if (!input || typeof input !== 'object' || !Number.isSafeInteger(input.id)) return;
  try {
    const result = self.BrainSNNSiteCore.plan(input.scene, input.robot, input.options || {});
    self.postMessage({ id: input.id, ok: true, result });
  } catch (error) {
    self.postMessage({ id: input.id, ok: false, error: String(error?.message || 'The route could not be planned.').slice(0, 300) });
  }
};
