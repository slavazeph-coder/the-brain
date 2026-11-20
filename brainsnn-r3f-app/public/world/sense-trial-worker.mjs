import {runSenseBenchmark} from './sense-policy.mjs';

self.onmessage = ({data}) => {
  try {
    const report = runSenseBenchmark(data);
    self.postMessage({ok: true, report});
  } catch {
    self.postMessage({ok: false});
  }
};
