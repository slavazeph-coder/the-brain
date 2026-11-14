// This module is bundled by build-movement-pose.mjs and loaded only on request.
import * as tf from '@tensorflow/tfjs';
import { setWasmPaths, setThreadsCount } from '@tensorflow/tfjs-backend-wasm';

let backendReady;
export async function openPoseDetector(assetUrl, signal) {
  if (!backendReady) {
    setWasmPaths(assetUrl);
    setThreadsCount(1);
    backendReady = tf.setBackend('wasm').then(ok => {
      if (!ok) throw new Error('This browser could not start the pose detector.');
    }).catch(error => { backendReady = undefined; throw error; });
  }
  await backendReady;
  signal?.throwIfAborted();
  const model = await tf.loadGraphModel(assetUrl + 'model.json', {requestInit:{signal}});
  return {
    async detect(canvas) {
      const output = tf.tidy(() => model.execute(tf.browser.fromPixels(canvas, 3).expandDims(0)));
      try { return await output.data(); }
      finally { output.dispose(); }
    },
    close() { model.dispose(); },
  };
}
