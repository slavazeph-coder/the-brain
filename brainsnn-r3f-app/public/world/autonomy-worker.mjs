// Runs an autonomy trial off the page's main thread. Same module, same seeds, same report as running it inline.
import {runTrial} from './autonomy.mjs';

self.onmessage = async ({data}) => {
  try {
    const report = await runTrial(data.world, data.options, {
      progress: (done, total, last) => self.postMessage({type: 'progress', done, total, condition: last.condition, outcome: last.outcome}),
    });
    self.postMessage({type: 'done', report});
  } catch (error) {
    self.postMessage({type: 'error', message: error?.message || String(error)});
  }
};
